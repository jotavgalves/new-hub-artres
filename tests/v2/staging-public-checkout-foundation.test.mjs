import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  handlePublicCheckoutRoute,
  publicCheckoutStatus
} from '../../staging/site-v2-worker/src/public-checkout-route.js';
import { createPublicCheckoutRateLimitKey } from '../../staging/site-v2-worker/src/public-checkout-protection.js';

const ROUTE = 'https://new-hub-artres-v2-staging.example/api/orders/v2';
const ORIGIN = new URL(ROUTE).origin;
const requestId = 'checkout-foundation-test';

function request(options = {}) {
  return new Request(ROUTE, {
    method: options.method || 'POST',
    headers: options.headers || {},
    body: options.body,
    ...(options.body ? { duplex: 'half' } : {})
  });
}

function limiter(success = true, calls = []) {
  return {
    async limit(input) {
      calls.push(input);
      return { success };
    }
  };
}

function stagingEnv(overrides = {}) {
  return {
    ENVIRONMENT: 'staging',
    STAGING_PUBLIC_CHECKOUT_ENABLED: 'false',
    PUBLIC_CHECKOUT_ALLOWED_ORIGINS: ORIGIN,
    PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: limiter(true),
    ...overrides
  };
}

function validHeaders(overrides = {}) {
  return {
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'idempotency-key': 'checkout-test-key-0001',
    ...overrides
  };
}

async function payload(response) {
  return response.json();
}

test('status mantém checkout público desativado com proteção configurada', () => {
  assert.deepEqual(publicCheckoutStatus(stagingEnv()), {
    enabled: false,
    implemented: false,
    stagingOnly: true,
    acceptsRealOrders: false,
    route: '/api/orders/v2',
    source: 'catalog-v2-accepted',
    protection: {
      configured: true,
      requiresOrigin: true,
      allowedOriginCount: 1,
      rateLimiterConfigured: true,
      route: '/api/orders/v2',
      keyStrategy: 'route-and-idempotency-sha256'
    }
  });
});

