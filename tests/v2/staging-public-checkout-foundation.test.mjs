import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  handlePublicCheckoutRoute,
  publicCheckoutStatus
} from '../../staging/site-v2-worker/src/public-checkout-route.js';

const ROUTE = 'https://new-hub-artres-v2-staging.example/api/orders/v2';
const requestId = 'checkout-foundation-test';

function request(options = {}) {
  return new Request(ROUTE, {
    method: options.method || 'POST',
    headers: options.headers || {},
    body: options.body,
    ...(options.body ? { duplex: 'half' } : {})
  });
}

async function payload(response) {
  return response.json();
}

test('status mantém checkout público desativado e incapaz de receber pedidos reais', () => {
  assert.deepEqual(publicCheckoutStatus({ ENVIRONMENT: 'staging' }), {
    enabled: false,
    implemented: false,
    stagingOnly: true,
    acceptsRealOrders: false,
    route: '/api/orders/v2',
    source: 'catalog-v2-accepted'
  });
});

test('rota aceita somente POST', async () => {
  const response = await handlePublicCheckoutRoute(
    request({ method: 'GET' }),
    { ENVIRONMENT: 'staging' },
    requestId
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.equal((await payload(response)).error, 'METHOD_NOT_ALLOWED');
});

test('rota não existe fora do staging', async () => {
  const response = await handlePublicCheckoutRoute(
    request(),
    { ENVIRONMENT: 'production', STAGING_PUBLIC_CHECKOUT_ENABLED: 'true' },
    requestId
  );

  assert.equal(response.status, 404);
  assert.equal((await payload(response)).error, 'PUBLIC_CHECKOUT_STAGING_ONLY');
});

test('flag desligada bloqueia antes de qualquer validação de corpo', async () => {
  const req = request({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ customer: { name: 'não deve ser lido' } })
  });

  const response = await handlePublicCheckoutRoute(
    req,
    { ENVIRONMENT: 'staging', STAGING_PUBLIC_CHECKOUT_ENABLED: 'false' },
    requestId
  );

  assert.equal(response.status, 503);
  assert.equal((await payload(response)).error, 'PUBLIC_CHECKOUT_DISABLED');
  assert.equal(req.bodyUsed, false);
});

test('flag ligada exige mesma origem', async () => {
  const response = await handlePublicCheckoutRoute(
    request({
      headers: {
        origin: 'https://origem-invalida.example',
        'content-type': 'application/json',
        'idempotency-key': 'checkout-test-key-0001'
      }
    }),
    { ENVIRONMENT: 'staging', STAGING_PUBLIC_CHECKOUT_ENABLED: 'true' },
    requestId
  );

  assert.equal(response.status, 403);
  assert.equal((await payload(response)).error, 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED');
});

test('flag ligada exige JSON e chave de idempotência válida', async () => {
  const invalidContent = await handlePublicCheckoutRoute(
    request({ headers: { 'idempotency-key': 'checkout-test-key-0001' } }),
    { ENVIRONMENT: 'staging', STAGING_PUBLIC_CHECKOUT_ENABLED: 'true' },
    requestId
  );
  assert.equal(invalidContent.status, 415);
  assert.equal((await payload(invalidContent)).error, 'CONTENT_TYPE_NOT_JSON');

  const invalidKey = await handlePublicCheckoutRoute(
    request({ headers: { 'content-type': 'application/json', 'idempotency-key': 'curta' } }),
    { ENVIRONMENT: 'staging', STAGING_PUBLIC_CHECKOUT_ENABLED: 'true' },
    requestId
  );
  assert.equal(invalidKey.status, 422);
  assert.equal((await payload(invalidKey)).error, 'IDEMPOTENCY_KEY_INVALID');
});

test('implementação ainda não cria pedido mesmo com todas as barreiras satisfeitas', async () => {
  const req = request({
    headers: {
      origin: 'https://new-hub-artres-v2-staging.example',
      'content-type': 'application/json',
      'idempotency-key': 'checkout-test-key-0001'
    },
    body: JSON.stringify({ items: [{ driveFileId: 'real-future-item' }] })
  });

  const response = await handlePublicCheckoutRoute(
    req,
    { ENVIRONMENT: 'staging', STAGING_PUBLIC_CHECKOUT_ENABLED: 'true' },
    requestId
  );

  assert.equal(response.status, 503);
  assert.equal((await payload(response)).error, 'PUBLIC_CHECKOUT_IMPLEMENTATION_PENDING');
  assert.equal(req.bodyUsed, false);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('Worker e configuração integram a rota somente com flag segura', async () => {
  const [entrypoint, wrangler] = await Promise.all([
    readFile('staging/site-v2-worker/src/index-shadow.js', 'utf8'),
    readFile('wrangler.site-v2-staging.jsonc', 'utf8')
  ]);

  assert.match(entrypoint, /const PUBLIC_CHECKOUT_ROUTE = '\/api\/orders\/v2';/);
  assert.match(entrypoint, /handlePublicCheckoutRoute\(request, env, requestId\)/);
  assert.match(entrypoint, /publicCheckout: checkoutStatus/);
  assert.match(wrangler, /"STAGING_PUBLIC_CHECKOUT_ENABLED": "false"/);
  assert.doesNotMatch(wrangler, /"STAGING_PUBLIC_CHECKOUT_ENABLED": "true"/);
});
