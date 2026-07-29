import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogAcceptedStatus,
  handleCatalogAcceptedPublicRoute,
  normalizeSearchText
} from '../../staging/site-v2-worker/src/catalog-accepted-route.js';

const ENV = {
  CATALOG_ACCEPTED_ENABLED: 'true',
  SUPABASE_V2_URL: 'https://catalog-staging.supabase.co',
  SUPABASE_V2_SERVICE_ROLE_KEY: 'service-role-key-0123456789abcdef0123456789abcdef',
  CATALOG_ACCEPTED_TIMEOUT_MS: '5000',
  CATALOG_ACCEPTED_MAX_RESPONSE_BYTES: '8388608'
};

const STATUS_PAYLOAD = {
  ok: true,
  configured: true,
  catalogVersion: 49,
  acceptedAt: '2026-07-29T01:00:00.000Z',
  routeCount: 998,
  folderCount: 499,
  itemCount: 4132
};

test('status só fica configurado com URL HTTPS e segredo servidor', () => {
  assert.deepEqual(catalogAcceptedStatus(ENV), {
    enabled: true,
    configured: true,
    source: 'supabase-accepted-readonly',
    target: 'catalog-staging.supabase.co'
  });
  assert.equal(catalogAcceptedStatus({ ...ENV, SUPABASE_V2_SERVICE_ROLE_KEY: '' }).configured, false);
});

test('expõe metadados sanitizados da versão aceita', async () => {
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/catalog-meta'),
    ENV,
    'request-1',
    {
      fetch: async (_url, init) => {
        assert.equal(init.method, 'POST');
        assert.match(String(init.headers.Authorization), /^Bearer /);
        assert.equal(init.headers['Content-Profile'], 'public');
        return Response.json(STATUS_PAYLOAD);
      }
    }
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.catalogVersion, 49);
  assert.equal(payload.itemCount, 4132);
  assert.equal(payload.source, 'catalog_v2_accepted');
});

test('usa fallback de texto quando a resposta não expõe stream getReader', async () => {
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/catalog-meta'),
    ENV,
    'request-fallback',
    {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: null,
        text: async () => JSON.stringify(STATUS_PAYLOAD)
      })
    }
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).catalogVersion, 49);
});

test('classifica exceção de transporte sem revelar mensagem interna', async () => {
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/catalog-meta'),
    ENV,
    'request-transport',
    {
      fetch: async () => {
        throw new TypeError('credencial e detalhe interno que não podem vazar');
      }
    }
  );

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'CATALOG_ACCEPTED_TRANSPORT_TYPEERROR');
  assert.doesNotMatch(JSON.stringify(payload), /credencial|detalhe interno/i);
});

test('mantém o contrato da rota de temas armazenada no Supabase', async () => {
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/drive?mode=themes'),
    ENV,
    'request-2',
    {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.p_mode, 'themes');
        return Response.json({ ok: true, mode: 'themes', source: 'catalog_index', folders: [{ id: 'tema-1' }] });
      }
    }
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).folders, [{ id: 'tema-1' }]);
});

test('normaliza a pesquisa antes de consultar a projeção aceita', async () => {
  assert.equal(normalizeSearchText('Fazendinha Ázul'), 'fazendinha azul');
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/drive?mode=search&q=Fazendinha%20%C3%81zul'),
    ENV,
    'request-3',
    {
      fetch: async (_url, init) => {
        const body = JSON.parse(init.body);
        assert.equal(body.p_query, 'fazendinha azul');
        return Response.json({ ok: true, mode: 'search', source: 'catalog_v2_accepted', total: 0, items: [] });
      }
    }
  );
  assert.equal(response.status, 200);
});

test('não consulta Supabase quando o catálogo aceito está desativado', async () => {
  let called = false;
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/drive?mode=themes'),
    { ...ENV, CATALOG_ACCEPTED_ENABLED: 'false' },
    'request-4',
    { fetch: async () => { called = true; } }
  );
  assert.equal(response.status, 503);
  assert.equal(called, false);
});
