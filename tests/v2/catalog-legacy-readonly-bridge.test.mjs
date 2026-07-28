import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchLegacyCatalogBridge,
  legacyCatalogBridgeStatus,
  legacyPayloadToRows
} from '../../src/v2/catalog/legacy-readonly-bridge.mjs';

const baseUrl = 'https://new-hub-artres.pages.dev';
const rootDriveId = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

function fixtureFetch(captured = []) {
  return function fetchSensitiveToReceiver(url, options) {
    assert.equal(this, globalThis);
    captured.push({ url: String(url), options });
    const parsed = new URL(url);

    if (parsed.pathname === '/api/catalog-meta') {
      return Promise.resolve(jsonResponse({
        ok: true,
        catalogVersion: 49,
        discountPercent: 0,
        confirmModal: true
      }));
    }

    if (parsed.pathname === '/api/drive') {
      return Promise.resolve(jsonResponse({
        ok: true,
        mode: 'items',
        source: 'catalog_index',
        theme: '1 ANO',
        product: '50x50',
        productName: 'Bolinhas 50x50',
        total: 1,
        items: [{
          id: 'drive-file-2657',
          driveFileId: 'drive-file-2657',
          code: '2657',
          theme: '1 ANO',
          subtheme: 'Bolinhas',
          product: '50x50',
          productName: 'Bolinhas 50x50',
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

test('ponte converte catálogo público para V2 e compara sem divergências', async () => {
  const captured = [];
  const result = await fetchLegacyCatalogBridge({
    baseUrl,
    rootDriveId,
    mode: 'items',
    query: {
      folderId: 'theme-folder-1',
      theme: '1 ANO',
      product: '50x50'
    },
    fetch: fixtureFetch(captured)
  });

  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.catalogVersion, 49);
  assert.equal(result.rootDriveId, rootDriveId);
  assert.equal(result.upstream.folderCount, 0);
  assert.equal(result.upstream.artworkCount, 1);
  assert.equal(result.v2.artworks.length, 1);
  assert.equal(result.v2.artworks[0].driveFileId, 'drive-file-2657');
  assert.equal(result.v2.artworks[0].productKey, '50x50');
  assert.equal(result.v2.artworks[0].sizeKey, '50x50');
  assert.equal(result.comparison.equivalent, true);
  assert.equal(result.comparison.valuesExposed, false);

  assert.equal(captured.length, 2);
  for (const call of captured) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.headers.Accept, 'application/json');
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.options.body, undefined);
  }
});

test('ponte encaminha somente parâmetros permitidos e nunca aceita URL arbitrária', async () => {
  const captured = [];
  await fetchLegacyCatalogBridge({
    baseUrl,
    rootDriveId,
    mode: 'search',
    query: {
      q: '2657 bolinhas',
      folderId: 'folder-safe',
      url: 'https://evil.example/',
      token: 'segredo-que-nao-pode-sair',
      authorization: 'Bearer segredo'
    },
    fetch: fixtureFetch(captured)
  });

  const driveCall = captured.find(call => new URL(call.url).pathname === '/api/drive');
  assert.ok(driveCall);
  const url = new URL(driveCall.url);
  assert.equal(url.origin, baseUrl);
  assert.equal(url.pathname, '/api/drive');
  assert.equal(url.searchParams.get('mode'), 'search');
  assert.equal(url.searchParams.get('q'), '2657 bolinhas');
  assert.equal(url.searchParams.get('folderId'), 'folder-safe');
  assert.equal(url.searchParams.has('url'), false);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.has('authorization'), false);
  assert.equal(driveCall.url.includes('segredo'), false);
});

test('modo themes ignora todos os parâmetros recebidos', async () => {
  const captured = [];
  await fetchLegacyCatalogBridge({
    baseUrl,
    rootDriveId,
    mode: 'themes',
    query: { q: 'nao-deve-sair', folderId: 'nao-deve-sair' },
    fetch: fixtureFetch(captured)
  });

  const driveUrl = new URL(captured.find(call => new URL(call.url).pathname === '/api/drive').url);
  assert.equal(driveUrl.searchParams.toString(), 'mode=themes');
});

test('configuração exige HTTPS, origem limpa e root configurado', async () => {
  assert.deepEqual(
    legacyCatalogBridgeStatus({
      enabled: 'false',
      baseUrl,
      rootDriveId
    }),
    {
      enabled: false,
      configured: true,
      mode: 'legacy-public-readonly',
      target: 'new-hub-artres.pages.dev',
      rootConfigured: true
    }
  );

  await assert.rejects(
    fetchLegacyCatalogBridge({
      baseUrl: 'http://new-hub-artres.pages.dev',
      rootDriveId,
      mode: 'themes',
      fetch: fixtureFetch()
    }),
    error => error?.code === 'LEGACY_CATALOG_BASE_URL_INVALID'
  );

  await assert.rejects(
    fetchLegacyCatalogBridge({
      baseUrl: `${baseUrl}/api/drive?token=segredo`,
      rootDriveId,
      mode: 'themes',
      fetch: fixtureFetch()
    }),
    error => error?.code === 'LEGACY_CATALOG_BASE_URL_INVALID'
  );
});

test('resposta acima do limite é rejeitada sem carregar conteúdo ilimitado', async () => {
  const oversizedFetch = function (url) {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/catalog-meta') {
      return Promise.resolve(jsonResponse({ ok: true, catalogVersion: 49 }));
    }
    return Promise.resolve(new Response('{}', {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '5000'
      }
    }));
  };

  await assert.rejects(
    fetchLegacyCatalogBridge({
      baseUrl,
      rootDriveId,
      mode: 'themes',
      maxResponseBytes: 1024,
      fetch: oversizedFetch
    }),
    error => error?.code === 'LEGACY_CATALOG_RESPONSE_TOO_LARGE'
  );
});

test('adaptação descarta linhas sem identidade e elimina duplicidades', () => {
  const rows = legacyPayloadToRows({
    folders: [
      { id: 'folder-1', name: 'Tema' },
      { id: 'folder-1', name: 'Tema duplicado' },
      { name: 'Sem id' }
    ],
    items: [
      { id: 'file-1', code: '1', image: 'https://example.invalid/1.png' },
      { driveFileId: 'file-1', code: '1' },
      { code: '2' }
    ]
  }, {
    rootDriveId,
    productKey: '50x50',
    productName: 'Bolinhas 50x50'
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => `${row.type}:${row.drive_id}`), [
    'folder:folder-1',
    'artwork:file-1'
  ]);
});
