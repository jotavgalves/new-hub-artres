import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createCurrentSafetySnapshot } from '../../src/v2/products/current-config-adapter.mjs';
import {
  createOrderFromPricingQuoteV2,
  priceOrderIntentV2,
  validatePricingQuoteV2
} from '../../src/v2/orders/pricing.mjs';

const fixtureUrl = new URL('../fixtures/v2/current-public-config.sanitized.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const productSnapshot = createCurrentSafetySnapshot(fixture);

const catalogItems = [
  {
    driveFileId: 'drive-file-2657',
    code: '2657',
    originalName: '2657_1-ANO_50X50.jpg',
    theme: '1 ANO',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas 50x50',
    sizeKey: '50x50'
  },
  {
    driveFileId: 'drive-file-2656',
    code: '2656',
    originalName: '2656_1-ANO_50X50.jpg',
    theme: '1 ANO',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas 50x50',
    sizeKey: '50x50'
  }
];

function price(items, overrides = {}) {
  return priceOrderIntentV2({
    items,
    catalogItems,
    productSnapshot,
    catalogVersion: 49,
    configVersion: 3,
    allowPassiveSimulation: true,
    ...overrides
  });
}

test('usa preço efetivo do servidor e ignora preço adulterado do navegador', () => {
  const quote = price([
    {
      driveFileId: 'drive-file-2657',
      productKey: '50x50',
      quantity: 6,
      unitPrice: 0.01,
      lineSubtotal: 0.06
    }
  ], {
    clientTotals: { subtotal: 0.06, total: 0.06 }
  });

  assert.equal(quote.mode, 'passive-simulation');
  assert.equal(quote.items[0].unitPrice, 9.75);
  assert.equal(quote.items[0].lineSubtotal, 58.5);
  assert.deepEqual(quote.pricing, {
    subtotal: 58.5,
    discountPercent: 0,
    discountAmount: 0,
    total: 58.5
  });
  assert.ok(quote.warnings.includes('CLIENT_ITEM_PRICE_IGNORED:drive-file-2657'));
  assert.ok(quote.warnings.includes('CLIENT_ORDER_TOTALS_IGNORED'));
  assert.deepEqual(validatePricingQuoteV2(quote), { ok: true, errors: [] });
});

test('valida mínimo sobre o total do produto em artes diferentes', () => {
  const quote = price([
    { driveFileId: 'drive-file-2657', quantity: 2 },
    { driveFileId: 'drive-file-2656', quantity: 4 }
  ]);

  assert.equal(quote.items.length, 2);
  assert.equal(quote.integrity.quantity, 6);
  assert.equal(quote.pricing.total, 58.5);
});

test('rejeita quantidade abaixo do mínimo', () => {
  assert.throws(
    () => price([{ driveFileId: 'drive-file-2657', quantity: 5 }]),
    error => error && error.code === 'ORDER_QUANTITY_RULES_INVALID' && error.details[0].startsWith('QUANTITY_BELOW_MINIMUM')
  );
});

test('rejeita quantidade fora do incremento', () => {
  assert.throws(
    () => price([{ driveFileId: 'drive-file-2657', quantity: 7 }]),
    error => error && error.code === 'ORDER_QUANTITY_RULES_INVALID' && error.details[0].startsWith('QUANTITY_STEP_INVALID')
  );
});

test('rejeita arte inexistente', () => {
  assert.throws(
    () => price([{ driveFileId: 'arquivo-inexistente', quantity: 6 }]),
    error => error && error.code === 'ARTWORK_NOT_FOUND'
  );
});

test('rejeita produto solicitado diferente do produto da arte', () => {
  assert.throws(
    () => price([
      {
        driveFileId: 'drive-file-2657',
        productKey: 'sacolinha',
        quantity: 10
      }
    ]),
    error => error && error.code === 'ARTWORK_PRODUCT_MISMATCH'
  );
});

test('modo ativo continua bloqueado enquanto produto não foi ativado', () => {
  assert.throws(
    () => priceOrderIntentV2({
      items: [{ driveFileId: 'drive-file-2657', quantity: 6 }],
      catalogItems,
      productSnapshot,
      catalogVersion: 49,
      configVersion: 3,
      allowPassiveSimulation: false
    }),
    error => error && error.code === 'PRODUCT_CHECKOUT_DISABLED'
  );
});

test('desconto vem do servidor e não do navegador', () => {
  const quote = price([
    { driveFileId: 'drive-file-2657', quantity: 6 }
  ], {
    serverDiscountPercent: 10,
    discountPercent: 99
  });

  assert.equal(quote.pricing.subtotal, 58.5);
  assert.equal(quote.pricing.discountPercent, 10);
  assert.equal(quote.pricing.discountAmount, 5.85);
  assert.equal(quote.pricing.total, 52.65);
});

test('cria pedido canônico a partir da cotação calculada', () => {
  const quote = price([
    { driveFileId: 'drive-file-2657', quantity: 6, details: { diameterCm: 50 } }
  ]);

  const order = createOrderFromPricingQuoteV2({
    quote,
    orderNumber: 'PED2600001A',
    createdAt: '2026-07-26T18:00:00.000Z',
    seller: { id: 'ana', label: 'Ana' },
    customer: { name: 'Cliente', whatsapp: '5581999999999' }
  });

  assert.equal(order.schemaVersion, 2);
  assert.equal(order.items[0].itemId, 'drive-file-2657:50x50:default:50x50');
  assert.equal(order.items[0].unitPrice, 9.75);
  assert.equal(order.pricing.total, 58.5);
  assert.deepEqual(order.items[0].details, { diameterCm: 50 });
});

test('duas artes com o mesmo código permanecem separadas pelo Drive ID', () => {
  const duplicatedCodeCatalog = [
    catalogItems[0],
    {
      ...catalogItems[1],
      code: '2657'
    }
  ];

  const quote = priceOrderIntentV2({
    items: [
      { driveFileId: 'drive-file-2657', quantity: 2 },
      { driveFileId: 'drive-file-2656', quantity: 4 }
    ],
    catalogItems: duplicatedCodeCatalog,
    productSnapshot,
    catalogVersion: 49,
    configVersion: 3,
    allowPassiveSimulation: true
  });

  assert.equal(quote.items[0].code, quote.items[1].code);
  assert.notEqual(quote.items[0].driveFileId, quote.items[1].driveFileId);
});
