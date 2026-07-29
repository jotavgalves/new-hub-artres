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

test('status só fica configurado com URL HTTPS e segredo servidor', () => {
  assert.deepEqual(catalogAcceptedStatus(ENV), {
    enabled: true,
    configured: true,
    source: 'supabase-accepted-readonly',
    target: 'catalog-staging.supabase.co'
  });
  assert.equal(catalogAcceptedStatus({ ...ENV, SUPABASE_V2_SERVICE_ROLE_KEY: '' }).configured, false);
});

test('expõe metadados sanitizados usando o cliente RPC compartilhado', async () => {
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/catalog-meta'),
    ENV,
    'request-1',
    {
      fetch: async function (url, init) {
        assert.equal(this, globalThis);
        assert.equal(typeof url, 'string');
        assert.equal(url, 'https://catalog-staging.supabase.co/rest/v1/rpc/armazem_v2_catalog_status_v1');
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, undefined);
        assert.equal(init.headers['Content-Profile'], 'public');
        assert.equal(init.headers.Prefer, 'return=representation');
        assert.match(String(init.headers.Authorization), /^Bearer /);
        return Response.json({
          ok: true,
          configured: true,
          catalogVersion: 49,
          acceptedAt: '2026-07-29T01:00:00.000Z',
          routeCount: 998,
          folderCount: 499,
          itemCount: 4132
        });
      }
    }
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.catalogVersion, 49);
  assert.equal(payload.itemCount, 4132);
  assert.equal(payload.source, 'catalog_v2_accepted');
});

test('mantém o contrato da rota de temas armazenada no Supabase', async () => {
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/drive?mode=themes'),
    ENV,
    'request-2',
    {
      fetch: async (url, init) => {
        assert.equal(typeof url, 'string');
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

test('mapeia timeout e resposta grande sem expor detalhes internos', async () => {
  const timeoutResponse = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/catalog-meta'),
    ENV,
    'request-timeout',
    {
      fetch: async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
    }
  );
  assert.equal(timeoutResponse.status, 504);
  assert.equal((await timeoutResponse.json()).error, 'CATALOG_ACCEPTED_TIMEOUT');

  const largeResponse = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/catalog-meta'),
    { ...ENV, CATALOG_ACCEPTED_MAX_RESPONSE_BYTES: '1024' },
    'request-large',
    {
      fetch: async () => new Response('x'.repeat(2048), {
        status: 200,
        headers: { 'content-length': '2048' }
      })
    }
  );
  assert.equal(largeResponse.status, 502);
  assert.equal((await largeResponse.json()).error, 'CATALOG_ACCEPTED_RESPONSE_TOO_LARGE');
});

test('mapeia falha HTTP da RPC para código sanitizado', async () => {
  const response = await handleCatalogAcceptedPublicRoute(
    new Request('https://staging.example/api/catalog-meta'),
    ENV,
    'request-rpc-error',
    {
      fetch: async () => Response.json({
        code: 'PGRST500',
        message: 'detalhes internos em formato livre'
      }, { status: 500 })
    }
  );
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'CATALOG_ACCEPTED_RPC_500');
  assert.doesNotMatch(JSON.stringify(payload), /detalhes internos/i);
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
