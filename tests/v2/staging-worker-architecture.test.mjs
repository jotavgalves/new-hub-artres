import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const configUrl = new URL('wrangler.site-v2-staging.jsonc', root);
const wrapperUrl = new URL('staging/site-v2-worker/src/index-shadow.js', root);
const workerUrl = new URL('staging/site-v2-worker/src/index.js', root);
const ledgerUrl = new URL('staging/site-v2-worker/src/order-ledger-do.js', root);
const fixtureUrl = new URL('staging/site-v2-worker/src/staging-catalog-fixture.js', root);
const atomicCommandUrl = new URL('src/v2/orders/atomic-command.mjs', root);

const configText = await readFile(configUrl, 'utf8');
const config = JSON.parse(configText);
const wrapperSource = await readFile(wrapperUrl, 'utf8');
const workerSource = await readFile(workerUrl, 'utf8');
const ledgerSource = await readFile(ledgerUrl, 'utf8');
const fixtureSource = await readFile(fixtureUrl, 'utf8');
const atomicCommandSource = await readFile(atomicCommandUrl, 'utf8');

test('configuração é exclusivamente de staging, habilita só escrita sintética e não declara rota de produção', () => {
  assert.equal(config.name, 'new-hub-artres-v2-staging');
  assert.equal(config.main, 'staging/site-v2-worker/src/index-shadow.js');
  assert.equal(config.compatibility_date, '2026-07-26');
  assert.ok(config.compatibility_flags.includes('nodejs_compat'));
  assert.equal(config.vars.ENVIRONMENT, 'staging');
  assert.equal(config.vars.STAGING_WRITE_ENABLED, 'true');
  assert.equal(config.vars.STAGING_LOW_LEVEL_LEDGER_ENABLED, 'false');
  assert.equal(config.vars.SUPABASE_SHADOW_ENABLED, 'false');
  assert.equal(config.vars.SUPABASE_V2_URL, 'https://kueklnkznwpbobqwugns.supabase.co');
  assert.equal(config.vars.SUPABASE_SHADOW_TIMEOUT_MS, '3500');
  assert.equal(config.routes, undefined);
  assert.equal(config.env, undefined);
  assert.equal(config.workers_dev, true);
});

test('entrypoint sombra delega ao Worker consolidado e preserva o Durable Object', () => {
  assert.ok(wrapperSource.includes("import baseWorker, { OrderLedger } from './index.js';"));
  assert.ok(wrapperSource.includes('export { OrderLedger };'));
  assert.ok(wrapperSource.includes('await baseWorker.fetch(request, env, ctx)'));
  assert.ok(wrapperSource.includes('ctx.waitUntil(task)'));
  assert.equal(wrapperSource.includes('markOutboxDelivered'), false);
});

test('secret interno é obrigatório, mas não possui valor no arquivo', () => {
  assert.deepEqual(config.secrets, { required: ['STAGING_API_TOKEN'] });
  assert.equal(Object.hasOwn(config.vars, 'STAGING_API_TOKEN'), false);
  assert.equal(Object.hasOwn(config.vars, 'SUPABASE_V2_SERVICE_ROLE_KEY'), false);
  assert.equal(configText.includes('local-staging-token-0123456789abcdef'), false);
});

test('Durable Object usa SQLite e migration explícita', () => {
  assert.deepEqual(config.durable_objects.bindings, [
    { name: 'ORDER_LEDGER', class_name: 'OrderLedger' }
  ]);
  assert.deepEqual(config.migrations, [
    { tag: 'v1', new_sqlite_classes: ['OrderLedger'] }
  ]);
});

test('configuração não contém valores ou IDs de recursos de produção', () => {
  const forbidden = [
    'ADMIN_SECRET_KEY',
    'SERVICE_ROLE',
    'namespace_id',
    'database_id',
    'account_id',
    'zone_name',
    'new-hub-artres.pages.dev',
    'drive.google.com'
  ];

  for (const term of forbidden) {
    assert.equal(configText.toLowerCase().includes(term.toLowerCase()), false, `Encontrado: ${term}`);
  }
});

