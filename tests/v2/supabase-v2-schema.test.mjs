import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const migrationUrl = new URL(
  'supabase/migrations/20260727193000_armazem_v2_projection_foundation.sql',
  root
);
const contractUrl = new URL('supabase/contracts/order-projection-v1.schema.json', root);
const workflowUrl = new URL('.github/workflows/site-v2-baseline.yml', root);

const migration = await readFile(migrationUrl, 'utf8');
const contractText = await readFile(contractUrl, 'utf8');
const workflow = await readFile(workflowUrl, 'utf8');
const contract = JSON.parse(contractText);

const privateTables = [
  'orders',
  'order_customers',
  'order_items',
  'idempotency_keys',
  'outbox_events'
];

function functionBody(name) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `Função ausente: ${name}`);
  const end = migration.indexOf('\n$$;', migration.indexOf('as $$', start));
  assert.ok(end > start, `Corpo incompleto: ${name}`);
  return migration.slice(start, end + 4);
}

test('migration é transacional e usa schema privado próprio', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/m);
  assert.ok(migration.includes('create schema if not exists armazem_v2_private;'));
  assert.equal(migration.includes('create table public.'), false);
  assert.equal(migration.includes('drop schema'), false);
  assert.equal(migration.includes('drop table'), false);
});

test('tabelas de negócio ficam no schema privado e separam dados pessoais', () => {
  for (const table of privateTables) {
    assert.ok(
      migration.includes(`create table if not exists armazem_v2_private.${table}`),
      `Tabela ausente: ${table}`
    );
  }

  const ordersStart = migration.indexOf('create table if not exists armazem_v2_private.orders');
  const customersStart = migration.indexOf('create table if not exists armazem_v2_private.order_customers');
  const ordersBlock = migration.slice(ordersStart, customersStart);

  assert.equal(ordersBlock.includes('customer_name'), false);
  assert.equal(ordersBlock.includes('customer_whatsapp'), false);
  assert.equal(ordersBlock.includes('customer_phone'), false);
  assert.ok(migration.includes('customer_whatsapp text not null'));
  assert.ok(migration.includes('customer_phone text not null'));
});

test('todas as tabelas possuem RLS habilitada e forçada sem política pública', () => {
  for (const table of privateTables) {
    assert.ok(migration.includes(`alter table armazem_v2_private.${table} enable row level security;`));
    assert.ok(migration.includes(`alter table armazem_v2_private.${table} force row level security;`));
  }

  assert.equal(/create\s+policy/i.test(migration), false);
  assert.ok(migration.includes('revoke all on all tables in schema armazem_v2_private from public;'));
  assert.ok(migration.includes('revoke all on all tables in schema armazem_v2_private from anon;'));
  assert.ok(migration.includes('revoke all on all tables in schema armazem_v2_private from authenticated;'));
  assert.equal(/grant\s+(select|insert|update|delete|all).*table/i.test(migration), false);
});

test('RPCs são security definer, fixam search_path e exigem service_role', () => {
  const functions = [
    'armazem_v2_project_order_v1(jsonb)',
    'armazem_v2_list_orders_redacted_v1(integer)',
    'armazem_v2_projection_health_v1()'
  ];

  for (const signature of functions) {
    assert.ok(migration.includes(`grant execute on function public.${signature} to service_role;`));
    assert.ok(migration.includes(`revoke all on function public.${signature} from public;`));
    assert.ok(migration.includes(`revoke all on function public.${signature} from anon;`));
    assert.ok(migration.includes(`revoke all on function public.${signature} from authenticated;`));
  }

  assert.equal((migration.match(/security definer/g) || []).length, 3);
  assert.equal((migration.match(/set search_path = pg_catalog, armazem_v2_private/g) || []).length, 3);
  assert.equal((migration.match(/ARMAZEM_V2_SERVICE_ROLE_REQUIRED/g) || []).length, 3);
});

test('projeção valida chave derivada, fingerprint, preço e concorrência', () => {
  const body = functionBody('armazem_v2_project_order_v1');

  assert.ok(body.includes("'^idempotency:v2:[a-f0-9]{64}$'"));
  assert.ok(body.includes("'^[a-f0-9]{64}$'"));
  assert.ok(body.includes('pg_advisory_xact_lock'));
  assert.ok(body.includes('ARMAZEM_V2_IDEMPOTENCY_KEY_CONFLICT'));
  assert.ok(body.includes('ARMAZEM_V2_ORDER_NUMBER_CONFLICT'));
  assert.ok(body.includes('ARMAZEM_V2_ITEM_SUBTOTAL_INVALID'));
  assert.ok(body.includes('ARMAZEM_V2_ORDER_SUBTOTAL_INVALID'));
  assert.ok(body.includes('ARMAZEM_V2_ORDER_TOTAL_INVALID'));
  assert.ok(body.includes("'action', 'CREATED'"));
  assert.ok(body.includes("'action', 'REPLAY'"));
});

test('leitura administrativa nunca consulta a tabela privada de clientes', () => {
  const body = functionBody('armazem_v2_list_orders_redacted_v1');

  assert.ok(body.includes("'customer', jsonb_build_object('redacted', true)"));
  assert.equal(body.includes('order_customers'), false);
  assert.equal(body.includes('customer_name'), false);
  assert.equal(body.includes('customer_whatsapp'), false);
  assert.equal(body.includes('customer_phone'), false);
  assert.ok(body.includes("'readOnly', true"));
});

test('contrato JSON corresponde ao pedido canônico V2', () => {
  assert.equal(contract.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(contract.properties.contractVersion.const, 1);
  assert.equal(contract.properties.idempotencyKey.pattern, '^idempotency:v2:[a-f0-9]{64}$');
  assert.equal(contract.properties.fingerprint.pattern, '^[a-f0-9]{64}$');
  assert.equal(contract.properties.eventType.const, 'order.created.v2');
  assert.equal(contract.$defs.order.properties.schemaVersion.const, 2);
  assert.equal(contract.$defs.order.properties.orderNumber.pattern, '^PED[0-9]{7}[A-Z]+$');
  assert.equal(contract.$defs.order.properties.pricing.$ref, '#/$defs/pricing');
  assert.equal(contract.$defs.pricing.properties.currency.const, 'BRL');
  assert.equal(contract.$defs.order.properties.items.minItems, 1);
  assert.equal(contract.$defs.order.properties.items.maxItems, 200);
  assert.equal(contract.$defs.customer.properties.whatsapp.pattern, '^[0-9]{0,20}$');
});

test('arquivos não contêm projetos, domínios ou segredos concretos', () => {
  const combined = `${migration}\n${contractText}`;
  const forbidden = [
    'kueklnkznwpbobqwugns',
    'rztkgwdmwipzlweqxlqr',
    'new-hub-artres.pages.dev',
    'SUPABASE_SERVICE_ROLE_KEY=',
    'sb_secret_',
    'eyJhbGciOi'
  ];

  for (const term of forbidden) {
    assert.equal(combined.includes(term), false, `Conteúdo proibido encontrado: ${term}`);
  }
});

test('baseline é acionado por qualquer alteração futura em supabase', () => {
  assert.ok(workflow.includes("- 'supabase/**'"));
  assert.ok(workflow.includes('node --test tests/v2/*.test.mjs'));
});
