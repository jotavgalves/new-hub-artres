import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../../supabase/migrations/20260727193200_armazem_v2_projection_fk_indexes.sql',
  import.meta.url
);
const migration = await readFile(migrationUrl, 'utf8');

test('índices de chaves estrangeiras são transacionais e idempotentes', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/m);
  assert.equal((migration.match(/create index if not exists/g) || []).length, 2);
});

test('cobre idempotência e outbox pelos campos referenciados', () => {
  assert.ok(migration.includes('armazem_v2_idempotency_order_number_idx'));
  assert.ok(migration.includes('armazem_v2_private.idempotency_keys (order_number)'));
  assert.ok(migration.includes('armazem_v2_outbox_aggregate_id_idx'));
  assert.ok(migration.includes('armazem_v2_private.outbox_events (aggregate_id)'));
});

test('migration de índices não altera dados nem permissões', () => {
  assert.equal(/insert\s+into/i.test(migration), false);
  assert.equal(/update\s+/i.test(migration), false);
  assert.equal(/delete\s+from/i.test(migration), false);
  assert.equal(/grant\s+/i.test(migration), false);
  assert.equal(/revoke\s+/i.test(migration), false);
});