test('Worker expõe somente saúde e rotas internas de staging', () => {
  assert.ok(workerSource.includes("url.pathname === '/health'"));
  assert.ok(workerSource.includes("url.pathname.startsWith('/internal/v2/')"));
  assert.ok(workerSource.includes("url.pathname === '/internal/v2/orders/submit'"));
  assert.ok(workerSource.includes("url.pathname === '/internal/v2/ledger/submit'"));
  assert.equal(workerSource.includes("'/api/orders/v2'"), false);
  assert.ok(workerSource.includes("env.STAGING_WRITE_ENABLED !== 'true'"));
  assert.ok(workerSource.includes("env.STAGING_LOW_LEVEL_LEDGER_ENABLED !== 'true'"));
  assert.ok(workerSource.includes("request.headers.get('x-staging-token')"));
  assert.ok(workerSource.includes('constantTimeEqualSecrets'));
});

test('rota comercial usa comando atômico e catálogo sintético', () => {
  assert.ok(workerSource.includes('createAtomicLedgerCommandV2'));
  assert.ok(workerSource.includes('STAGING_CATALOG_ITEMS'));
  assert.ok(workerSource.includes('STAGING_PRODUCT_SNAPSHOT'));
  assert.ok(workerSource.includes("source: 'catalog-v2-staging-synthetic'"));
  assert.ok(fixtureSource.includes('staging-artwork-2657'));
  assert.ok(fixtureSource.includes('example.invalid'));
  assert.equal(fixtureSource.includes('new-hub-artres.pages.dev'), false);
  assert.equal(fixtureSource.includes('drive.google.com'), false);
});

test('chave bruta não segue para o ledger', () => {
  assert.ok(atomicCommandSource.includes('idempotencyStorageKey(input.idempotencyKey)'));
  assert.equal(atomicCommandSource.includes('normalizeIdempotencyKey(input.idempotencyKey)'), false);
});

test('corpo é limitado durante o streaming e erros inesperados são genéricos', () => {
  assert.ok(workerSource.includes('readLimitedTextBody(request, MAX_JSON_BYTES)'));
  assert.ok(workerSource.includes("reader.cancel('REQUEST_BODY_TOO_LARGE')"));
  assert.equal(workerSource.includes('await request.text()'), false);
  assert.ok(workerSource.includes("'STAGING_INTERNAL_ERROR'"));
  assert.equal(workerSource.includes('error?.message'), false);
});

test('consultas HTTP internas removem dados pessoais', () => {
  assert.ok(workerSource.includes('customer: { redacted: true }'));
  assert.ok(workerSource.includes('orderInspectionView(order)'));
  assert.ok(workerSource.includes('events.map(outboxInspectionView)'));
});

test('Worker não importa Functions legadas nem arquivos ativos da produção', () => {
  assert.equal(workerSource.includes('/functions/'), false);
  assert.equal(wrapperSource.includes('/functions/'), false);
  assert.equal(ledgerSource.includes('/functions/'), false);
  assert.equal(workerSource.includes('CONFIG_KV'), false);
  assert.equal(wrapperSource.includes('CONFIG_KV'), false);
  assert.equal(ledgerSource.includes('CONFIG_KV'), false);
  assert.equal(workerSource.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(wrapperSource.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(ledgerSource.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
});

test('ledger usa transação síncrona para pedido, idempotência e outbox', () => {
  assert.ok(ledgerSource.includes('this.ctx.storage.transactionSync'));
  assert.ok(ledgerSource.includes('INSERT INTO orders'));
  assert.ok(ledgerSource.includes('INSERT INTO idempotency'));
  assert.ok(ledgerSource.includes('INSERT INTO outbox'));
  assert.ok(ledgerSource.includes('PRAGMA optimize'));
});

test('callback transacional não contém await ou chamada externa', () => {
  const start = ledgerSource.indexOf('#submitTransaction(command)');
  const end = ledgerSource.indexOf('\n  #ensureYear', start);
  const transactionBody = ledgerSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.equal(/\bawait\b/.test(transactionBody), false);
  assert.equal(/\bfetch\s*\(/.test(transactionBody), false);
});

test('estado crítico é persistido, não mantido em variável global mutável', () => {
  assert.equal(/^(let|var)\s+/m.test(ledgerSource), false);
  assert.ok(ledgerSource.includes('CREATE TABLE IF NOT EXISTS orders'));
  assert.ok(ledgerSource.includes('CREATE TABLE IF NOT EXISTS idempotency'));
  assert.ok(ledgerSource.includes('CREATE TABLE IF NOT EXISTS outbox'));
});