test('rota aceita somente POST e retorna resposta sanitizada', async () => {
  const response = await handlePublicCheckoutRoute(
    request({ method: 'GET' }),
    stagingEnv(),
    requestId
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assert.deepEqual(await payload(response), {
    ok: false,
    error: 'METHOD_NOT_ALLOWED',
    requestId
  });
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

test('flag desligada valida proteção e não lê o corpo', async () => {
  const calls = [];
  const req = request({
    headers: validHeaders(),
    body: JSON.stringify({ customer: { name: 'não deve ser lido' } })
  });

  const response = await handlePublicCheckoutRoute(
    req,
    stagingEnv({ PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: limiter(true, calls) }),
    requestId
  );

  assert.equal(response.status, 503);
  assert.equal((await payload(response)).error, 'PUBLIC_CHECKOUT_DISABLED');
  assert.equal(req.bodyUsed, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].key, /^checkout:v2:[a-f0-9]{64}$/);
  assert.equal(calls[0].key.includes('checkout-test-key-0001'), false);
});

test('origem ausente ou cruzada é rejeitada antes do rate limit', async () => {
  for (const headers of [
    validHeaders({ origin: undefined }),
    validHeaders({ origin: 'https://origem-invalida.example', 'sec-fetch-site': 'cross-site' })
  ]) {
    const calls = [];
    const cleanHeaders = Object.fromEntries(
      Object.entries(headers).filter(([, value]) => value !== undefined)
    );
    const response = await handlePublicCheckoutRoute(
      request({ headers: cleanHeaders }),
      stagingEnv({ PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: limiter(true, calls) }),
      requestId
    );

    assert.equal(response.status, 403);
    assert.equal((await payload(response)).error, 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED');
    assert.equal(calls.length, 0);
  }
});

test('exige JSON e chave de idempotência válida antes do rate limit', async () => {
  const invalidContent = await handlePublicCheckoutRoute(
    request({ headers: validHeaders({ 'content-type': undefined }) }),
    stagingEnv(),
    requestId
  );
  assert.equal(invalidContent.status, 415);
  assert.equal((await payload(invalidContent)).error, 'CONTENT_TYPE_NOT_JSON');

  const invalidKey = await handlePublicCheckoutRoute(
    request({ headers: validHeaders({ 'idempotency-key': 'curta' }) }),
    stagingEnv(),
    requestId
  );
  assert.equal(invalidKey.status, 422);
  assert.equal((await payload(invalidKey)).error, 'IDEMPOTENCY_KEY_INVALID');
});

test('falha fechada quando origem ou limiter não estão configurados', async () => {
  const missingOriginConfig = await handlePublicCheckoutRoute(
    request({ headers: validHeaders() }),
    stagingEnv({ PUBLIC_CHECKOUT_ALLOWED_ORIGINS: '' }),
    requestId
  );
  assert.equal(missingOriginConfig.status, 503);
  assert.equal((await payload(missingOriginConfig)).error, 'PUBLIC_CHECKOUT_PROTECTION_NOT_CONFIGURED');

  const missingLimiter = await handlePublicCheckoutRoute(
    request({ headers: validHeaders() }),
    stagingEnv({ PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: undefined }),
    requestId
  );
  assert.equal(missingLimiter.status, 503);
  assert.equal((await payload(missingLimiter)).error, 'PUBLIC_CHECKOUT_PROTECTION_NOT_CONFIGURED');
});

test('rate limit retorna 429 sem expor a chave', async () => {
  const rawKey = 'checkout-private-key-0001';
  const response = await handlePublicCheckoutRoute(
    request({ headers: validHeaders({ 'idempotency-key': rawKey }) }),
    stagingEnv({ PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: limiter(false) }),
    requestId
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  const result = await payload(response);
  assert.deepEqual(result, {
    ok: false,
    error: 'PUBLIC_CHECKOUT_RATE_LIMITED',
    requestId
  });
  assert.equal(JSON.stringify(result).includes(rawKey), false);
});

test('indisponibilidade do limiter retorna 503 sanitizado', async () => {
  const response = await handlePublicCheckoutRoute(
    request({ headers: validHeaders() }),
    stagingEnv({
      PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: {
        async limit() {
          throw new Error('detalhe interno que não pode aparecer');
        }
      }
    }),
    requestId
  );

  assert.equal(response.status, 503);
  const result = await payload(response);
  assert.equal(result.error, 'PUBLIC_CHECKOUT_RATE_LIMIT_UNAVAILABLE');
  assert.equal(JSON.stringify(result).includes('detalhe interno'), false);
});

test('implementação continua sem criar pedido após todas as barreiras', async () => {
  const req = request({
    headers: validHeaders(),
    body: JSON.stringify({ items: [{ driveFileId: 'real-future-item' }] })
  });

  const response = await handlePublicCheckoutRoute(
    req,
    stagingEnv({ STAGING_PUBLIC_CHECKOUT_ENABLED: 'true' }),
    requestId
  );

  assert.equal(response.status, 503);
  assert.equal((await payload(response)).error, 'PUBLIC_CHECKOUT_IMPLEMENTATION_PENDING');
  assert.equal(req.bodyUsed, false);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
});

test('chave de rate limit é estável por rota e tentativa sem conter valor bruto', async () => {
  const first = await createPublicCheckoutRateLimitKey({
    route: '/api/orders/v2',
    idempotencyKey: 'checkout-test-key-0001'
  });
  const second = await createPublicCheckoutRateLimitKey({
    route: '/api/orders/v2',
    idempotencyKey: 'checkout-test-key-0001'
  });
  const different = await createPublicCheckoutRateLimitKey({
    route: '/api/orders/v2',
    idempotencyKey: 'checkout-test-key-0002'
  });

  assert.equal(first, second);
  assert.notEqual(first, different);
  assert.match(first, /^checkout:v2:[a-f0-9]{64}$/);
  assert.equal(first.includes('checkout-test-key-0001'), false);
});

test('Worker e configuração integram origem e binding mantendo flag desligada', async () => {
  const [entrypoint, wrangler] = await Promise.all([
    readFile('staging/site-v2-worker/src/index-shadow.js', 'utf8'),
    readFile('wrangler.site-v2-staging.jsonc', 'utf8')
  ]);

  assert.match(entrypoint, /const PUBLIC_CHECKOUT_ROUTE = '\/api\/orders\/v2';/);
  assert.match(entrypoint, /handlePublicCheckoutRoute\(request, env, requestId\)/);
  assert.match(entrypoint, /publicCheckout: checkoutStatus/);
  assert.match(wrangler, /"STAGING_PUBLIC_CHECKOUT_ENABLED": "false"/);
  assert.doesNotMatch(wrangler, /"STAGING_PUBLIC_CHECKOUT_ENABLED": "true"/);
  assert.match(wrangler, /"PUBLIC_CHECKOUT_ALLOWED_ORIGINS"/);
  assert.match(wrangler, /"PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER"/);
  assert.match(wrangler, /"limit": 8/);
  assert.match(wrangler, /"period": 60/);
});
