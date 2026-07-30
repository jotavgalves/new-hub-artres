import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commercialConfigToProductSnapshot,
  commercialConfigUpdatePayload,
  DEFAULT_COMMERCIAL_CONFIG
} from '../../src/v2/products/commercial-config.mjs';
import { priceAcceptedCheckoutDraft } from '../../staging/site-v2-worker/src/accepted-checkout-pricing.js';

function catalogItem(overrides = {}) {
  return {
    driveFileId: 'drive-file-001', code: '656', originalName: '656_ARCO-IRIS_50X50.jpg',
    theme: 'ARCO IRIS', subtheme: '', productKey: '50x50', productName: 'Bolinhas 50x50',
    sizeKey: '50x50', ...overrides
  };
}
function validatedItem(overrides = {}) {
  return {
    itemId: 'drive-file-001:50x50:default:50x50', driveFileId: 'drive-file-001', code: '656',
    originalName: '656_ARCO-IRIS_50X50.jpg', theme: 'ARCO IRIS', subtheme: '',
    productKey: '50x50', productName: 'Bolinhas 50x50', variantKey: 'default',
    sizeKey: '50x50', quantity: 6, details: {}, ...overrides
  };
}
function commercialLoader(config = DEFAULT_COMMERCIAL_CONFIG) {
  return async (_env, { catalogVersion }) => ({
    config,
    productSnapshot: commercialConfigToProductSnapshot(config, { catalogVersion })
  });
}
function input(overrides = {}) {
  const body = {
    total: 0.01, subtotal: 0.01, clientTotals: { total: 0.01 },
    items: [{
      driveFileId: 'drive-file-001', productKey: '50x50', variantKey: 'default',
      sizeKey: '50x50', quantity: 6, unitPrice: 0.01, lineSubtotal: 0.06
    }],
    ...(overrides.body || {})
  };
  return {
    body,
    resolved: { catalogVersion: 49, items: [catalogItem()], ...(overrides.resolved || {}) },
    validated: { itemCount: 1, items: [validatedItem()], ...(overrides.validated || {}) },
    env: {},
    loadCommercialConfig: overrides.loadCommercialConfig || commercialLoader()
  };
}

test('ignora preço e total do cliente e calcula seis unidades em R$ 58,50', async () => {
  const result = await priceAcceptedCheckoutDraft(input());
  assert.equal(result.ok, true);
  assert.equal(result.authoritative, true);
  assert.equal(result.summary.currency, 'BRL');
  assert.equal(result.summary.itemCount, 1);
  assert.equal(result.summary.quantity, 6);
  assert.equal(result.summary.subtotal, 58.5);
  assert.equal(result.summary.discountPercent, 0);
  assert.equal(result.summary.total, 58.5);
  assert.equal(result.summary.catalogVersion, 49);
  assert.equal(result.summary.configVersion, 1);
  assert.equal(result.summary.clientValuesIgnored, true);
  assert.deepEqual(new Set(result.warnings), new Set(['CLIENT_ITEM_PRICE_IGNORED','CLIENT_ORDER_TOTALS_IGNORED']));
  assert.equal(result.quote.items[0].unitPrice, 9.75);
  assert.equal(Object.isFrozen(result), true);
});

test('aplica somente desconto publicado pelo painel', async () => {
  const config = commercialConfigUpdatePayload(DEFAULT_COMMERCIAL_CONFIG, {
    effectiveDiscountPercent: 10,
    products: {
      '50x50': { unitPrice: 9.75, minimum: 6, step: 2, initialQuantity: 6 },
      'painel-150': { unitPrice: 59.9, minimum: 1, step: 1, initialQuantity: 1 }
    }
  }, { version: 2, updatedAt: '2026-07-30T18:00:00.000Z', updatedBy: 'admin' });
  const result = await priceAcceptedCheckoutDraft(input({
    body: {
      discountPercent: 99,
      total: 0,
      items: [{ driveFileId: 'drive-file-001', productKey: '50x50', variantKey: 'default', sizeKey: '50x50', quantity: 6 }]
    },
    loadCommercialConfig: commercialLoader(config)
  }));
  assert.equal(result.summary.discountPercent, 10);
  assert.equal(result.summary.discountAmount, 5.85);
  assert.equal(result.summary.total, 52.65);
  assert.equal(result.summary.configVersion, 2);
});

test('rejeita quantidade abaixo do mínimo e fora do incremento', async () => {
  for (const quantity of [4, 7]) {
    await assert.rejects(
      priceAcceptedCheckoutDraft(input({
        body: { items: [{ driveFileId: 'drive-file-001', productKey: '50x50', variantKey: 'default', sizeKey: '50x50', quantity }] },
        validated: { items: [validatedItem({ quantity })] }
      })),
      error => error.code === 'ORDER_QUANTITY_RULES_INVALID'
    );
  }
});

test('soma quantidade por produto quando há duas artes diferentes', async () => {
  const secondCatalog = catalogItem({ driveFileId: 'drive-file-002', code: '657', originalName: '657_ARCO-IRIS_50X50.jpg' });
  const secondValidated = validatedItem({
    itemId: 'drive-file-002:50x50:default:50x50', driveFileId: 'drive-file-002', code: '657',
    originalName: '657_ARCO-IRIS_50X50.jpg', quantity: 3
  });
  const result = await priceAcceptedCheckoutDraft(input({
    body: { items: [
      { driveFileId: 'drive-file-001', productKey: '50x50', quantity: 3 },
      { driveFileId: 'drive-file-002', productKey: '50x50', quantity: 3 }
    ] },
    resolved: { items: [catalogItem(), secondCatalog] },
    validated: { itemCount: 2, items: [validatedItem({ quantity: 3 }), secondValidated] }
  }));
  assert.equal(result.summary.itemCount, 2);
  assert.equal(result.summary.quantity, 6);
  assert.equal(result.summary.total, 58.5);
});

test('rejeita contagens inconsistentes e catálogo sem versão', async () => {
  await assert.rejects(
    priceAcceptedCheckoutDraft(input({ validated: { items: [] } })),
    error => error.code === 'CHECKOUT_PRICING_ITEM_COUNT_MISMATCH'
  );
  await assert.rejects(
    priceAcceptedCheckoutDraft(input({ resolved: { catalogVersion: 0 } })),
    error => error.code === 'CHECKOUT_PRICING_CATALOG_INVALID'
  );
});

test('avisos públicos nunca carregam o ID da arte', async () => {
  const result = await priceAcceptedCheckoutDraft(input());
  assert.equal(JSON.stringify(result.warnings).includes('drive-file-001'), false);
});
