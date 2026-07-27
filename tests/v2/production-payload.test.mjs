import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLegacyProductionPayloadView,
  buildProductionPayloadV2,
  validateProductionPayloadV2
} from '../../src/v2/production/payload.mjs';

const nativeOrder = {
  schemaVersion: 2,
  orderNumber: 'PED2600001A',
  createdAt: '2026-07-26T18:00:00.000Z',
  updatedAt: '2026-07-26T18:00:00.000Z',
  status: 'Novo',
  seller: { id: 'ana', label: 'Ana' },
  customer: { name: 'Cliente Teste', whatsapp: '5581999999999' },
  pricing: {
    currency: 'BRL',
    subtotal: 58.5,
    discountPercent: 0,
    discountAmount: 0,
    total: 58.5
  },
  source: 'catalog-v2',
  items: [
    {
      itemId: 'drive-file-2657:50x50:default:50x50',
      driveFileId: 'drive-file-2657',
      code: '2657',
      originalName: '2657_1-ANO_50X50.jpg',
      theme: '1 ANO',
      subtheme: '',
      productKey: '50x50',
      productName: 'Bolinhas 50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6,
      details: { diameterCm: 50 }
    }
  ]
};

test('gera payload V2 nativo com identidade completa', () => {
  const payload = buildProductionPayloadV2(nativeOrder, {
    exposeCustomer: true,
    exposeTotals: true
  });

  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.payloadVersion, 2);
  assert.equal(payload.compatibilityMode, 'native-v2');
  assert.equal(payload.order.orderNumber, 'PED2600001A');
  assert.equal(payload.order.customer.name, 'Cliente Teste');
  assert.equal(payload.order.pricing.total, 58.5);
  assert.equal(payload.items[0].itemId, 'drive-file-2657:50x50:default:50x50');
  assert.equal(payload.items[0].identityStatus, 'verified');
  assert.equal(payload.items[0].driveFileId, 'drive-file-2657');
  assert.deepEqual(payload.items[0].details, { diameterCm: 50 });
  assert.deepEqual(validateProductionPayloadV2(payload), { ok: true, errors: [] });
});

test('oculta cliente e totais conforme configuração', () => {
  const payload = buildProductionPayloadV2(nativeOrder, {
    exposeCustomer: false,
    exposeTotals: false
  });

  assert.equal(Object.hasOwn(payload.order, 'customer'), true);
  assert.equal(payload.order.customer, undefined);
  assert.equal(payload.order.pricing, undefined);
});

test('pedido antigo é entregue em modo adaptado com aviso explícito', () => {
  const payload = buildProductionPayloadV2({
    id: 'PED2600002A',
    createdAt: '2026-07-26T18:00:00.000Z',
    seller: { label: 'Ana' },
    customer: { name: 'Cliente Antigo' },
    items: [
      {
        code: '2657',
        theme: '1 ANO',
        product: 'Bolinhas',
        productName: 'Bolinhas 50x50',
        qty: 6
      }
    ]
  });

  assert.equal(payload.compatibilityMode, 'adapted-legacy');
  assert.equal(payload.items[0].identityStatus, 'unresolved-legacy');
  assert.equal(payload.items[0].driveFileId, '');
  assert.ok(payload.items[0].warnings.includes('DRIVE_FILE_ID_MISSING'));
  assert.equal(payload.integrity.unresolvedItems, 1);
  assert.equal(validateProductionPayloadV2(payload).ok, true);
});

test('mesmo código em produtos diferentes não é agrupado', () => {
  const payload = buildProductionPayloadV2({
    id: 'PED2600003A',
    createdAt: '2026-07-26T18:00:00.000Z',
    items: [
      {
        code: '2657',
        theme: '1 ANO',
        product: 'Bolinhas',
        productName: 'Bolinhas 50x50',
        qty: 6
      },
      {
        code: '2657',
        theme: '1 ANO',
        product: 'Sacolinha de Festa',
        productName: 'Sacolinha de Festa',
        qty: 10,
        details: { size: 'P' }
      }
    ]
  });

  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].code, payload.items[1].code);
  assert.notEqual(payload.items[0].itemId, payload.items[1].itemId);
  assert.equal(payload.integrity.quantity, 16);
});

test('duplicatas da mesma identidade completa somam quantidade', () => {
  const payload = buildProductionPayloadV2({
    ...nativeOrder,
    items: [
      { ...nativeOrder.items[0], quantity: 2 },
      { ...nativeOrder.items[0], quantity: 4 }
    ]
  });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].quantity, 6);
  assert.equal(payload.integrity.sourceItemCount, 2);
  assert.equal(payload.integrity.payloadItemCount, 1);
});

test('visão legada é derivada sem apagar metadados V2 do payload original', () => {
  const payload = buildProductionPayloadV2(nativeOrder, {
    exposeCustomer: true,
    exposeTotals: true
  });
  const legacy = buildLegacyProductionPayloadView(payload);

  assert.deepEqual(legacy.items, [
    {
      id: '2657',
      name: '2657_1-ANO_50X50.jpg',
      quantity: 6
    }
  ]);
  assert.equal(legacy.orderNumber, 'PED2600001A');
  assert.equal(legacy.customerName, 'Cliente Teste');
  assert.equal(legacy.compatibility.payloadVersion, 2);
  assert.equal(payload.items[0].driveFileId, 'drive-file-2657');
});

test('validador detecta quantidade e identidade inválidas', () => {
  const payload = structuredClone(buildProductionPayloadV2(nativeOrder));
  payload.items[0].quantity = 0;
  payload.integrity.quantity = 0;

  const result = validateProductionPayloadV2(payload);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.startsWith('ITEM_QUANTITY_INVALID')));
});
