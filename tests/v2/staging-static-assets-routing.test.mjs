import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  isStaticAssetRoute,
  serveStaticAsset
} from '../../staging/site-v2-worker/src/static-assets-router.js';

const BASE_URL = 'https://staging.example.test';
const REQUEST_ID = 'static-routing-test';

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
  assert.equal(isStaticAssetRoute('/internal/v2/orders/submit'), false);
});

test('encaminha a página inicial ao binding ASSETS sem transformar o HTML', async () => {
  const calls = [];
  const env = {
    ASSETS: {
      async fetch(received) {
        calls.push(received.url);
        return new Response('<!doctype html><title>Escolha suas Artes | Armazém Festa e Eventos</title>', {
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
  assert.match(await response.text(), /Escolha suas Artes/);
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

test('entrypoint usa o roteador puro antes das rotas dinâmicas', async () => {
  const source = await readFile('staging/site-v2-worker/src/index-shadow.js', 'utf8');
  assert.match(source, /import \{ isStaticAssetRoute, serveStaticAsset \} from '\.\/static-assets-router\.js';/);
  const staticCheck = source.indexOf('if (isStaticAssetRoute(url.pathname))');
  const statusCheck = source.indexOf('const shadowStatus = supabaseShadowStatus(env);');
  assert.ok(staticCheck >= 0);
  assert.ok(statusCheck > staticCheck);
  assert.match(source, /return serveStaticAsset\(request, env, requestId\);/);
});
