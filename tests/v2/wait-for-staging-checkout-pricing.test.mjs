import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateStagingCheckoutPricing,
  waitForStagingCheckoutPricing
} from './wait-for-staging-checkout-pricing.mjs';

function readyPayload(overrides = {}) {
  return {
    ok: true,
    dryRun: true,
    writesPerformed: false,
    authoritativePricing: true,
    catalogVersion: 49,
    pricing: {
      currency: 'BRL',
      itemCount: 1,
      quantity: 6,
      subtotal: 58.5,
      discountPercent: 0,
      discountAmount: 0,
      total: 58.5,
      catalogVersion: 49,
      configVersion: 9001,
      clientValuesIgnored: true
    },
    warnings: ['CLIENT_ITEM_PRICE_IGNORED', 'CLIENT_ORDER_TOTALS_IGNORED'],
    ...overrides
  };
}

test('classifica contrato antigo como propagação pendente', () => {
  const validation = validateStagingCheckoutPricing({
    status: 200,
    payload: {
      ok: true,
      dryRun: true,
      writesPerformed: false,
      catalogVersion: 49
    }
  }, 49);

  assert.deepEqual(validation, {
    ok: false,
    terminal: false,
    code: 'CHECKOUT_PRICING_CONTRACT_NOT_READY'
  });
});

test('exige três respostas completas e consecutivas', async () => {
  const responses = [
    { status: 200, payload: { ok: true, dryRun: true, writesPerformed: false } },
    { status: 200, payload: readyPayload() },
    { status: 502, payload: null },
    { status: 200, payload: readyPayload() },
    { status: 200, payload: readyPayload() },
    { status: 200, payload: readyPayload() }
  ];
  let calls = 0;
  let sleeps = 0;

  const result = await waitForStagingCheckoutPricing({
    expectedCatalogVersion: 49,
    attempts: 10,
    stableResponses: 3,
    intervalMs: 0,
    request: async () => responses[calls++],
    sleep: async () => { sleeps += 1; }
  });

  assert.equal(result.payload.pricing.total, 58.5);
  assert.equal(calls, 6);
  assert.equal(sleeps, 5);
});

test('rejeita autenticação inválida imediatamente', async () => {
  let calls = 0;
  await assert.rejects(
    waitForStagingCheckoutPricing({
      expectedCatalogVersion: 49,
      attempts: 20,
      intervalMs: 0,
      request: async () => {
        calls += 1;
        return { status: 401, payload: { error: 'não deve ser exposto' } };
      },
      sleep: async () => {}
    }),
    error => error.code === 'CHECKOUT_PRICING_AUTH_FAILED'
  );
  assert.equal(calls, 1);
});

test('timeout mantém somente código sanitizado', async () => {
  await assert.rejects(
    waitForStagingCheckoutPricing({
      expectedCatalogVersion: 49,
      attempts: 3,
      stableResponses: 2,
      intervalMs: 0,
      request: async () => ({
        status: 200,
        payload: { customer: 'Cliente Particular', token: 'segredo' }
      }),
      sleep: async () => {}
    }),
    error => {
      assert.equal(error.code, 'CHECKOUT_PRICING_PROPAGATION_TIMEOUT');
      assert.equal(error.lastCode, 'CHECKOUT_PRICING_CONTRACT_NOT_READY');
      assert.equal(error.message.includes('Cliente Particular'), false);
      assert.equal(error.message.includes('segredo'), false);
      return true;
    }
  );
});

test('detecta divergências de versão valores e avisos', () => {
  assert.equal(
    validateStagingCheckoutPricing({ status: 200, payload: readyPayload({ catalogVersion: 48 }) }, 49).code,
    'CHECKOUT_PRICING_VERSION_NOT_READY'
  );
  assert.equal(
    validateStagingCheckoutPricing({
      status: 200,
      payload: readyPayload({ pricing: { ...readyPayload().pricing, total: 0.01 } })
    }, 49).code,
    'CHECKOUT_PRICING_VALUES_NOT_READY'
  );
  assert.equal(
    validateStagingCheckoutPricing({
      status: 200,
      payload: readyPayload({ warnings: [] })
    }, 49).code,
    'CHECKOUT_PRICING_WARNINGS_NOT_READY'
  );
});
