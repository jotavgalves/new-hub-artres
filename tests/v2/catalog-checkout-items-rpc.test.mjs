import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  'supabase/migrations/20260729130000_catalog_checkout_items_rpc.sql',
  'utf8'
);

test('RPC de checkout lê exclusivamente a versão aceita', () => {
  assert.match(sql, /select accepted_version[\s\S]*from armazem_v2_private\.catalog_state/i);
  assert.match(sql, /item\.catalog_version = v_version/i);
  assert.match(sql, /item\.drive_file_id = any\(v_ids\)/i);
  assert.doesNotMatch(sql, /insert\s+into|update\s+armazem_v2_private|delete\s+from|truncate/i);
});

test('RPC limita a requisição e normaliza IDs duplicados', () => {
  assert.match(sql, /v_requested_count < 1 or v_requested_count > 200/i);
  assert.match(sql, /length\(btrim\(drive_file_id\)\) > 500/i);
  assert.match(sql, /group by btrim\(supplied\.drive_file_id\)/i);
  assert.match(sql, /requestedUniqueCount/i);
});

test('RPC devolve os campos canônicos usados pelo pedido V2', () => {
  for (const field of [
    'driveFileId',
    'code',
    'originalName',
    'theme',
    'subtheme',
    'productKey',
    'productName',
    'sizeKey'
  ]) {
    assert.match(sql, new RegExp(`'${field}'`, 'i'));
  }
});

test('RPC permanece restrita ao service_role', () => {
  assert.match(sql, /ARMAZEM_V2_SERVICE_ROLE_REQUIRED/);
  assert.match(
    sql,
    /revoke all on function public\.armazem_v2_catalog_checkout_items_v1\(text\[\]\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /grant execute on function public\.armazem_v2_catalog_checkout_items_v1\(text\[\]\)[\s\S]*to service_role/i
  );
});
