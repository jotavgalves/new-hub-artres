import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCartLine,
  assertCartCollectionIntegrity,
  cartCollectionSummary,
  incrementCartLine,
  removeCartLine,
  setCartLineQuantity
} from '../../src/v2/cart/collection.mjs';

function line(overrides = {}) {
  return {
    id: 'drive-file-001',
    code: '656',
    product: '50x50',
    variantKey: 'default',
    sizeKey: '50x50',
    qty: 6,
    theme: 'ARCO IRIS',
    details: { observations: 'Preservar' },
    ...overrides
  };
}

test('mesmo código e arquivo em produtos diferentes cria duas linhas', () => {
  let cart = addCartLine([], line());
  cart = addCartLine(cart, line({
    product: 'painel-150',
    sizeKey: '150x150',
    qty: 1
  }));

  assert.equal(cart.length, 2);
  assert.deepEqual(cart.map(item => item.lineId), [
    'drive-file-001:50x50:default:50x50',
    'drive-file-001:painel-150:default:150x150'
  ]);
  assert.deepEqual(cart.map(item => item.code), ['656', '656']);
  assert.deepEqual(cart.map(item => item.quantity), [6, 1]);
});

test('mesmo código em arquivos diferentes também permanece separado', () => {
  let cart = addCartLine([], line({ id: 'drive-file-a', code: '656' }));
  cart = addCartLine(cart, line({ id: 'drive-file-b', code: '656' }));

  assert.equal(cart.length, 2);
  assert.notEqual(cart[0].lineId, cart[1].lineId);
  assert.equal(cart[0].code, cart[1].code);
});

test('somente a mesma lineId soma quantidade', () => {
  let cart = addCartLine([], line({ qty: 6 }));
  cart = addCartLine(cart, line({ qty: 3, unitPrice: 0.01 }));

  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 9);
  assert.equal(cart[0].qty, 9);
  assert.equal(cart[0].lineId, 'drive-file-001:50x50:default:50x50');
  assert.deepEqual(cart[0].details, { observations: 'Preservar' });
});

test('atualizar um produto não altera a linha de mesmo código em outro produto', () => {
  const ball = line({ qty: 6 });
  const panel = line({ product: 'painel-150', sizeKey: '150x150', qty: 1 });
  let cart = addCartLine([], ball);
  cart = addCartLine(cart, panel);

  cart = setCartLineQuantity(cart, panel, 4);
  assert.deepEqual(cart.map(item => item.quantity), [6, 4]);

  cart = incrementCartLine(cart, ball, 2);
  assert.deepEqual(cart.map(item => item.quantity), [8, 4]);

  cart = incrementCartLine(cart, panel, -1);
  assert.deepEqual(cart.map(item => item.quantity), [8, 3]);
});

test('remover um produto preserva o outro com o mesmo código', () => {
  const ball = line();
  const panel = line({ product: 'painel-150', sizeKey: '150x150', qty: 1 });
  let cart = addCartLine([], ball);
  cart = addCartLine(cart, panel);
  cart = removeCartLine(cart, panel);

  assert.equal(cart.length, 1);
  assert.equal(cart[0].lineId, 'drive-file-001:50x50:default:50x50');
  assert.equal(cart[0].code, '656');
});

test('resumo reconhece código repetido sem colapsar linhas', () => {
  let cart = addCartLine([], line({ id: 'drive-file-a', code: '656', qty: 6 }));
  cart = addCartLine(cart, line({
    id: 'drive-file-a',
    code: '656',
    product: 'painel-150',
    sizeKey: '150x150',
    qty: 1
  }));
  cart = addCartLine(cart, line({ id: 'drive-file-b', code: '900', qty: 2 }));

  assert.deepEqual(cartCollectionSummary(cart), {
    lineCount: 3,
    quantity: 9,
    distinctVisualCodeCount: 2,
    repeatedVisualCodeCount: 1,
    repeatedVisualCodeLineCount: 2
  });
});

test('coleção é imutável e não altera o array ou item de entrada', () => {
  const originalLine = line();
  const originalCart = [originalLine];
  const next = addCartLine(originalCart, line({
    product: 'painel-150',
    sizeKey: '150x150',
    qty: 1
  }));

  assert.equal(originalCart.length, 1);
  assert.equal(originalLine.lineId, undefined);
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.isFrozen(next[0]), true);
  assert.equal(Object.isFrozen(next[0].details), true);
});

test('integridade rejeita duplicação real e quantidade inválida', () => {
  const duplicate = [
    line({ qty: 6 }),
    line({ qty: 2 })
  ];
  assert.throws(
    () => assertCartCollectionIntegrity(duplicate),
    error => error.code === 'CART_LINE_ID_DUPLICATED' && error.duplicateIndex === 1
  );

  assert.throws(
    () => assertCartCollectionIntegrity([line({ qty: 0 })]),
    error => error.code === 'CART_LINE_QUANTITY_INVALID'
  );
  assert.throws(
    () => addCartLine([], line({ qty: 100001 })),
    error => error.code === 'CART_LINE_QUANTITY_INVALID'
  );
});

test('operações falham fechadas para linha ausente ou delta inválido', () => {
  const cart = addCartLine([], line());
  const absent = line({ product: 'painel-150', sizeKey: '150x150' });

  assert.throws(
    () => setCartLineQuantity(cart, absent, 2),
    error => error.code === 'CART_LINE_NOT_FOUND'
  );
  assert.throws(
    () => removeCartLine(cart, absent),
    error => error.code === 'CART_LINE_NOT_FOUND'
  );
  assert.throws(
    () => incrementCartLine(cart, line(), 0),
    error => error.code === 'CART_LINE_DELTA_INVALID'
  );
  assert.throws(
    () => incrementCartLine(cart, line(), -6),
    error => error.code === 'CART_LINE_QUANTITY_INVALID'
  );
});
