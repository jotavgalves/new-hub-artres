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

test('guard complementar é transacional e não altera tabelas', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/m);
  assert.equal(/create\s+table/i.test(migration), false);
  assert.equal(/drop\s+/i.test(migration), false);
  assert.equal(/insert\s+into/i.test(migration), false);
  assert.equal(/update\s+/i.test(migration), false);
  assert.equal(/delete\s+from/i.test(migration), false);
});

test('contexto compatível é fixado somente nas três RPCs restritas', () => {
  assert.equal(
    (migration.match(/set "request\.jwt\.claim\.role" = 'service_role';/g) || []).length,
    3
  );

  for (const signature of signatures) {
    assert.ok(migration.includes(`alter function public.${signature}`));
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
