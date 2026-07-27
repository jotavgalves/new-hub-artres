import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptOrderForV2,
  adaptOrderItem,
  legacyFingerprint
} from '../../src/v2/orders/legacy-adapter.mjs';

const legacyOrder = {
  id: 'PED2600001A',
  createdAt: '2026-07-26T18:00:00.000Z',
  status: 'Novo',
  seller: { id: 'ana', label: 'Ana' },
  customer: { name: 'Cliente', whatsapp: '5581999999999' },
  totals: { subtotal: 58.5, total: 58.5 },
  items: [
    {
      code: '2657',
      theme: '1 ANO',
      product: '50x50',
      productName: 'Bolinhas 50x50',
      qty: 6,
      image: 'https://example.test/2657.jpg'
    }
  ]
};

test('adapta pedido antigo sem fingir que código é Drive ID', () => {
  const adapted = adaptOrderForV2(legacyOrder);
  const item = adapted.items[0];

  assert.equal(adapted.schemaVersion, 1);
  assert.equal(adapted.compatibilityMode, 'adapted-legacy');
  assert.equal(adapted.orderNumber, 'PED2600001A');
  assert.equal(item.code, '2657');
  assert.equal(item.driveFileId, '');
  assert.equal(item.identityStatus, 'unresolved-legacy');
  assert.match(item.itemId, /^legacy-[0-9a-f]{8}$/);
  assert.ok(item.warnings.includes('DRIVE_FILE_ID_MISSING'));
});

test('identidade antiga é determinística para os mesmos campos', () => {
  const first = adaptOrderForV2(legacyOrder).items[0];
  const second = adaptOrderForV2(structuredClone(legacyOrder)).items[0];

  assert.equal(first.itemId, second.itemId);
  assert.equal(legacyFingerprint({ a: 1, b: 2 }), legacyFingerprint({ b: 2, a: 1 }));
});

test('mesmo código em produtos diferentes recebe identidades antigas diferentes', () => {
  const adapted = adaptOrderForV2({
    ...legacyOrder,
    items: [
      legacyOrder.items[0],
      {
        ...legacyOrder.items[0],
        product: 'sacolinha',
        productName: 'Sacolinha de Festa',
        details: { size: 'P' },
        qty: 10
      }
    ]
  });

  assert.equal(adapted.items[0].code, adapted.items[1].code);
  assert.notEqual(adapted.items[0].itemId, adapted.items[1].itemId);
  assert.equal(adapted.qty, 16);
});

test('pedido nativo V2 mantém identidade verificada', () => {
  const adapted = adaptOrderForV2({
    schemaVersion: 2,
    orderNumber: 'PED2600002A',
    createdAt: '2026-07-26T18:00:00.000Z',
    items: [
      {
        itemId: 'drive-file-1:50x50:default:50x50',
        driveFileId: 'drive-file-1',
        code: '2657',
        theme: '1 ANO',
        productKey: '50x50',
        productName: 'Bolinhas 50x50',
        variantKey: 'default',
        sizeKey: '50x50',
        quantity: 6,
        originalName: '2657_1-ANO_50X50.jpg',
        details: { diameterCm: 50 }
      }
    ]
  });

  assert.equal(adapted.compatibilityMode, 'native-v2');
  assert.equal(adapted.items[0].identityStatus, 'verified');
  assert.equal(adapted.items[0].driveFileId, 'drive-file-1');
  assert.deepEqual(adapted.items[0].details, { diameterCm: 50 });
});

test('reconstrói itemId quando há Drive ID e produto, mas a identidade está ausente', () => {
  const item = adaptOrderItem({
    driveFileId: 'drive-file-1',
    code: '2657',
    product: 'Bolinhas',
    productName: 'Bolinhas 50x50',
    size: '50x50',
    qty: 6
  });

  assert.equal(item.itemId, 'drive-file-1:50x50:default:50x50');
  assert.equal(item.identityStatus, 'derived-v2');
});

test('produto desconhecido permanece não resolvido e nunca vira painel', () => {
  const item = adaptOrderItem({
    code: '2657',
    product: 'Produto Novo',
    qty: 1
  });

  assert.equal(item.productKey, '');
  assert.equal(item.identityStatus, 'unresolved-legacy');
  assert.ok(item.warnings.includes('PRODUCT_KEY_UNRESOLVED'));
  assert.notEqual(item.productKey, 'painel-150');
});

test('preserva variantes, tamanho e detalhes de pedidos antigos', () => {
  const item = adaptOrderItem({
    code: '9001',
    product: 'Sacolinha de Festa',
    productName: 'Sacolinha de Festa',
    variantKey: 'alca-fita',
    sizeKey: 'P',
    qty: 10,
    details: {
      size: 'P',
      dimensionsCm: { width: 15, height: 20 }
    }
  });

  assert.equal(item.productKey, 'sacolinha');
  assert.equal(item.variantKey, 'alca-fita');
  assert.equal(item.sizeKey, 'P');
  assert.deepEqual(item.details, {
    size: 'P',
    dimensionsCm: { width: 15, height: 20 }
  });
});
