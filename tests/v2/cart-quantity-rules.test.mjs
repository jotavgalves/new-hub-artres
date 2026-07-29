import assert from 'node:assert/strict';
import test from 'node:test';

import { addCartLine } from '../../src/v2/cart/collection.mjs';
import {
  addCartLineByQuantityRule,
  cartProductQuantityState,
  decrementCartLineByQuantityRule,
  nextValidQuantity,
  previousValidQuantity,
  resolveCartQuantityRule,
  validateCartQuantityRules
} from '../../src/v2/cart/quantity-rules.mjs';
import { applyCartVariantSize } from '../../src/v2/cart/variant-size.mjs';
import { STAGING_PRODUCT_SNAPSHOT } from '../../staging/site-v2-worker/src/staging-catalog-fixture.js';

const SNAPSHOT = Object.freeze({
  metadata: Object.freeze({
    mode: 'test-authoritative-snapshot',
    catalogVersion: 49,
    configVersion: 7
  }),
  products: Object.freeze({
    '50x50': Object.freeze({
      source: 'server-snapshot',
      quantity: Object.freeze({ minimum: 6, step: 2, scope: 'cart-product-total' })
    }),
    sacolinha: Object.freeze({
      source: 'server-snapshot',
      quantity: Object.freeze({ initial: 10, minimum: 10, step: 5, scope: 'item' })
    }),
    'painel-150': Object.freeze({
      source: 'server-snapshot',
      quantity: Object.freeze({ minimum: 1, step: 1, scope: 'item' })
    })
  })
});

function artwork(id, product = '50x50', overrides = {}) {
  return {
    id,
    code: '656',
    product,
    variantKey: 'default',
    sizeKey: product === '50x50' ? '50x50' : 'default',
    details: {},
    ...overrides
  };
}

test('lê a regra real validada do snapshot usado pelo checkout de staging', () => {
  const rule = resolveCartQuantityRule(STAGING_PRODUCT_SNAPSHOT, '50x50');

  assert.deepEqual(rule, {
    productKey: '50x50',
    minimum: 6,
    step: 2,
    initial: 6,
    scope: 'cart-product-total',
    source: 'staging-synthetic',
    configVersion: 9001,
    catalogVersion: 9001
  });
});

test('primeira arte 50x50 começa em 6 e a mesma linha cresce de 2 em 2', () => {
  const first = artwork('drive-50-a');
  let cart = addCartLineByQuantityRule([], first, SNAPSHOT);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 6);

  cart = addCartLineByQuantityRule(cart, first, SNAPSHOT);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 8);

  cart = addCartLineByQuantityRule(cart, first, SNAPSHOT);
  assert.equal(cart[0].quantity, 10);
});

test('nova arte do mesmo produto usa o passo sem repetir o mínimo', () => {
  const first = artwork('drive-50-a');
  const second = artwork('drive-50-b');
  let cart = addCartLineByQuantityRule([], first, SNAPSHOT);
  cart = addCartLineByQuantityRule(cart, second, SNAPSHOT);

  assert.equal(cart.length, 2);
  assert.deepEqual(cart.map(line => line.quantity), [6, 2]);
  assert.equal(cartProductQuantityState(cart, '50x50', SNAPSHOT).quantity, 8);
  assert.equal(validateCartQuantityRules(cart, SNAPSHOT).ok, true);
});

test('quantidades 4 e 7 do 50x50 são rejeitadas como no checkout remoto', () => {
  const candidate = artwork('drive-invalid');
  const four = addCartLine([], candidate, { quantity: 4 });
  const seven = addCartLine([], candidate, { quantity: 7 });

  const fourValidation = validateCartQuantityRules(four, SNAPSHOT);
  const sevenValidation = validateCartQuantityRules(seven, SNAPSHOT);

  assert.equal(fourValidation.ok, false);
  assert.ok(fourValidation.errors.some(code => code.startsWith('CART_QUANTITY_BELOW_MINIMUM:50x50')));
  assert.equal(sevenValidation.ok, false);
  assert.ok(sevenValidation.errors.some(code => code.startsWith('CART_QUANTITY_STEP_INVALID:50x50')));
});

test('sacolinha aplica mínimo 10 e incremento 5 por linha e variante', () => {
  const small = artwork('drive-bag', 'sacolinha', { details: { size: 'P' } });
  const large = artwork('drive-bag', 'sacolinha', { details: { size: 'G' } });
  let cart = addCartLineByQuantityRule([], applyCartVariantSize(small, { variantKey: 'P' }), SNAPSHOT);
  cart = addCartLineByQuantityRule(cart, applyCartVariantSize(large, { variantKey: 'G' }), SNAPSHOT);

  assert.deepEqual(cart.map(line => line.quantity), [10, 10]);
  assert.deepEqual(cart.map(line => line.variantKey), ['P', 'G']);

  cart = addCartLineByQuantityRule(cart, applyCartVariantSize(large, { variantKey: 'G' }), SNAPSHOT);
  assert.deepEqual(cart.map(line => line.quantity), [10, 15]);
  assert.equal(validateCartQuantityRules(cart, SNAPSHOT).ok, true);
});

