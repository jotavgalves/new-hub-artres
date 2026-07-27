import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCatalogPageUrl,
  catalogReadStatus,
  createSupabaseCatalogSource
} from '../../src/v2/catalog/supabase-catalog-source.mjs';

const serviceKey = 'catalog-service-key-0123456789abcdef';
const baseUrl = 'https://catalog-project.supabase.co';
const rootDriveId = 'root-drive-50x50';
const roots = [{
  rootDriveId,
  productKey: '50x50',
  productName: 'Bolinhas 50x50',
  active: true
}];

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) }
  });
}

test('status aceita somente aliases específicos do catálogo', () => {
  const genericOnly = catalogReadStatus({
    CATALOG_V2_READ_ENABLED: 'true',
    SUPABASE_REST_URL: baseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey
  });
  assert.equal(genericOnly.enabled, true);
  assert.equal(genericOnly.configured, false);
  assert.equal(genericOnly.genericAliasesAccepted, false);
  assert.equal(genericOnly.valuesExposed, false);

  const specific = catalogReadStatus({
    CATALOG_V2_READ_ENABLED: 'true',
    ARTS_SUPABASE_URL: baseUrl,
    ARTS_SUPABASE_SERVICE_KEY: serviceKey
  });
  assert.equal(specific.configured, true);
  assert.deepEqual(specific.aliases, {
    url: 'ARTS_SUPABASE_URL',
    key: 'ARTS_SUPABASE_SERVICE_KEY'
  });
  assert.equal(JSON.stringify(specific).includes(serviceKey), false);
  assert.equal(JSON.stringify(specific).includes(baseUrl), false);
});

test('URL de consulta filtra uma raiz, exclui deletados e pagina', () => {
  const url = new URL(buildCatalogPageUrl(baseUrl, {
    rootDriveId,
    limit: 250,
    offset: 500
  }));

  assert.equal(url.origin, baseUrl);
  assert.equal(url.pathname, '/rest/v1/catalog_index');
  assert.equal(url.searchParams.get('root_drive_id'), `eq.${rootDriveId}`);
  assert.equal(url.searchParams.get('deleted_at'), 'is.null');
  assert.equal(url.searchParams.get('limit'), '250');
  assert.equal(url.searchParams.get('offset'), '500');
  assert.equal(url.searchParams.get('order'), 'depth.asc,name.asc,drive_id.asc');
  assert.ok(url.searchParams.get('select').includes('thumbnail_url'));
  assert.equal(url.toString().includes(serviceKey), false);
});

test('fonte usa somente GET e converte linhas para o contrato V2', async () => {
  const calls = [];
  const pages = [
    [
      {
        drive_id: 'folder-bosque',
        parent_drive_id: rootDriveId,
        root_drive_id: rootDriveId,
        type: 'folder',
        name: 'Bosque',
        depth: 1,
        theme: 'Bosque',
        product: '50x50',
        path: 'Bosque',
        deleted_at: null
      },
      {
        drive_id: 'artwork-0001',
        parent_drive_id: 'folder-bosque',
        root_drive_id: rootDriveId,
        type: 'artwork',
        name: '0001_BOSQUE_50X50.png',
        mime_type: 'image/png',
        depth: 2,
        theme: 'Bosque',
        product: '50x50',
        size: '50x50',
        code: '0001',
        drive_url: 'https://drive.google.com/file/d/artwork-0001/view',
        thumbnail_url: 'https://images.example.invalid/artwork-0001.png',
        path: 'Bosque/0001_BOSQUE_50X50.png',
        indexed_at: '2026-07-27T12:00:00.000Z',
        deleted_at: null
      }
    ],
    []
  ];

  const source = createSupabaseCatalogSource({
    url: baseUrl,
    serviceKey,
    pageSize: 2,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(pages.shift());
    }
  });

  const result = await source.listRoot({
    rootDriveId,
    catalogVersion: 49,
    roots
  });

  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.catalogVersion, 49);
  assert.equal(result.folders.length, 1);
  assert.equal(result.artworks.length, 1);
  assert.equal(result.artworks[0].driveFileId, 'artwork-0001');
  assert.equal(result.artworks[0].productKey, '50x50');
  assert.equal(result.source.readOnly, true);
  assert.equal(result.source.rowCount, 2);
  assert.equal(result.source.valuesExposed, false);

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.headers.apikey, serviceKey);
    assert.equal(call.options.headers.Authorization, `Bearer ${serviceKey}`);
    assert.equal(call.options.body, undefined);
    assert.equal(call.url.includes(serviceKey), false);
  }
  assert.equal(JSON.stringify(result).includes(serviceKey), false);
});

test('linha fora da raiz solicitada nunca é aceita silenciosamente', async () => {
  const source = createSupabaseCatalogSource({
    url: baseUrl,
    serviceKey,
    fetchImpl: async () => jsonResponse([{
      drive_id: 'foreign-artwork',
      parent_drive_id: 'foreign-folder',
      root_drive_id: 'another-root',
      type: 'artwork',
      name: '9999.png',
      code: '9999',
      product: '50x50',
      deleted_at: null
    }])
  });

  const result = await source.listRoot({
    rootDriveId,
    catalogVersion: 49,
    roots
  });

  assert.equal(result.acceptedCount, 0);
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.rejected[0].error, 'ROOT_DRIVE_NOT_CONFIGURED');
});

test('resposta excessiva é rejeitada sem incluir corpo ou segredo no erro', async () => {
  const hugePayload = [{
    drive_id: 'artwork-large',
    root_drive_id: rootDriveId,
    type: 'artwork',
    code: 'LARGE',
    name: 'x'.repeat(6000),
    product: '50x50'
  }];
  const source = createSupabaseCatalogSource({
    url: baseUrl,
    serviceKey,
    maxResponseBytes: 1024,
    fetchImpl: async () => jsonResponse(hugePayload)
  });

  await assert.rejects(
    source.listRoot({ rootDriveId, catalogVersion: 49, roots }),
    error => {
      assert.equal(error.code, 'CATALOG_SOURCE_RESPONSE_TOO_LARGE');
      assert.equal(String(error.message).includes(serviceKey), false);
      assert.equal(String(error.message).includes('xxxx'), false);
      return true;
    }
  );
});

test('erros HTTP são sanitizados e URL sem HTTPS é recusada', async () => {
  assert.throws(
    () => createSupabaseCatalogSource({ url: 'http://catalog.invalid', serviceKey }),
    error => error.code === 'CATALOG_SUPABASE_URL_INVALID'
  );

  const source = createSupabaseCatalogSource({
    url: baseUrl,
    serviceKey,
    fetchImpl: async () => jsonResponse({ message: `não expor ${serviceKey}` }, { status: 503 })
  });

  await assert.rejects(
    source.listRoot({ rootDriveId, catalogVersion: 49, roots }),
    error => {
      assert.equal(error.code, 'CATALOG_SOURCE_HTTP_503');
      assert.equal(String(error.message).includes(serviceKey), false);
      return true;
    }
  );
});
