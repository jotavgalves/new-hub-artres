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
const COMMERCIAL_SCRIPT = "const marker='site-v2-commercial-config-v1';";
const WORKSPACES_SCRIPT = "const marker='site-v2-product-workspaces-v1';";
const CONTEXT_SCRIPT = "const marker='site-v2-visual-checkout-context-v1';";
const WHATSAPP_SCRIPT = "const marker='site-v2-visual-checkout-whatsapp-v1';";
const BRIDGE_SCRIPT = "const marker='site-v2-visual-checkout-bridge-v1';";

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
  assert.equal(isStaticAssetRoute('/admin/commercial'), false);
  assert.equal(isStaticAssetRoute('/api/commercial-config'), false);
  assert.equal(isStaticAssetRoute('/internal/v2/assets/probe'), false);
});

test('encaminha a página inicial ao binding ASSETS sem transformar o HTML', async () => {
  const calls = [];
  const env = { ASSETS: { async fetch(received) {
    calls.push(received.url);
    return new Response(DESIGN_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  } } };
  const response = await serveStaticAsset(request('/'), env, REQUEST_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [`${BASE_URL}/`]);
  assert.equal(await response.text(), DESIGN_HTML);
});

test('encaminha arquivos estáticos ao binding ASSETS com o receptor correto', async () => {
  const calls = [];
  const assets = { async fetch(received) {
    assert.equal(this, assets);
    calls.push(new URL(received.url).pathname);
    return new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } });
  } };
  const response = await serveStaticAsset(request('/assets/favicon.svg'), { ASSETS: assets }, REQUEST_ID);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['/assets/favicon.svg']);
});

test('bloqueia métodos de escrita em rotas estáticas', async () => {
  let assetCalls = 0;
  const env = { ASSETS: { async fetch() { assetCalls += 1; return new Response('unexpected'); } } };
  const response = await serveStaticAsset(request('/', { method: 'POST' }), env, REQUEST_ID);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
  assert.equal(assetCalls, 0);
});

test('falha sanitizada quando o binding ASSETS não está configurado ou lança erro', async () => {
  const missing = await serveStaticAsset(request('/'), {}, REQUEST_ID);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, 'STAGING_ASSETS_NOT_CONFIGURED');

  const logs = [];
  const failed = await serveStaticAsset(request('/'), { ASSETS: { async fetch() { throw new Error('segredo'); } } }, REQUEST_ID, {
    logger: { error: message => logs.push(String(message)) }
  });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error, 'STAGING_ASSET_FETCH_FAILED');
  assert.doesNotMatch(logs[0], /segredo/);
});

test('probe consulta index, raiz, configuração, produtos e checkout sem retornar conteúdo', async () => {
  const calls = [];
  const scripts = {
    '/assets/v2-commercial-config.js': COMMERCIAL_SCRIPT,
    '/assets/v2-product-workspaces.js': WORKSPACES_SCRIPT,
    '/assets/v2-checkout-context.js': CONTEXT_SCRIPT,
    '/assets/v2-checkout-whatsapp.js': WHATSAPP_SCRIPT,
    '/assets/v2-checkout-bridge.js': BRIDGE_SCRIPT
  };
  const assets = { async fetch(received) {
    assert.equal(this, assets);
    const pathname = new URL(received.url).pathname;
    calls.push(pathname);
    if (Object.hasOwn(scripts, pathname)) {
      return new Response(scripts[pathname], { status: 200, headers: { 'content-type': 'application/javascript; charset=utf-8' } });
    }
    return new Response(DESIGN_HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  } };

  const response = await probeStaticAssets(request('/internal/v2/assets/probe'), { ASSETS: assets }, REQUEST_ID);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(calls, [
    '/index.html','/','/assets/v2-commercial-config.js','/assets/v2-product-workspaces.js',
    '/assets/v2-checkout-context.js','/assets/v2-checkout-whatsapp.js','/assets/v2-checkout-bridge.js'
  ]);
  assert.equal(payload.probes.length, 7);
  assert.equal(payload.probes.every(probe => probe.markerMatched === true), true);
  assert.equal(payload.probes[0].contentType, 'text/html');
  assert.equal(payload.probes[1].contentType, 'text/html');
  for (const probe of payload.probes.slice(2)) assert.equal(probe.contentType, 'application/javascript');
  assert.doesNotMatch(JSON.stringify(payload), /<!doctype|const marker|Escolha suas Artes/i);
});

test('probe informa binding ausente sem revelar configuração', async () => {
  const response = await probeStaticAssets(request('/internal/v2/assets/probe'), {}, REQUEST_ID);
  assert.deepEqual(await response.json(), { ok: true, requestId: REQUEST_ID, bindingConfigured: false, probes: [] });
});

test('probe diferencia falha do index e da raiz sem vazar a exceção', async () => {
  const logs = [];
  const env = { ASSETS: { async fetch(received) {
    const pathname = new URL(received.url).pathname;
    if (pathname === '/index.html') throw new Error('segredo-interno-do-index');
    return new Response('gateway', { status: 502, headers: { 'content-type': 'text/plain' } });
  } } };
  const response = await probeStaticAssets(request('/internal/v2/assets/probe'), env, REQUEST_ID, {
    logger: { error: message => logs.push(String(message)) }
  });
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.probes[0].responseReceived, false);
  assert.equal(payload.probes[0].error, 'STAGING_ASSET_FETCH_FAILED');
  assert.equal(payload.probes[1].status, 502);
  assert.doesNotMatch(JSON.stringify(payload), /segredo-interno/i);
  assert.doesNotMatch(logs[0], /segredo-interno/i);
});

test('probe aceita somente GET', async () => {
  const response = await probeStaticAssets(request('/internal/v2/assets/probe', { method: 'POST' }), {}, REQUEST_ID);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
});

test('entrypoint roteia configuração e probe antes das rotas dinâmicas', async () => {
  const source = await readFile('staging/site-v2-worker/src/index-shadow.js', 'utf8');
  assert.match(source, /PUBLIC_COMMERCIAL_CONFIG_ROUTE = '\/api\/commercial-config'/);
  assert.match(source, /ADMIN_COMMERCIAL_CONFIG_ROUTE = '\/internal\/v2\/admin\/commercial-config'/);
  assert.match(source, /return handlePublicCommercialConfig\(request, env, requestId\);/);
  assert.match(source, /return handleAdminCommercialConfig\(request, env, requestId\);/);
  assert.match(source, /return probeStaticAssets\(request, env, requestId\);/);
});

test('smoke remoto testa health e probe antes da página inicial', async () => {
  const source = await readFile('tests/v2/run-staging-accepted-catalog-remote-smoke.mjs', 'utf8');
  const health = source.indexOf("new URL('/health', STAGING_URL)");
  const probe = source.indexOf("new URL('/internal/v2/assets/probe', STAGING_URL)");
  const home = source.indexOf("new URL('/', STAGING_URL)");
  const metadata = source.indexOf("new URL('/api/catalog-meta', STAGING_URL)");
  assert.ok(health >= 0 && probe > health && home > probe && metadata > home);
  assert.match(source, /'x-staging-token': STAGING_API_TOKEN/);
  assert.doesNotMatch(source, /console\.(log|error)\([^\n]*STAGING_API_TOKEN/);
});