test('produto unitário começa em 1 e avança de 1 em 1', () => {
  const panel = artwork('drive-panel', 'painel-150');
  let cart = addCartLineByQuantityRule([], panel, SNAPSHOT);
  cart = addCartLineByQuantityRule(cart, panel, SNAPSHOT);

  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 2);
});

test('decremento respeita o passo e remove a linha no limite mínimo', () => {
  const first = artwork('drive-50-a');
  const second = artwork('drive-50-b');
  let cart = addCartLineByQuantityRule([], first, SNAPSHOT);
  cart = addCartLineByQuantityRule(cart, second, SNAPSHOT);
  assert.deepEqual(cart.map(line => line.quantity), [6, 2]);

  cart = decrementCartLineByQuantityRule(cart, second, SNAPSHOT);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 6);

  cart = decrementCartLineByQuantityRule(cart, first, SNAPSHOT);
  assert.equal(cart.length, 0);
});

test('decremento não deixa o total do produto em estado inválido', () => {
  const first = artwork('drive-50-a');
  const second = artwork('drive-50-b');
  let cart = addCartLineByQuantityRule([], first, SNAPSHOT);
  cart = addCartLineByQuantityRule(cart, second, SNAPSHOT);
  cart = addCartLineByQuantityRule(cart, second, SNAPSHOT);
  assert.deepEqual(cart.map(line => line.quantity), [6, 4]);

  cart = decrementCartLineByQuantityRule(cart, first, SNAPSHOT);
  assert.deepEqual(cart.map(line => line.quantity), [4, 4]);
  assert.equal(cartProductQuantityState(cart, first, SNAPSHOT).quantity, 8);
});

test('estado informa próximo e anterior válidos', () => {
  const first = artwork('drive-50-a');
  const cart = addCartLineByQuantityRule([], first, SNAPSHOT);
  const state = cartProductQuantityState(cart, first, SNAPSHOT);

  assert.deepEqual(state, {
    productKey: '50x50',
    lineCount: 1,
    quantity: 6,
    minimum: 6,
    step: 2,
    initial: 6,
    scope: 'cart-product-total',
    ok: true,
    error: '',
    nextValidQuantity: 8,
    previousValidQuantity: 0
  });
  assert.equal(nextValidQuantity(7, { minimum: 6, step: 2 }), 8);
  assert.equal(previousValidQuantity(8, { minimum: 6, step: 2 }), 6);
});

test('regra ausente ou incompleta falha fechada sem usar configuração legada', () => {
  assert.throws(
    () => resolveCartQuantityRule({ products: {} }, '50x50'),
    error => error.code === 'CART_QUANTITY_RULE_REQUIRED' && error.productKey === '50x50'
  );
  assert.throws(
    () => resolveCartQuantityRule({ products: { '50x50': { quantity: { minimum: 6, step: 2 } } } }, '50x50'),
    error => error.code === 'CART_QUANTITY_SCOPE_INVALID'
  );
  assert.throws(
    () => resolveCartQuantityRule({ products: { '50x50': { quantity: { minimum: 6, step: 2, initial: 7, scope: 'cart-product-total' } } } }, '50x50'),
    error => error.code === 'CART_QUANTITY_INITIAL_INVALID'
  );
});

test('não aceita carrinho previamente adulterado antes de aplicar ação', () => {
  const invalid = addCartLine([], artwork('drive-invalid'), { quantity: 7 });
  assert.throws(
    () => addCartLineByQuantityRule(invalid, artwork('drive-other'), SNAPSHOT),
    error => (
      error.code === 'CART_QUANTITY_EXISTING_STATE_INVALID' &&
      error.details.some(code => code.startsWith('CART_QUANTITY_STEP_INVALID:50x50'))
    )
  );
});

test('ações retornam coleção congelada e não alteram os objetos recebidos', () => {
  const input = artwork('drive-frozen', 'painel-150', { details: { note: 'preservar' } });
  const snapshot = structuredClone(input);
  const cart = addCartLineByQuantityRule([], input, SNAPSHOT);

  assert.deepEqual(input, snapshot);
  assert.equal(Object.isFrozen(cart), true);
  assert.equal(Object.isFrozen(cart[0]), true);
  assert.equal(Object.isFrozen(cart[0].details), true);
  assert.equal(cart[0].details.note, 'preservar');
});
