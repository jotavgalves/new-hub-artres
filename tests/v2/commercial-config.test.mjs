import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commercialConfigToProductSnapshot,
  commercialConfigUpdatePayload,
  DEFAULT_COMMERCIAL_CONFIG,
  normalizeCommercialConfig,
  publicCommercialConfigView,
  validateCommercialConfig
} from '../../src/v2/products/commercial-config.mjs';
import { priceAcceptedCheckoutDraft } from '../../staging/site-v2-worker/src/accepted-checkout-pricing.js';

test('configuração inicial contém somente Bolinhas e Painel 150', () => {
  assert.deepEqual(Object.keys(DEFAULT_COMMERCIAL_CONFIG.products), ['50x50', 'painel-150']);
  assert.equal(DEFAULT_COMMERCIAL_CONFIG.products['50x50'].minimum, 6);
  assert.equal(DEFAULT_COMMERCIAL_CONFIG.products['50x50'].step, 2);
  assert.equal(DEFAULT_COMMERCIAL_CONFIG.products['50x50'].quantityScope, 'cart-product-total');
  assert.equal(DEFAULT_COMMERCIAL_CONFIG.products['painel-150'].quantityScope, 'item');
});

test('atualização cria nova versão sem permitir alteração de identidade ou escopo', () => {
  const updated = commercialConfigUpdatePayload(DEFAULT_COMMERCIAL_CONFIG, {
    effectiveDiscountPercent: 5,
    products: {
      '50x50': { unitPrice: 10.25, minimum: 8, step: 2, initialQuantity: 8, enabled: true },
      'painel-150': { unitPrice: 65, minimum: 1, step: 1, initialQuantity: 1, enabled: false }
    }
  }, {
    version: 2,
    updatedAt: '2026-07-30T18:00:00.000Z',
    updatedBy: 'staging-admin'
  });

  assert.equal(updated.version, 2);
  assert.equal(updated.effectiveDiscountPercent, 5);
  assert.equal(updated.products['50x50'].unitPrice, 10.25);
  assert.equal(updated.products['50x50'].label, 'Bolinhas 50x50');
  assert.equal(updated.products['50x50'].quantityScope, 'cart-product-total');
  assert.equal(updated.products['painel-150'].enabled, false);
  assert.equal(updated.products['painel-150'].quantityScope, 'item');
});

test('rejeita produto desconhecido e quantidade inicial incompatível', () => {
  const unknown = validateCommercialConfig({
    ...DEFAULT_COMMERCIAL_CONFIG,
    products: { ...DEFAULT_COMMERCIAL_CONFIG.products, outro: { unitPrice: 1 } }
  });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.errors.includes('COMMERCIAL_CONFIG_UNKNOWN_PRODUCT'));

  const mismatch = validateCommercialConfig({
    ...DEFAULT_COMMERCIAL_CONFIG,
    products: {
      ...DEFAULT_COMMERCIAL_CONFIG.products,
      '50x50': { ...DEFAULT_COMMERCIAL_CONFIG.products['50x50'], minimum: 6, step: 2, initialQuantity: 7 }
    }
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.includes('COMMERCIAL_CONFIG_INITIAL_STEP_MISMATCH:50x50'));
});

test('visão pública e snapshot de cálculo usam a mesma versão', () => {
  const config = normalizeCommercialConfig({
    ...DEFAULT_COMMERCIAL_CONFIG,
    version: 4,
    updatedAt: '2026-07-30T18:00:00.000Z'
  });
  const publicView = publicCommercialConfigView(config);
  const snapshot = commercialConfigToProductSnapshot(config, { catalogVersion: 49 });

  assert.equal(publicView.version, 4);
  assert.equal(publicView.products['50x50'].quantity.minimum, 6);
  assert.equal(snapshot.metadata.configVersion, 4);
  assert.equal(snapshot.metadata.catalogVersion, 49);
  assert.equal(snapshot.products['painel-150'].pricing.unitPrice, 59.9);
});

test('checkout ignora preço do navegador e usa preço publicado pelo painel', async () => {
  const config = commercialConfigUpdatePayload(DEFAULT_COMMERCIAL_CONFIG, {
    products: {
      '50x50': { unitPrice: 10.25, minimum: 6, step: 2, initialQuantity: 6 },
      'painel-150': { unitPrice: 65, minimum: 1, step: 1, initialQuantity: 1 }
    }
  }, { version: 7, updatedBy: 'staging-admin', updatedAt: '2026-07-30T18:00:00.000Z' });
  const productSnapshot = commercialConfigToProductSnapshot(config, { catalogVersion: 49 });
  const body = {
    items: [{ driveFileId: 'drive-1', productKey: '50x50', quantity: 6, unitPrice: 0.01 }],
    totals: { total: 0.06 }
  };
  const resolved = {
    catalogVersion: 49,
    items: [{
      driveFileId: 'drive-1', code: '2657', originalName: '2657.jpg', theme: 'Festa',
      productKey: '50x50', productName: 'Bolinhas 50x50', sizeKey: 'default'
    }]
  };
  const validated = {
    items: [{
      driveFileId: 'drive-1', code: '2657', originalName: '2657.jpg', theme: 'Festa',
      productKey: '50x50', productName: 'Bolinhas 50x50', variantKey: 'default',
      sizeKey: 'default', quantity: 6, details: {}
    }]
  };

  const priced = await priceAcceptedCheckoutDraft({
    body, resolved, validated, env: {},
    loadCommercialConfig: async () => ({ config, productSnapshot })
  });

  assert.equal(priced.summary.configVersion, 7);
  assert.equal(priced.summary.subtotal, 61.5);
  assert.equal(priced.summary.total, 61.5);
  assert.equal(priced.quote.items[0].unitPrice, 10.25);
  assert.equal(priced.summary.clientValuesIgnored, true);
});
