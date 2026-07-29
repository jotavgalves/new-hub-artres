import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchStagingShadowWorker } from '../../staging/site-v2-worker/src/index-shadow.js';

const BASE_URL = 'https://staging.example.test';

function baseEnv(overrides = {}) {
  return {
    ENVIRONMENT: 'staging',
    STAGING_WRITE_ENABLED: 'false',
    STAGING_LOW_LEVEL_LEDGER_ENABLED: 'false',
    STAGING_API_TOKEN: 'staging-token-0123456789abcdef0123456789',
    SUPABASE_SHADOW_ENABLED: 'false',
    SUPABASE_V2_URL: 'https://example-project.supabase.co',
    SUPABASE_V2_SERVICE_ROLE_KEY: 'service-role-key-0123456789abcdef0123456789abcdef',
    SUPABASE_SHADOW_TIMEOUT_MS: '3500',
    CATALOG_ACCEPTED_ENABLED: 'true',
    CATALOG_ACCEPTED_TIMEOUT_MS: '5000',
    CATALOG_ACCEPTED_MAX_RESPONSE_BYTES: '8388608',
    CATALOG_READONLY_BRIDGE_ENABLED: 'false',
    CATALOG_READONLY_TIMEOUT_MS: '5000',
    CATALOG_READONLY_MAX_RESPONSE_BYTES: '2097152',
    ...overrides
  };
}

function request(pathname, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('x-request-id', 'static-routing-test');
  return new Request(`${BASE_URL}${pathname}`, { ...init, headers });
}

test('encaminha a página inicial ao binding ASSETS sem transformar o HTML', async () => {
  const calls = [];
  const env = baseEnv({
    ASSETS: {
      async fetch(received) {
        calls.push(received.url);
        return new Response('<!doctype html><title>Escolha suas Artes | Armazém Festa e Eventos</title>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
    }
  });

  const response = await fetchStagingShadowWorker(request('/'), env, {});
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `${BASE_URL}/`);
  assert.match(await response.text(), /Escolha suas Artes/);
});

test('encaminha arquivos estáticos ao binding ASSETS', async () => {
  const calls = [];
  const env = baseEnv({
    ASSETS: {
      async fetch(received) {
        calls.push(new URL(received.url).pathname);
        return new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } });
      }
    }
  });

  const response = await fetchStagingShadowWorker(request('/assets/favicon.svg'), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['/assets/favicon.svg']);
});

test('não encaminha health, admin ou APIs ao binding ASSETS', async () => {
  let assetCalls = 0;
  const env = baseEnv({
    ASSETS: {
      async fetch() {
        assetCalls += 1;
        return new Response('unexpected');
      }
    }
  });

  const health = await fetchStagingShadowWorker(request('/health'), env, {});
  assert.equal(health.status, 200);
  const healthPayload = await health.json();
  assert.equal(healthPayload.ok, true);
  assert.equal(healthPayload.acceptedCatalog.enabled, true);
  assert.equal(healthPayload.acceptedCatalog.configured, true);

  const admin = await fetchStagingShadowWorker(request('/admin'), env, {});
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /admin/i);

  const unknownApi = await fetchStagingShadowWorker(request('/api/unknown'), env, {});
  assert.equal(unknownApi.status, 404);
  assert.equal(assetCalls, 0);
});

test('bloqueia métodos de escrita em rotas estáticas', async () => {
  let assetCalls = 0;
  const env = baseEnv({
    ASSETS: {
      async fetch() {
        assetCalls += 1;
        return new Response('unexpected');
      }
    }
  });

  const response = await fetchStagingShadowWorker(request('/', { method: 'POST' }), env, {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  assert.equal(assetCalls, 0);
});

test('falha de forma sanitizada quando o binding ASSETS não está configurado', async () => {
  const response = await fetchStagingShadowWorker(request('/'), baseEnv(), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'STAGING_ASSETS_NOT_CONFIGURED',
    requestId: 'static-routing-test'
  });
});

test('falha de forma sanitizada quando o binding ASSETS lança erro', async () => {
  const env = baseEnv({
    ASSETS: {
      async fetch() {
        throw new Error('conteúdo interno que não pode vazar');
      }
    }
  });

  const response = await fetchStagingShadowWorker(request('/'), env, {});
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'STAGING_ASSET_FETCH_FAILED');
  assert.doesNotMatch(JSON.stringify(payload), /conteúdo interno/i);
});
