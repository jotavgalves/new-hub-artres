import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderIntentFingerprint } from '../../src/v2/orders/idempotency.mjs';

function orderWithCustomer(name) {
  return {
    seller: { id: 'ana', label: 'Ana' },
    customer: {
      name,
      whatsapp: '5581999999999',
      phone: '5581999999999'
    },
    items: [{
      itemId: 'drive-file:50x50:default:50x50',
      productKey: '50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6
    }],
    integrity: {
      catalogVersion: 52,
      configVersion: 1
    }
  };
}

test('nome diferente do cliente altera a identidade idempotente', async () => {
  const original = await createOrderIntentFingerprint(orderWithCustomer('Cliente Sintético Público'));
  const changed = await createOrderIntentFingerprint(orderWithCustomer('Cliente Sintético Conflitante'));

  assert.match(original, /^[0-9a-f]{64}$/);
  assert.match(changed, /^[0-9a-f]{64}$/);
  assert.notEqual(changed, original);
});

test('normalização de espaços não cria falso conflito', async () => {
  const original = await createOrderIntentFingerprint(orderWithCustomer('Cliente Sintético Público'));
  const normalized = await createOrderIntentFingerprint(orderWithCustomer('  Cliente   Sintético   Público  '));

  assert.equal(normalized, original);
});
