import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isStaticAssetRoute,
  probeStaticAssets,
  serveStaticAsset
} from '../../staging/site-v2-worker/src/static-assets-router.js';

const BASE_URL = 'https://staging.example.test';
const REQUEST_ID = 'static-routing-test';
const DESIGN_HTML = '<!doctype html><title>Escolha suas Artes | Armazém Festa e Eventos</title>';

function request(pathname, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('x-request-id', REQUEST_ID);
  return new Request(`${BASE_URL}${pathname}`, { ...init, headers });
}

test('classifica somente páginas e arquivos do design como rotas estáticas', () => {
  assert.equal(isStaticAssetRoute('/'), true);
  assert.equal(isStaticAssetRoute('/assets/favicon.svg'), true);
  assert.equal(isStaticAssetRoute('/tema/infantil'), true);

  assert.equal(isStaticAssetRoute('/health'), false);
  assert.equal(isStaticAssetRoute('/admin'), false);
  assert.equal(isStaticAssetRoute('/admin/app.css'), false);
  assert.equal(isStaticAssetRoute('/api/catalog-meta'), false);
  assert.equal(isStaticAssetRoute('/api/drive'), false);
  assert.equal(isStaticAssetRoute('/internal/v2/assets/probe'), false);
  assert.equal(isStaticAssetRoute('/internal/v2/orders/submit'), false);
});

test('encaminha a página inicial ao binding ASSETS sem transformar o HTML', async () => {
  const calls = [];
  const env = {
    ASSETS: {
      async fetch(received) {
        calls.push(received.url);
        return new Response(DESIGN_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' }
        });
      }
    }
  };

  const response = await serveStaticAsset(request('/'), env, REQUEST_ID);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], `${BASE_URL}/`);
  assert.equal(await response.text(), DESIGN_HTML);
});

test('encaminha arquivos estáticos ao binding ASSETS com o receptor correto', async () => {
  const calls = [];
  const assets = {
    async fetch(received) {
      assert.equal(this, assets);
      calls.push(new URL(received.url).pathname);
      return new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } });
    }
  };

  const response = await serveStaticAsset(request('/assets/favicon.svg'), { ASSETS: assets }, REQUEST_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['/assets/favicon.svg']);
});

test('bloqueia métodos de escrita em rotas estáticas', async () => {
  let assetCalls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        assetCalls += 1;
        return new Response('unexpected');
      }
    }
  };

  const response = await serveStaticAsset(request('/', { method: 'POST' }), env, REQUEST_ID);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  assert.equal(assetCalls, 0);
});

test('falha de forma sanitizada quando o binding ASSETS não está configurado', async () => {
  const response = await serveStaticAsset(request('/'), {}, REQUEST_ID);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'STAGING_ASSETS_NOT_CONFIGURED',
    requestId: REQUEST_ID
  });
});

test('falha de forma sanitizada quando o binding ASSETS lança erro', async () => {
  const logs = [];
  const env = {
    ASSETS: {
      async fetch() {
        throw new Error('conteúdo interno que não pode vazar');
      }
    }
  };

  const response = await serveStaticAsset(request('/'), env, REQUEST_ID, {
    logger: { error: message => logs.push(String(message)) }
  });
  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.equal(payload.error, 'STAGING_ASSET_FETCH_FAILED');
  assert.doesNotMatch(JSON.stringify(payload), /conteúdo interno/i);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /conteúdo interno/i);
});

