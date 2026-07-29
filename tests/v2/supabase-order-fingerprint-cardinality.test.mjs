import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MIGRATION = 'supabase/migrations/20260729124500_allow_repeated_order_fingerprints.sql';
const FOUNDATION = 'supabase/migrations/20260727194000_armazem_v2_projection_foundation.sql';

async function readOptional(path) {
  return readFile(path, 'utf8').catch(() => '');
}

test('remove somente a unicidade global do fingerprint e mantém índice de consulta', async () => {
  const sql = await readFile(MIGRATION, 'utf8');
  assert.match(sql, /alter table armazem_v2_private\.orders[\s\S]*drop constraint if exists orders_fingerprint_key/i);
  assert.match(sql, /create index if not exists orders_fingerprint_idx[\s\S]*orders\s*\(fingerprint\)/i);
  assert.doesNotMatch(sql, /create\s+unique\s+index/i);
  assert.doesNotMatch(sql, /drop\s+constraint[^;]*(orders_pkey|orders_order_code_key|orders_display_id_key)/i);
  assert.doesNotMatch(sql, /delete\s+from|truncate|update\s+armazem_v2_private\.orders/i);
});

test('documenta que replay continua controlado pela idempotência, não pelo conteúdo global', async () => {
  const sql = await readFile(MIGRATION, 'utf8');
  assert.match(sql, /identidade de replay permanece vinculada à chave de[\s\S]*idempotência/i);

  const foundation = await readOptional(FOUNDATION);
  if (foundation) {
    assert.match(foundation, /idempotency_keys/i);
    assert.match(foundation, /primary key\s*\(idempotency_key\)|idempotency_key\s+text\s+primary key/i);
  }
});

test('a migration é idempotente e preserva validação do formato do fingerprint', async () => {
  const sql = await readFile(MIGRATION, 'utf8');
  assert.match(sql, /drop constraint if exists/i);
  assert.match(sql, /create index if not exists/i);
  assert.doesNotMatch(sql, /drop constraint if exists armazem_v2_orders_fingerprint_format/i);
});
