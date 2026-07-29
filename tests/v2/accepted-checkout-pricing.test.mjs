import assert from 'node:assert/strict';
import test from 'node:test';

import { priceAcceptedCheckoutDraft } from '../../staging/site-v2-worker/src/accepted-checkout-pricing.js';

function catalogItem(overrides = {}) {
  return {
    driveFileId: 'drive-file-001',
    code: '656',
    originalName: '656_ARCO-IRIS_50X50.jpg',
    theme: 'ARCO IRIS',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas 50x50',
    sizeKey: '50x50',
    ...overrides
  };
}

function validatedItem(overrides = {}) {
  return {
    itemId: 'drive-file-001:50x50:default:50x50',
    driveFileId: 'drive-file-001',
    code: '656',
    originalName: '656_ARCO-IRIS_50X50.jpg',
    theme: 'ARCO IRIS',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas 50x50',
    variantKey: 'default',
    sizeKey: '50x50',
    quantity: 6,
    details: {},
    ...overrides
  };
}

function input(overrides = {}) {
  const body = {
    total: 0.01,
    subtotal: 0.01,
    clientTotals: { total: 0.01 },
    items: [{
      driveFileId: 'drive-file-001',
      productKey: '50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6,
      unitPrice: 0.01,
      lineSubtotal: 0.06
    }],
    ...(overrides.body || {})
  };

  return {
    body,
    resolved: {
      catalogVersion: 49,
      items: [catalogItem()],
      ...(overrides.resolved || {})
    },
    validated: {
      itemCount: 1,
      items: [validatedItem()],
      ...(overrides.validated || {})
    },
    env: overrides.env || {}
  };
}

test('ignora preço e total do cliente e calcula seis unidades em R$ 58,50', () => {
  const result = priceAcceptedCheckoutDraft(input());

  assert.equal(result.ok, true);
  assert.equal(result.authoritative, true);
  assert.equal(result.summary.currency, 'BRL');
  assert.equal(result.summary.itemCount, 1);
  assert.equal(result.summary.quantity, 6);
  assert.equal(result.summary.subtotal, 58.5);
  assert.equal(result.summary.discountPercent, 0);
  assert.equal(result.summary.discountAmount, 0);
  assert.equal(result.summary.total, 58.5);
  assert.equal(result.summary.catalogVersion, 49);
  assert.equal(result.summary.configVersion, 9001);
  assert.equal(result.summary.clientValuesIgnored, true);
  assert.deepEqual(
    new Set(result.warnings),
    new Set(['CLIENT_ITEM_PRICE_IGNORED', 'CLIENT_ORDER_TOTALS_IGNORED'])
  );
  assert.equal(result.quote.items[0].unitPrice, 9.75);
  assert.equal(result.quote.items[0].lineSubtotal, 58.5);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.quote), true);
});

test('aplica somente desconto definido pelo servidor', () => {
  const result = priceAcceptedCheckoutDraft(input({
    body: {
      discountPercent: 99,
      total: 0,
      items: [{
        driveFileId: 'drive-file-001',
        productKey: '50x50',
        variantKey: 'default',
        sizeKey: '50x50',
        quantity: 6
      }]
    },
    env: { STAGING_CHECKOUT_DISCOUNT_PERCENT: '10' }
  }));

  assert.equal(result.summary.subtotal, 58.5);
  assert.equal(result.summary.discountPercent, 10);
  assert.equal(result.summary.discountAmount, 5.85);
  assert.equal(result.summary.total, 52.65);
});

test('rejeita quantidade abaixo do mínimo e fora do incremento', () => {
  for (const quantity of [4, 7]) {
    assert.throws(
      () => priceAcceptedCheckoutDraft(input({
        body: {
          items: [{
            driveFileId: 'drive-file-001',
            productKey: '50x50',
            variantKey: 'default',
            sizeKey: '50x50',
            quantity
          }]
        },
        validated: { items: [validatedItem({ quantity })] }
      })),
      error => {
        assert.equal(error.code, 'ORDER_QUANTITY_RULES_INVALID');
        assert.equal(Array.isArray(error.details), true);
        return true;
      }
    );
  }
});

test('soma quantidade por produto quando há duas artes diferentes', () => {
  const secondCatalog = catalogItem({
    driveFileId: 'drive-file-002',
    code: '657',
    originalName: '657_ARCO-IRIS_50X50.jpg'
  });
  const secondValidated = validatedItem({
    itemId: 'drive-file-002:50x50:default:50x50',
    driveFileId: 'drive-file-002',
    code: '657',
    originalName: '657_ARCO-IRIS_50X50.jpg',
    quantity: 3
  });

  const result = priceAcceptedCheckoutDraft(input({
    body: {
      items: [
        { driveFileId: 'drive-file-001', productKey: '50x50', quantity: 3 },
        { driveFileId: 'drive-file-002', productKey: '50x50', quantity: 3 }
      ]
    },
    resolved: { items: [catalogItem(), secondCatalog] },
    validated: {
      itemCount: 2,
      items: [validatedItem({ quantity: 3 }), secondValidated]
    }
  }));

  assert.equal(result.summary.itemCount, 2);
  assert.equal(result.summary.quantity, 6);
  assert.equal(result.summary.total, 58.5);
});

test('rejeita contagens inconsistentes e catálogo sem versão', () => {
  assert.throws(
    () => priceAcceptedCheckoutDraft(input({ validated: { items: [] } })),
    error => error.code === 'CHECKOUT_PRICING_ITEM_COUNT_MISMATCH'
  );
  assert.throws(
    () => priceAcceptedCheckoutDraft(input({ resolved: { catalogVersion: 0 } })),
    error => error.code === 'CHECKOUT_PRICING_CATALOG_INVALID'
  );
});

test('avisos públicos nunca carregam o ID da arte', () => {
  const result = priceAcceptedCheckoutDraft(input());
  const serialized = JSON.stringify(result.warnings);
  assert.equal(serialized.includes('drive-file-001'), false);
});