test('probe consulta index explícito e raiz sem retornar o HTML', async () => {
  const calls = [];
  const assets = {
    async fetch(received) {
      assert.equal(this, assets);
      calls.push(new URL(received.url).pathname);
      return new Response(DESIGN_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
  };

  const response = await probeStaticAssets(request('/internal/v2/assets/probe'), { ASSETS: assets }, REQUEST_ID);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.bindingConfigured, true);
  assert.deepEqual(calls, ['/index.html', '/']);
  assert.equal(payload.probes.length, 2);
  assert.deepEqual(payload.probes.map(item => item.pathname), ['/index.html', '/']);
  for (const probe of payload.probes) {
    assert.equal(probe.responseReceived, true);
    assert.equal(probe.status, 200);
    assert.equal(probe.contentType, 'text/html');
    assert.equal(probe.titleMatched, true);
    assert.ok(probe.bodyBytes > 0);
    assert.equal(probe.error, '');
  }
  assert.doesNotMatch(JSON.stringify(payload), /<!doctype|Escolha suas Artes/i);
});

test('probe informa binding ausente sem falhar nem revelar configuração', async () => {
  const response = await probeStaticAssets(request('/internal/v2/assets/probe'), {}, REQUEST_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    requestId: REQUEST_ID,
    bindingConfigured: false,
    probes: []
  });
});

test('probe diferencia falha do index e da raiz sem vazar a exceção', async () => {
  const logs = [];
  const env = {
    ASSETS: {
      async fetch(received) {
        const pathname = new URL(received.url).pathname;
        if (pathname === '/index.html') throw new Error('segredo-interno-do-index');
        return new Response('gateway', { status: 502, headers: { 'content-type': 'text/plain' } });
      }
    }
  };

  const response = await probeStaticAssets(request('/internal/v2/assets/probe'), env, REQUEST_ID, {
    logger: { error: message => logs.push(String(message)) }
  });
  const payload = await response.json();
  assert.equal(payload.probes[0].pathname, '/index.html');
  assert.equal(payload.probes[0].responseReceived, false);
  assert.equal(payload.probes[0].error, 'STAGING_ASSET_FETCH_FAILED');
  assert.equal(payload.probes[1].pathname, '/');
  assert.equal(payload.probes[1].responseReceived, true);
  assert.equal(payload.probes[1].status, 502);
  assert.equal(payload.probes[1].titleMatched, false);
  assert.doesNotMatch(JSON.stringify(payload), /segredo-interno/i);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /segredo-interno/i);
});

test('probe aceita somente GET', async () => {
  const response = await probeStaticAssets(
    request('/internal/v2/assets/probe', { method: 'POST' }),
    {},
    REQUEST_ID
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('entrypoint roteia probe protegido e assets antes das rotas dinâmicas', async () => {
  const source = await readFile('staging/site-v2-worker/src/index-shadow.js', 'utf8');
  assert.match(source, /probeStaticAssets/);
  assert.match(source, /STATIC_ASSETS_PROBE_ROUTE = '\/internal\/v2\/assets\/probe'/);
  assert.match(source, /constantTimeEqualSecrets\([\s\S]*?request\.headers\.get\('x-staging-token'\)[\s\S]*?env\.STAGING_API_TOKEN/);
  assert.match(source, /return probeStaticAssets\(request, env, requestId\);/);
  const staticCheck = source.indexOf('if (isStaticAssetRoute(url.pathname))');
  const statusCheck = source.indexOf('const shadowStatus = supabaseShadowStatus(env);');
  assert.ok(staticCheck >= 0);
  assert.ok(statusCheck > staticCheck);
  assert.match(source, /return serveStaticAsset\(request, env, requestId\);/);
});

test('smoke remoto testa health e probe antes da página inicial', async () => {
  const source = await readFile('tests/v2/run-staging-accepted-catalog-remote-smoke.mjs', 'utf8');
  const health = source.indexOf("new URL('/health', STAGING_URL)");
  const probe = source.indexOf("new URL('/internal/v2/assets/probe', STAGING_URL)");
  const home = source.indexOf("new URL('/', STAGING_URL)");
  const metadata = source.indexOf("new URL('/api/catalog-meta', STAGING_URL)");
  assert.ok(health >= 0);
  assert.ok(probe > health);
  assert.ok(home > probe);
  assert.ok(metadata > home);
  assert.match(source, /'x-staging-token': STAGING_API_TOKEN/);
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*STAGING_API_TOKEN/);
});
