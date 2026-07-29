import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handlePublicCheckoutRoute,
  publicCheckoutStatus
} from '../../staging/site-v2-worker/src/public-checkout-route.js';

const origin = 'https://new-hub-artres-v2-staging.jvgacontato.workers.dev';

function environment(overrides = {}) {
  return {
    ENVIRONMENT: 'staging',
    STAGING_WRITE_ENABLED: 'true',
    STAGING_PUBLIC_CHECKOUT_ENABLED: 'true',
    PUBLIC_CHECKOUT_ALLOWED_ORIGINS: origin,
    PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: {
      async limit() {
        return { success: true };
      }
    },
    ...overrides
  };
}

function request(overrides = {}) {
  return new Request(`${origin}/api/orders/v2`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'visual-checkout-test-0001',
      ...(overrides.headers || {})
    },
    body: JSON.stringify({ ok: true })
  });
}

async function body(response) {
  return response.json();
}

test('status confirma implementação staging e aceitação somente com proteções', () => {
  const active = publicCheckoutStatus(environment());
  assert.equal(active.enabled, true);
  assert.equal(active.implemented, true);
  assert.equal(active.stagingOnly, true);
  assert.equal(active.acceptsRealOrders, true);
  assert.equal(active.protection.configured, true);

  assert.equal(publicCheckoutStatus(environment({ STAGING_WRITE_ENABLED: 'false' })).acceptsRealOrders, false);
  assert.equal(publicCheckoutStatus(environment({ STAGING_PUBLIC_CHECKOUT_ENABLED: 'false' })).acceptsRealOrders, false);
  assert.equal(publicCheckoutStatus(environment({ PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: null })).acceptsRealOrders, false);
});

test('requisição válida é delegada ao mesmo submit aceito e preserva hook', async () => {
  const calls = [];
  const onOrderCommitted = () => {};
  const response = await handlePublicCheckoutRoute(
    request(),
    environment(),
    'request-public-1',
    {
      onOrderCommitted,
      async submit(receivedRequest, receivedEnv, requestId, options) {
        calls.push({ receivedRequest, receivedEnv, requestId, options });
        return new Response(JSON.stringify({
          ok: true,
          action: 'CREATED',
          orderNumber: 'PED2600001A'
        }), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
    }
  );

  assert.equal(response.status, 201);
  assert.equal((await body(response)).orderNumber, 'PED2600001A');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requestId, 'request-public-1');
  assert.equal(calls[0].receivedEnv.ENVIRONMENT, 'staging');
  assert.equal(calls[0].options.onOrderCommitted, onOrderCommitted);
});

test('flag desligada bloqueia antes da proteção e do submit', async () => {
  let submitted = false;
  const response = await handlePublicCheckoutRoute(
    request(),
    environment({ STAGING_PUBLIC_CHECKOUT_ENABLED: 'false' }),
    'request-disabled',
    {
      async submit() {
        submitted = true;
        throw new Error('SHOULD_NOT_SUBMIT');
      }
    }
  );

  assert.equal(response.status, 503);
  assert.equal((await body(response)).error, 'PUBLIC_CHECKOUT_DISABLED');
  assert.equal(submitted, false);
});

test('origem ausente ou cruzada e rate limit impedem o submit', async () => {
  let submitted = 0;
  const options = {
    async submit() {
      submitted += 1;
      return new Response('{}', { status: 201 });
    }
  };

  const missingOrigin = await handlePublicCheckoutRoute(
    request({ headers: { Origin: '' } }),
    environment(),
    'request-origin-missing',
    options
  );
  assert.equal(missingOrigin.status, 403);
  assert.equal((await body(missingOrigin)).error, 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED');

  const crossOrigin = await handlePublicCheckoutRoute(
    request({ headers: { Origin: 'https://example.invalid', 'Sec-Fetch-Site': 'cross-site' } }),
    environment(),
    'request-origin-cross',
    options
  );
  assert.equal(crossOrigin.status, 403);

  const limited = await handlePublicCheckoutRoute(
    request(),
    environment({
      PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER: {
        async limit() {
          return { success: false };
        }
      }
    }),
    'request-limited',
    options
  );
  assert.equal(limited.status, 429);
  assert.equal((await body(limited)).error, 'PUBLIC_CHECKOUT_RATE_LIMITED');
  assert.equal(submitted, 0);
});

test('produção e métodos diferentes continuam indisponíveis', async () => {
  const production = await handlePublicCheckoutRoute(
    request(),
    environment({ ENVIRONMENT: 'production' }),
    'request-production'
  );
  assert.equal(production.status, 404);

  const getRequest = new Request(`${origin}/api/orders/v2`, { method: 'GET' });
  const method = await handlePublicCheckoutRoute(getRequest, environment(), 'request-method');
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
});
