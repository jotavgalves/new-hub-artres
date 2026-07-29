import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateStagingCheckoutProtection,
  waitForStagingCheckoutProtection
} from './wait-for-staging-checkout-protection.mjs';

function readyPayload(overrides = {}) {
  return {
    ok: true,
    publicCheckout: {
      enabled: true,
      implemented: true,
      acceptsRealOrders: true,
      protection: {
        configured: true,
        requiresOrigin: true,
        allowedOriginCount: 1,
        rateLimiterConfigured: true,
        keyStrategy: 'route-and-idempotency-sha256'
      }
    },
    ...overrides
  };
}

test('classifica versão desligada e binding ausente como propagação pendente', () => {
  assert.deepEqual(
    validateStagingCheckoutProtection({
      status: 200,
      payload: {
        ok: true,
        publicCheckout: {
          enabled: false,
          implemented: true,
          acceptsRealOrders: false
        }
      }
    }),
    {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_PROTECTION_ACTIVE_STATE_NOT_READY'
    }
  );

  const bindingPending = readyPayload();
  bindingPending.publicCheckout.protection.rateLimiterConfigured = false;
  bindingPending.publicCheckout.protection.configured = false;
  assert.equal(
    validateStagingCheckoutProtection({ status: 200, payload: bindingPending }).code,
    'PUBLIC_CHECKOUT_RATE_LIMIT_BINDING_NOT_READY'
  );
});

test('exige três respostas ativas completas e consecutivas', async () => {
  const oldDisabled = readyPayload();
  oldDisabled.publicCheckout.enabled = false;
  oldDisabled.publicCheckout.acceptsRealOrders = false;

  const responses = [
    { status: 200, payload: { ok: true } },
    { status: 200, payload: readyPayload() },
    { status: 200, payload: oldDisabled },
    { status: 200, payload: readyPayload() },
    { status: 200, payload: readyPayload() },
    { status: 200, payload: readyPayload() }
  ];
  let calls = 0;
  let sleeps = 0;

  const payload = await waitForStagingCheckoutProtection({
    attempts: 10,
    stableResponses: 3,
    intervalMs: 0,
    request: async () => responses[calls++],
    sleep: async () => { sleeps += 1; }
  });

  assert.equal(payload.publicCheckout.enabled, true);
  assert.equal(payload.publicCheckout.acceptsRealOrders, true);
  assert.equal(payload.publicCheckout.protection.configured, true);
  assert.equal(calls, 6);
  assert.equal(sleeps, 5);
});

test('estado desligado não é aceito como proteção pronta', () => {
  const disabled = readyPayload();
  disabled.publicCheckout.enabled = false;
  disabled.publicCheckout.acceptsRealOrders = false;

  assert.deepEqual(
    validateStagingCheckoutProtection({ status: 200, payload: disabled }),
    {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_PROTECTION_ACTIVE_STATE_NOT_READY'
    }
  );
});

test('timeout mantém o último código sanitizado', async () => {
  const pending = readyPayload();
  pending.publicCheckout.protection.allowedOriginCount = 0;
  pending.publicCheckout.protection.configured = false;

  await assert.rejects(
    waitForStagingCheckoutProtection({
      attempts: 3,
      stableResponses: 2,
      intervalMs: 0,
      request: async () => ({ status: 200, payload: pending }),
      sleep: async () => {}
    }),
    error => {
      assert.equal(error.code, 'PUBLIC_CHECKOUT_ORIGIN_CONFIG_NOT_READY');
      assert.equal(error.message.includes('segredo'), false);
      return true;
    }
  );
});

test('detecta origem, chave e configuração incompletas separadamente', () => {
  const originGuard = readyPayload();
  originGuard.publicCheckout.protection.requiresOrigin = false;
  assert.equal(
    validateStagingCheckoutProtection({ status: 200, payload: originGuard }).code,
    'PUBLIC_CHECKOUT_ORIGIN_GUARD_NOT_READY'
  );

  const config = readyPayload();
  config.publicCheckout.protection.configured = false;
  assert.equal(
    validateStagingCheckoutProtection({ status: 200, payload: config }).code,
    'PUBLIC_CHECKOUT_PROTECTION_CONFIG_NOT_READY'
  );

  const strategy = readyPayload();
  strategy.publicCheckout.protection.keyStrategy = 'legado';
  assert.equal(
    validateStagingCheckoutProtection({ status: 200, payload: strategy }).code,
    'PUBLIC_CHECKOUT_RATE_LIMIT_KEY_STRATEGY_NOT_READY'
  );
});
