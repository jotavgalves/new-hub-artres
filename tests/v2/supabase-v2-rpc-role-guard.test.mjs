import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../supabase/migrations/20260727193100_armazem_v2_rpc_role_guard.sql',
  import.meta.url
);
const migration = await readFile(migrationUrl, 'utf8');

const signatures = [
  'armazem_v2_project_order_v1(jsonb)',
  'armazem_v2_list_orders_redacted_v1(integer)',
  'armazem_v2_projection_health_v1()'
];

const functionNames = [
  'armazem_v2_project_order_v1',
  'armazem_v2_list_orders_redacted_v1',
  'armazem_v2_projection_health_v1'
];

test('guard complementar é transacional e não altera dados comerciais', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/m);
  assert.equal(/create\s+table/i.test(migration), false);
  assert.equal(/drop\s+(table|schema)/i.test(migration), false);
  assert.equal(/insert\s+into\s+armazem_v2_private/i.test(migration), false);
  assert.equal(/delete\s+from\s+armazem_v2_private/i.test(migration), false);
  assert.equal(/update\s+armazem_v2_private/i.test(migration), false);
});

test('guard troca a claim legada pelas claims consolidadas sem fixar GUC protegido', () => {
  assert.ok(migration.includes("current_setting('request.jwt.claims', true)"));
  assert.ok(migration.includes("current_setting('request.jwt.claim.role', true)"));
  assert.ok(migration.includes('pg_get_functiondef'));
  assert.ok(migration.includes('v_updated := replace('));
  assert.ok(migration.includes('ARMAZEM_V2_ROLE_GUARD_PATTERN_NOT_FOUND'));
  assert.equal(migration.includes('set "request.jwt.claim.role"'), false);

  for (const functionName of functionNames) {
    assert.ok(migration.includes(`'${functionName}'`));
  }
});

test('ACL permanece exclusiva de service_role nas três RPCs', () => {
  for (const signature of signatures) {
    assert.ok(migration.includes(`revoke all on function public.${signature} from public;`));
    assert.ok(migration.includes(`revoke all on function public.${signature} from anon;`));
    assert.ok(migration.includes(`revoke all on function public.${signature} from authenticated;`));
    assert.ok(migration.includes(`grant execute on function public.${signature} to service_role;`));
  }
});

test('guard não concede acesso a tabelas nem contém segredos', () => {
  assert.equal(/grant\s+(select|insert|update|delete|all).*table/i.test(migration), false);
  assert.equal(migration.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(migration.includes('sb_secret_'), false);
  assert.equal(migration.includes('eyJhbGciOi'), false);
});
