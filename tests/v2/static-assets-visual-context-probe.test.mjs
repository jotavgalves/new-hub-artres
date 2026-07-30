import assert from 'node:assert/strict';
import test from 'node:test';

import { probeStaticAssets } from '../../staging/site-v2-worker/src/static-assets-router.js';

const TITLE = '<title>Escolha suas Artes | Armazém Festa e Eventos</title>';
const CONTEXT = 'site-v2-visual-checkout-context-v1';
const BRIDGE = 'site-v2-visual-checkout-bridge-v1';

function environment(overrides = {}) {
  const bodies = {
    '/index.html': `<!doctype html><html><head>${TITLE}</head><body></body></html>`,
    '/': `<!doctype html><html><head>${TITLE}</head><body></body></html>`,
    '/assets/v2-checkout-context.js': `const marker='${CONTEXT}';`,
    '/assets/v2-checkout-bridge.js': `const marker='${BRIDGE}';`,
    ...overrides
  };

  return {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (!Object.hasOwn(bodies, pathname)) return new Response('missing', { status: 404 });
        const script = pathname.endsWith('.js');
        return new Response(bodies[pathname], {
          status: 200,
          headers: {
            'Content-Type': script ? 'application/javascript; charset=utf-8' : 'text/html; charset=utf-8'
          }
        });
      }
    }
  };
}

test('aprova somente quando index, raiz, contexto e bridge estão íntegros', async () => {
  const response = await probeStaticAssets(
    new Request('https://staging.example/internal/v2/assets/probe'),
    environment(),
    'probe-ok'
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.bindingConfigured, true);
  assert.equal(payload.probes.length, 4);
  assert.deepEqual(payload.probes.map(probe => probe.pathname), [
    '/index.html',
    '/',
    '/assets/v2-checkout-context.js',
    '/assets/v2-checkout-bridge.js'
  ]);
  assert.equal(payload.probes.every(probe => probe.markerMatched === true), true);
});

test('falha fechado quando o contexto visual publicado não contém o marcador esperado', async () => {
  const response = await probeStaticAssets(
    new Request('https://staging.example/internal/v2/assets/probe'),
    environment({ '/assets/v2-checkout-context.js': 'arquivo incorreto' }),
    'probe-context-invalid'
  );
  const payload = await response.json();
  const contextProbe = payload.probes.find(probe => probe.pathname === '/assets/v2-checkout-context.js');

  assert.equal(response.status, 200);
  assert.equal(payload.ok, false);
  assert.equal(contextProbe.ok, true);
  assert.equal(contextProbe.markerMatched, false);
});

test('falha fechado quando o bridge não está disponível', async () => {
  const env = environment();
  const originalFetch = env.ASSETS.fetch;
  env.ASSETS.fetch = request => {
    if (new URL(request.url).pathname === '/assets/v2-checkout-bridge.js') {
      return new Response('missing', { status: 404 });
    }
    return originalFetch(request);
  };

  const response = await probeStaticAssets(
    new Request('https://staging.example/internal/v2/assets/probe'),
    env,
    'probe-bridge-missing'
  );
  const payload = await response.json();

  assert.equal(payload.ok, false);
  assert.equal(
    payload.probes.find(probe => probe.pathname === '/assets/v2-checkout-bridge.js').status,
    404
  );
});
