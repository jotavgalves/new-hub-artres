import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAcceptedCheckoutItems } from '../../staging/site-v2-worker/src/accepted-checkout-item-validator.js';

function catalogItem(overrides = {}) {
  return {
    driveFileId: 'drive-file-001',
    code: '656',
    originalName: '656 ARCO-IRIS PAINEL REDONDO 50X50.jpg',
    theme: 'ARCO IRIS',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas',
    sizeKey: '50x50',
    ...overrides
  };
}

function requestItem(overrides = {}) {
  return {
    driveFileId: 'drive-file-001',
    productKey: '50x50',
    variantKey: 'default',
    sizeKey: '50x50',
    quantity: 6,
    details: { diameterCm: 50 },
    ...overrides
  };
}

test('valida item real e cria identidade inequívoca', () => {
  const result = validateAcceptedCheckoutItems([requestItem()], [catalogItem()]);

  assert.equal(result.ok, true);
  assert.equal(result.itemCount, 1);
  assert.deepEqual(result.productKeys, ['50x50']);
  assert.deepEqual(result.variantKeys, ['default']);
  assert.deepEqual(result.sizeKeys, ['50x50']);
  assert.equal(result.items[0].itemId, 'drive-file-001:50x50:default:50x50');
  assert.equal(result.items[0].quantity, 6);
  assert.deepEqual(result.items[0].details, { diameterCm: 50 });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
  assert.equal(Object.isFrozen(result.items[0].details), true);
});

test('normaliza referência Bolinhas para o produto 50x50', () => {
  const result = validateAcceptedCheckoutItems(
    [requestItem({ productKey: 'Bolinhas' })],
    [catalogItem({ productKey: 'Bolinhas' })]
  );

  assert.equal(result.items[0].productKey, '50x50');
});

test('rejeita produto solicitado que não pertence à arte', () => {
  assert.throws(
    () => validateAcceptedCheckoutItems(
      [requestItem({ productKey: 'painel-150' })],
      [catalogItem()]
    ),
    error => error.code === 'ARTWORK_PRODUCT_MISMATCH' && error.itemIndex === 0
  );
});

test('produto sem variantes aceita somente default', () => {
  assert.throws(
    () => validateAcceptedCheckoutItems(
      [requestItem({ variantKey: 'especial' })],
      [catalogItem()]
    ),
    error => error.code === 'VARIANT_NOT_ALLOWED'
  );
});

test('produto com variantes exige uma variante cadastrada', () => {
  const bagCatalog = catalogItem({
    driveFileId: 'bag-file-001',
    productKey: 'sacolinha',
    productName: 'Sacolinha',
    sizeKey: 'default'
  });

  assert.throws(
    () => validateAcceptedCheckoutItems([
      requestItem({
        driveFileId: 'bag-file-001',
        productKey: 'sacolinha',
        variantKey: 'default',
        sizeKey: 'default'
      })
    ], [bagCatalog]),
    error => error.code === 'VARIANT_REQUIRED'
  );

  const result = validateAcceptedCheckoutItems([
    requestItem({
      driveFileId: 'bag-file-001',
      productKey: 'sacolinha',
      variantKey: 'm',
      sizeKey: 'default'
    })
  ], [bagCatalog]);

  assert.equal(result.items[0].variantKey, 'M');
  assert.equal(result.items[0].itemId, 'bag-file-001:sacolinha:M:default');
});

test('rejeita tamanho diferente do tamanho aceito da arte', () => {
  assert.throws(
    () => validateAcceptedCheckoutItems(
      [requestItem({ sizeKey: '150x150' })],
      [catalogItem()]
    ),
    error => error.code === 'ARTWORK_SIZE_MISMATCH'
  );
});

test('rejeita arte ausente e catálogo duplicado sem expor IDs no erro', () => {
  assert.throws(
    () => validateAcceptedCheckoutItems(
      [requestItem({ driveFileId: 'arquivo-secreto-ausente' })],
      [catalogItem()]
    ),
    error => {
      assert.equal(error.code, 'ARTWORK_NOT_FOUND');
      assert.equal(error.message.includes('arquivo-secreto-ausente'), false);
      assert.equal(error.itemIndex, 0);
      return true;
    }
  );

  assert.throws(
    () => validateAcceptedCheckoutItems(
      [requestItem()],
      [catalogItem(), catalogItem()]
    ),
    error => error.code === 'CATALOG_CHECKOUT_DUPLICATED_ITEM'
  );
});

test('rejeita detalhes não estruturados como objeto', () => {
  assert.throws(
    () => validateAcceptedCheckoutItems(
      [requestItem({ details: ['não permitido'] })],
      [catalogItem()]
    ),
    error => error.code === 'CHECKOUT_DETAILS_INVALID'
  );
});
