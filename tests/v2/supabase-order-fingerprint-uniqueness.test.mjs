import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../../supabase/migrations/20260729114500_order_fingerprint_nonunique.sql', import.meta.url),
  'utf8'
);

test('fingerprint deixa de ser identidade global do pedido', () => {
  assert.match(
    migration,
    /alter table armazem_v2_private\.orders\s+drop constraint if exists orders_fingerprint_key;/i
  );
  assert.match(
    migration,
    /create index if not exists armazem_v2_orders_fingerprint_idx\s+on armazem_v2_private\.orders \(fingerprint\);/i
  );
});

test('correção preserva as identidades de pedido e idempotência', () => {
  assert.doesNotMatch(migration, /drop constraint[^;]*(orders_pkey|idempotency_keys_pkey)/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete\s+from/i);
  assert.match(migration, /^begin;/i);
  assert.match(migration, /commit;\s*$/i);
});
