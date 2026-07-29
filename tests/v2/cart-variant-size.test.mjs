import assert from 'node:assert/strict';
import test from 'node:test';

import {
  removeCartLine,
  setCartLineQuantity
} from '../../src/v2/cart/collection.mjs';
import {
  addCartVariantSizeLine,
  applyCartVariantSize,
  cartVariantSizeKey,
  resolveCartVariantSize,
  sameCartVariantSize
} from '../../src/v2/cart/variant-size.mjs';

function artwork(overrides = {}) {
  return {
    id: 'drive-file-variant-size',
    code: '656',
    product: 'sacolinha',
    qty: 10,
    theme: 'ARCO IRIS',
    details: { observations: 'Preservar observação' },
    ...overrides
  };
}

test('mesma arte e produto permanecem separados por variante fechada', () => {
  let cart = addCartVariantSizeLine([], artwork(), { variantKey: 'P' });
  cart = addCartVariantSizeLine(cart, artwork(), { variantKey: 'M' });
  cart = addCartVariantSizeLine(cart, artwork(), { variantKey: 'G' });

  assert.equal(cart.length, 3);
  assert.deepEqual(cart.map(line => line.lineId), [
    'drive-file-variant-size:sacolinha:P:default',
    'drive-file-variant-size:sacolinha:M:default',
    'drive-file-variant-size:sacolinha:G:default'
  ]);
  assert.deepEqual(cart.map(line => line.details.size), ['P', 'M', 'G']);
  assert.deepEqual(cart.map(line => line.quantity), [10, 10, 10]);
});

test('variante fechada aceita caixa diferente e converge para a chave canônica', () => {
  const resolved = resolveCartVariantSize(artwork(), { variant: 'm' });
  const line = applyCartVariantSize(artwork(), { variant: 'm' });

  assert.equal(resolved.variantKey, 'M');
  assert.equal(resolved.sizeKey, 'default');
  assert.equal(resolved.variantLabel, 'M');
  assert.equal(resolved.closedVariant, true);
  assert.equal(line.lineId, 'drive-file-variant-size:sacolinha:M:default');
  assert.equal(line.details.variantKey, 'M');
  assert.equal(line.details.sizeKey, 'default');
  assert.equal(line.details.size, 'M');
});

test('sacolinha legada interpreta details.size como variante sem criar tamanho duplicado', () => {
  const legacy = applyCartVariantSize(artwork({
    variantKey: undefined,
    sizeKey: undefined,
    size: undefined,
    details: {
      size: 'G',
      observations: 'Legado preservado'
    }
  }));

  assert.equal(legacy.variantKey, 'G');
  assert.equal(legacy.sizeKey, 'default');
  assert.equal(legacy.lineId, 'drive-file-variant-size:sacolinha:G:default');
  assert.equal(legacy.details.observations, 'Legado preservado');
});

test('variante obrigatória ausente ou inválida falha fechada', () => {
  assert.throws(
    () => resolveCartVariantSize(artwork(), {}),
    error => error.code === 'CART_LINE_VARIANT_REQUIRED'
  );
  assert.throws(
    () => resolveCartVariantSize(artwork(), { variantKey: 'GG' }),
    error => error.code === 'CART_LINE_VARIANT_INVALID' && error.productKey === 'sacolinha'
  );
});

test('mesma arte produto e variante permanecem separados por tamanho', () => {
  const base = artwork({
    product: '50x50',
    qty: 6,
    details: { observations: 'Tamanho distinto' }
  });
  let cart = addCartVariantSizeLine([], base, {
    variantKey: 'acabamento-fosco',
    sizeKey: '50x50'
  });
  cart = addCartVariantSizeLine(cart, base, {
    variantKey: 'acabamento-fosco',
    sizeKey: '60x60'
  });

  assert.equal(cart.length, 2);
  assert.deepEqual(cart.map(line => line.lineId), [
    'drive-file-variant-size:50x50:acabamento-fosco:50x50',
    'drive-file-variant-size:50x50:acabamento-fosco:60x60'
  ]);
  assert.equal(sameCartVariantSize(cart[0], cart[1]), false);
});

test('mesmo arquivo produto variante e tamanho soma somente a linha idêntica', () => {
  const input = artwork({ product: '50x50', qty: 2 });
  const selection = { variantKey: 'default', sizeKey: '50x50' };
  let cart = addCartVariantSizeLine([], input, selection);
  cart = addCartVariantSizeLine(cart, input, selection, { quantity: 4 });

  assert.equal(cart.length, 1);
  assert.equal(cart[0].quantity, 6);
  assert.equal(cart[0].lineId, 'drive-file-variant-size:50x50:default:50x50');
});

test('alterar quantidade ou remover uma variante não afeta as demais', () => {
  const small = applyCartVariantSize(artwork(), { variantKey: 'P' });
  const medium = applyCartVariantSize(artwork(), { variantKey: 'M' });
  let cart = addCartVariantSizeLine([], artwork(), { variantKey: 'P' });
  cart = addCartVariantSizeLine(cart, artwork(), { variantKey: 'M' });

  cart = setCartLineQuantity(cart, medium, 25);
  assert.deepEqual(cart.map(line => line.quantity), [10, 25]);

  cart = removeCartLine(cart, small);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].variantKey, 'M');
  assert.equal(cart[0].quantity, 25);
});

test('chave de variante e tamanho não depende de arquivo código quantidade ou preço', () => {
  const first = artwork({ id: 'drive-a', code: '100', qty: 10, unitPrice: 1 });
  const second = artwork({ id: 'drive-b', code: '999', qty: 50, unitPrice: 999 });

  assert.equal(
    cartVariantSizeKey(first, { variantKey: 'P' }),
    'sacolinha:P:default'
  );
  assert.equal(
    cartVariantSizeKey(first, { variantKey: 'P' }),
    cartVariantSizeKey(second, { variantKey: 'P' })
  );
});

test('aplicação preserva o objeto de entrada e devolve estrutura congelada', () => {
  const input = artwork({
    details: { observations: 'Não mutar', nested: { value: 1 } }
  });
  const snapshot = structuredClone(input);
  const line = applyCartVariantSize(input, { variantKey: 'G' });

  assert.deepEqual(input, snapshot);
  assert.equal(Object.isFrozen(line), true);
  assert.equal(Object.isFrozen(line.details), true);
  assert.equal(Object.isFrozen(line.details.nested), true);
  assert.equal(line.details.observations, 'Não mutar');
});
