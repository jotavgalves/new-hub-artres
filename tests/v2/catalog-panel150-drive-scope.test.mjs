import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  handleCatalogAcceptedPublicRoute,
  PANEL_150_DRIVE_ROOT_ID,
  resolveRequestedProductKey
} from '../../staging/site-v2-worker/src/catalog-accepted-route.js';

const ENV = {
  CATALOG_ACCEPTED_ENABLED: 'true',
  SUPABASE_V2_URL: 'https://catalog-staging.supabase.co',
  SUPABASE_V2_SERVICE_ROLE_KEY: 'service-role-key-0123456789abcdef0123456789abcdef',
  CATALOG_ACCEPTED_TIMEOUT_MS: '5000',
  CATALOG_ACCEPTED_MAX_RESPONSE_BYTES: '8388608'
};

const PANEL_ROOT = '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-';

test('fixa o módulo Painel 150 cm na raiz de Drive aprovada', () => {
  assert.equal(PANEL_150_DRIVE_ROOT_ID, PANEL_ROOT);
  assert.equal(resolveRequestedProductKey(
    new Request('https://staging.example/api/drive?mode=themes&product=painel-150')
  ), 'painel-150');
});

test('leituras do Painel 150 usam RPC com escopo exato da raiz', async () => {
  let call = null;
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/drive?mode=themes&product=painel-150'),
    ENV,
    'panel-themes',
    {
      fetch: async (url, init) => {
        call = { url, body: JSON.parse(init.body) };
        return Response.json({
          ok: true,
          mode: 'themes',
          scope: 'panel150-drive-root',
          rootDriveId: PANEL_ROOT,
          folders: []
        });
      }
    }
  );

  assert.equal(response.status, 200);
  assert.match(call.url, /\/rpc\/armazem_v2_catalog_route_scoped_v1$/);
  assert.deepEqual(call.body, {
    p_mode: 'themes',
    p_folder_id: '',
    p_product_key: 'painel-150',
    p_root_drive_id: PANEL_ROOT
  });
});

test('pesquisa global herda a aba Painel 150 pelo referer da mesma origem', async () => {
  let call = null;
  const request = new Request('https://staging.example/api/drive?mode=globalSearch&q=arca', {
    headers: { referer: 'https://staging.example/?produto=painel-150' }
  });
  const response = await handleCatalogAcceptedPublicRoute(request, ENV, 'panel-search', {
    fetch: async (url, init) => {
      call = { url, body: JSON.parse(init.body) };
      return Response.json({ ok: true, mode: 'globalSearch', folders: [], items: [] });
    }
  });

  assert.equal(response.status, 200);
  assert.match(call.url, /\/rpc\/armazem_v2_catalog_search_scoped_v1$/);
  assert.equal(call.body.p_product_key, 'painel-150');
  assert.equal(call.body.p_root_drive_id, PANEL_ROOT);
});

test('referer externo não consegue selecionar o catálogo Painel 150', () => {
  const request = new Request('https://staging.example/api/drive?mode=globalSearch&q=arca', {
    headers: { referer: 'https://externo.example/?produto=painel-150' }
  });
  assert.equal(resolveRequestedProductKey(request), '50x50');
});

test('Bolinhas mantém a RPC aceita anterior sem receber a raiz de Painel 150', async () => {
  let call = null;
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/drive?mode=themes&product=50x50'),
    ENV,
    'bolinhas-themes',
    {
      fetch: async (url, init) => {
        call = { url, body: JSON.parse(init.body) };
        return Response.json({ ok: true, mode: 'themes', folders: [] });
      }
    }
  );

  assert.equal(response.status, 200);
  assert.match(call.url, /\/rpc\/armazem_v2_catalog_route_v1$/);
  assert.equal('p_root_drive_id' in call.body, false);
  assert.equal(call.body.p_product_key, '50x50');
});

test('migration aplica raiz, ancestralidade, reclassificação do checkout e privilégios mínimos', async () => {
  const sql = await readFile(
    'supabase/migrations/20260730195000_catalog_panel150_drive_scope.sql',
    'utf8'
  );

  assert.match(sql, /18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-/);
  assert.match(sql, /with recursive scoped_folders/i);
  assert.match(sql, /CATALOG_PANEL_150_FOLDER_OUTSIDE_ROOT/);
  assert.match(sql, /catalog-panel150-product:/);
  assert.match(sql, /when panel\.drive_id is not null then 'painel-150'/);
  assert.match(sql, /revoke all[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]+to anon/i);
});
