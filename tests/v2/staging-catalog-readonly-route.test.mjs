import test from 'node:test';
import assert from 'node:assert/strict';

import {
  catalogReadonlyBridgeStatus,
  handleCatalogReadonlyRoute
} from '../../staging/site-v2-worker/src/catalog-readonly-route.js';

const baseEnv = Object.freeze({
  CATALOG_READONLY_BRIDGE_ENABLED: 'false',
  CATALOG_LEGACY_BASE_URL: 'https://new-hub-artres.pages.dev',
  CATALOG_V2_ROOT_DRIVE_ID: '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  CATALOG_V2_PRODUCT_KEY: '50x50',
  CATALOG_V2_PRODUCT_NAME: 'Bolinhas 50x50',
  CATALOG_V2_STRUCTURE: 'theme-or-subtheme-images',
  CATALOG_READONLY_TIMEOUT_MS: '5000',
  CATALOG_READONLY_MAX_RESPONSE_BYTES: '2097152'
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function upstreamFetch(calls = []) {
  return function (url, options) {
    assert.equal(this, globalThis);
    calls.push({ url: String(url), options });
    const parsed = new URL(url);

    if (parsed.pathname === '/api/catalog-meta') {
      return Promise.resolve(jsonResponse({ ok: true, catalogVersion: 49 }));
    }

    if (parsed.pathname === '/api/drive') {
      return Promise.resolve(jsonResponse({
        ok: true,
        source: 'catalog_index',
        mode: 'items',
        product: '50x50',
        productName: 'Bolinhas 50x50',
        items: [{
          id: 'drive-file-2657',
          driveFileId: 'drive-file-2657',
          code: '2657',
          theme: '1 ANO',
          subtheme: 'Bolinhas',
          product: '50x50',
          size: '50x50',
          originalName: '2657_1-ANO_50X50.png',
          image: 'https://drive.google.com/thumbnail?id=drive-file-2657&sz=w1200',
          productFolderId: 'theme-folder-1'
        }]
      }));
    }

    return Promise.resolve(jsonResponse({ ok: false }, 404));
  };
}

async function body(response) {
  return response.json();
}

test('status informa ponte configurada, porém desativada', () => {
  assert.deepEqual(catalogReadonlyBridgeStatus(baseEnv), {
    enabled: false,
    configured: true,
    mode: 'legacy-public-readonly',
    target: 'new-hub-artres.pages.dev',
    rootConfigured: true
  });
});

test('flag desativada bloqueia antes de qualquer chamada externa', async () => {
  let fetchCalled = false;
  const response = await handleCatalogReadonlyRoute(
    new Request('https://staging.example/internal/v2/catalog/preview?mode=themes'),
    baseEnv,
    'request-disabled',
    {
      fetch() {
        fetchCalled = true;
        throw new Error('UNEXPECTED_FETCH');
      }
    }
  );

  assert.equal(response.status, 503);
  assert.equal(fetchCalled, false);
  assert.deepEqual(await body(response), {
    ok: false,
    error: 'CATALOG_READONLY_BRIDGE_DISABLED',
    requestId: 'request-disabled',
    readOnly: true
  });
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
});

test('ponte habilitada consulta somente endpoints públicos por GET', async () => {
  const calls = [];
  const response = await handleCatalogReadonlyRoute(
    new Request(
      'https://staging.example/internal/v2/catalog/preview' +
      '?mode=items&folderId=theme-folder-1&theme=1%20ANO&product=50x50&token=nao-sair'
    ),
    { ...baseEnv, CATALOG_READONLY_BRIDGE_ENABLED: 'true' },
    'request-enabled',
    { fetch: upstreamFetch(calls) }
  );

  const payload = await body(response);
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.requestId, 'request-enabled');
  assert.equal(payload.readOnly, true);
  assert.equal(payload.catalogVersion, 49);
  assert.equal(payload.v2.artworks.length, 1);
  assert.equal(payload.v2.artworks[0].driveFileId, 'drive-file-2657');
  assert.equal(payload.comparison.equivalent, true);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, 'https://new-hub-artres.pages.dev');
    assert.ok(['/api/drive', '/api/catalog-meta'].includes(url.pathname));
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.body, undefined);
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.url.includes('nao-sair'), false);
  }
});

test('configuração incompleta é bloqueada sem acessar rede', async () => {
  let fetchCalled = false;
  const response = await handleCatalogReadonlyRoute(
    new Request('https://staging.example/internal/v2/catalog/preview?mode=themes'),
    {
      ...baseEnv,
      CATALOG_READONLY_BRIDGE_ENABLED: 'true',
      CATALOG_V2_ROOT_DRIVE_ID: ''
    },
    'request-not-configured',
    {
      fetch() {
        fetchCalled = true;
        throw new Error('UNEXPECTED_FETCH');
      }
    }
  );

  assert.equal(response.status, 503);
  assert.equal(fetchCalled, false);
  assert.equal((await body(response)).error, 'CATALOG_READONLY_BRIDGE_NOT_CONFIGURED');
});

test('erro remoto é sanitizado e não devolve conteúdo upstream', async () => {
  const response = await handleCatalogReadonlyRoute(
    new Request('https://staging.example/internal/v2/catalog/preview?mode=themes'),
    { ...baseEnv, CATALOG_READONLY_BRIDGE_ENABLED: 'true' },
    'request-upstream-failed',
    {
      fetch: function () {
        return Promise.resolve(new Response(
          JSON.stringify({ message: 'dado interno sensível do upstream' }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }
        ));
      }
    }
  );

  const payload = await body(response);
  assert.equal(response.status, 502);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'LEGACY_CATALOG_HTTP_503');
  assert.equal(JSON.stringify(payload).includes('sensível'), false);
});
