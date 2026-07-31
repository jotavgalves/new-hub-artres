import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MIGRATION = 'supabase/migrations/20260731082000_catalog_product_drive_roots_strict.sql';
const BOLINHAS_ROOT = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';
const PANEL_ROOT = '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-';
const TEST_ROOT = '1QgF0Wmvh1OLSOGCZMk-XQ4TfvQAcbLIz';

test('cada produto possui uma única raiz de Drive autoritativa', async () => {
  const sql = await readFile(MIGRATION, 'utf8');

  assert.match(sql, new RegExp(BOLINHAS_ROOT));
  assert.match(sql, new RegExp(PANEL_ROOT.replace(/[-]/g, '\\-')));
  assert.doesNotMatch(sql, new RegExp(TEST_ROOT));
  assert.match(sql, /scope', 'bolinhas-drive-root'/);
  assert.match(sql, /scope', 'strict-product-drive-roots'/);
});

test('Bolinhas falha fechado fora da raiz e ignora o productKey legado dos itens', async () => {
  const sql = await readFile(MIGRATION, 'utf8');

  assert.match(sql, /create or replace function public\.armazem_v2_catalog_route_v1/);
  assert.match(sql, /create or replace function public\.armazem_v2_catalog_search_v1/);
  assert.match(sql, /CATALOG_BOLINHAS_SCOPE_INVALID/);
  assert.match(sql, /CATALOG_BOLINHAS_FOLDER_OUTSIDE_ROOT/);
  assert.match(sql, /'product', '50x50'/);
  assert.match(sql, /'catalogRootDriveId', v_root/);
  assert.match(sql, /'rootVerified', true/);
  assert.match(sql, /'sizeKey', '50X50'/);
});

test('checkout recalcula produto, raiz e tamanho por ancestralidade', async () => {
  const sql = await readFile(MIGRATION, 'utf8');

  assert.match(sql, /with recursive\s+bolinhas_folders/i);
  assert.match(sql, /panel_folders\(drive_id\)/);
  assert.match(sql, /when bolinhas\.drive_id is not null and panel\.drive_id is null then '50x50'/);
  assert.match(sql, /when panel\.drive_id is not null and bolinhas\.drive_id is null then 'painel-150'/);
  assert.match(sql, /where item\.canonical_product_key is not null/);
  assert.match(sql, /'resolvedCount', jsonb_array_length\(v_items\)/);
});

test('funções continuam restritas ao service_role', async () => {
  const sql = await readFile(MIGRATION, 'utf8');

  assert.match(sql, /revoke all on function public\.armazem_v2_catalog_route_v1[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.armazem_v2_catalog_search_v1[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.armazem_v2_catalog_checkout_items_v1[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.armazem_v2_catalog_route_v1[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to anon/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to authenticated/i);
});
