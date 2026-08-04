import assert from 'node:assert/strict';
import test from 'node:test';

const BASE = 'https://new-hub-artres.pages.dev';
const ATTEMPTS = 24;
const INTERVAL_MS = 5000;

test('domínio oficial publica checkout V3 e recuperação pós-merge', async () => {
  let last = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const stamp = `${Date.now()}-${attempt}`;
      const [loaderResponse, checkoutResponse, recoveryResponse] = await Promise.all([
        fetch(`${BASE}/assets/catalog-cache-bust.js?_verify=${stamp}`, { cache: 'no-store' }),
        fetch(`${BASE}/assets/checkout-v3.js?v=20260804-1&_verify=${stamp}`, { cache: 'no-store' }),
        fetch(`${BASE}/assets/checkout-v3-recovery.js?v=20260804-1&_verify=${stamp}`, { cache: 'no-store' })
      ]);
      const [loader, checkout, recovery] = await Promise.all([
        loaderResponse.text(), checkoutResponse.text(), recoveryResponse.text()
      ]);
      assert.equal(loaderResponse.status, 200);
      assert.equal(checkoutResponse.status, 200);
      assert.equal(recoveryResponse.status, 200);
      assert.match(loader, /checkout-v3-recovery\.js\?v=20260804-1/);
      assert.match(loader, /script\.addEventListener\('load',loadCheckoutRecovery/);
      assert.match(checkout, /Confira suas artes/);
      assert.match(checkout, /Como podemos falar com você/);
      assert.match(checkout, /Registrando seu pedido/);
      assert.match(checkout, /Pedido registrado/);
      assert.match(recovery, /X-Checkout-Retry/);
      assert.match(recovery, /count>1/);
      return;
    } catch (error) {
      last = error;
      if (attempt < ATTEMPTS) await new Promise(resolve => setTimeout(resolve, INTERVAL_MS));
    }
  }
  throw last || new Error('OFFICIAL_CHECKOUT_V3_NOT_PROPAGATED');
});
