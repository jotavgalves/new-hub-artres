import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCanonicalOrderV2,
  roundMoney,
  validateOrderV2,
  validateQuantityRules
} from '../../src/v2/orders/schema.mjs';

const baseItem = {
  driveFileId: 'drive-file-2657',
  code: '2657',
  originalName: '2657_1-ANO_50X50.jpg',
  theme: '1 ANO',
  productKey: '50x50',
  productName: 'Bolinhas 50x50',
  variantKey: 'default',
  sizeKey: '50x50',
  quantity: 6,
  unitPrice: 9.75,
  details: { size: '50x50' }
};

function createOrder(overrides = {}) {
  return createCanonicalOrderV2({
    orderNumber: 'PED2600001A',
    createdAt: '2026-07-26T18:00:00.000Z',
    seller: { id: 'ana', label: 'Ana' },
    customer: { name: 'Cliente Teste', whatsapp: '5581999999999' },
    items: [baseItem],
    discountPercent: 0,
    catalogVersion: 49,
    configVersion: 3,
    productRegistryVersion: 1,
    quantityRules: {
      '50x50': { minimum: 6, step: 2, scope: 'cart-product-total' }
    },
    ...overrides
  });
}

test('cria pedido V2 com identidade e totais calculados no domínio', () => {
  const order = createOrder();
  const item = order.items[0];

  assert.equal(order.schemaVersion, 2);
  assert.equal(item.itemId, 'drive-file-2657:50x50:default:50x50');
  assert.equal(item.driveFileId, 'drive-file-2657');
  assert.equal(item.quantity, 6);
  assert.equal(item.unitPrice, 9.75);
  assert.equal(item.lineSubtotal, 58.50);
  assert.deepEqual(order.pricing, {
    currency: 'BRL',
    subtotal: 58.50,
    discountPercent: 0,
    discountAmount: 0,
    total: 58.50,
    calculationVersion: 1
  });
  assert.equal(Object.isFrozen(order), true);
  assert.equal(validateOrderV2(order).ok, true);
});

test('preserva medidas e estruturas autorizadas no item canônico', () => {
  const order = createOrder({
    items: [{
      ...baseItem,
      details: {
        diameterCm: 50,
        unknown: false,
        note: 'medida confirmada',
        nested: { source: 'catalog' }
      }
    }]
  });

  assert.deepEqual(order.items[0].details, {
    diameterCm: 50,
    unknown: false,
    note: 'medida confirmada',
    nested: { source: 'catalog' }
  });
});

test('mesmo código visual pode existir em identidades internas diferentes', () => {
  const order = createOrder({
    items: [
      { ...baseItem, driveFileId: 'drive-a', quantity: 2 },
      { ...baseItem, driveFileId: 'drive-b', quantity: 4 }
    ]
  });

  assert.equal(order.items.length, 2);
  assert.equal(order.items[0].code, order.items[1].code);
  assert.notEqual(order.items[0].itemId, order.items[1].itemId);
  assert.equal(order.qty, 6);
});

test('quantidade mínima pode ser validada sobre o total do produto', () => {
  const valid = validateQuantityRules([
    { itemId: 'a', productKey: '50x50', quantity: 2 },
    { itemId: 'b', productKey: '50x50', quantity: 4 }
  ], {
    '50x50': { minimum: 6, step: 2, scope: 'cart-product-total' }
  });

  assert.deepEqual(valid, { ok: true, errors: [] });
});

test('rejeita total abaixo do mínimo e total fora do incremento', () => {
  const below = validateQuantityRules([
    { itemId: 'a', productKey: '50x50', quantity: 5 }
  ], {
    '50x50': { minimum: 6, step: 2, scope: 'cart-product-total' }
  });

  const wrongStep = validateQuantityRules([
    { itemId: 'a', productKey: '50x50', quantity: 7 }
  ], {
    '50x50': { minimum: 6, step: 2, scope: 'cart-product-total' }
  });

  assert.equal(below.ok, false);
  assert.ok(below.errors[0].startsWith('QUANTITY_BELOW_MINIMUM:50x50:5:6'));
  assert.equal(wrongStep.ok, false);
  assert.ok(wrongStep.errors[0].startsWith('QUANTITY_STEP_INVALID:50x50:7:6:2'));
});

test('pedido não pode ser criado com quantidade inválida', () => {
  assert.throws(
    () => createOrder({ items: [{ ...baseItem, quantity: 7 }] }),
    error => error && error.code === 'ORDER_QUANTITY_RULES_INVALID' && error.details.length === 1
  );
});

test('recalcula desconto sem aceitar totais externos', () => {
  const order = createOrder({
    discountPercent: 10,
    totals: { subtotal: 1, total: 1 }
  });

  assert.equal(order.pricing.subtotal, 58.50);
  assert.equal(order.pricing.discountAmount, 5.85);
  assert.equal(order.pricing.total, 52.65);
  assert.equal(Object.hasOwn(order, 'totals'), false);
});

test('rejeita itemId fornecido que não corresponde aos componentes', () => {
  assert.throws(
    () => createOrder({
      items: [{ ...baseItem, itemId: 'outro-arquivo:50x50:default:50x50' }]
    }),
    error => error && error.code === 'ITEM_ID_MISMATCH'
  );
});

test('rejeita identidades duplicadas em vez de manter quantidade máxima', () => {
  assert.throws(
    () => createOrder({ items: [baseItem, { ...baseItem }] }),
    error => error && error.code === 'DUPLICATE_ITEM_ID'
  );
});

test('produto desconhecido não recebe fallback', () => {
  assert.throws(
    () => createOrder({
      items: [{ ...baseItem, productKey: 'produto-inexistente' }],
      quantityRules: {}
    }),
    error => error && error.code === 'PRODUTO_NAO_CONFIGURADO'
  );
});

test('sacolinha exige variante na identidade', () => {
  const bagItem = {
    driveFileId: 'drive-bag-1',
    code: '2657',
    theme: '1 ANO',
    productKey: 'sacolinha',
    productName: 'Sacolinha de Festa',
    sizeKey: '15x20',
    quantity: 10,
    unitPrice: 6
  };

  assert.throws(
    () => createCanonicalOrderV2({
      orderNumber: 'PED2600002A',
      createdAt: '2026-07-26T18:00:00.000Z',
      items: [bagItem],
      quantityRules: { sacolinha: { minimum: 10, step: 5 } }
    }),
    error => error && error.code === 'VARIANTE_OBRIGATORIA'
  );
});

test('arredondamento monetário é estável em centavos', () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(9.75 * 6), 58.5);
});
