import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachCartLineIdentity,
  cartLineId,
  createCartLineIdentity,
  findCartLine,
  indexCartLines,
  sameCartLine
} from '../../src/v2/cart/line-identity.mjs';

function line(overrides = {}) {
  return {
    id: 'drive-file-001',
    code: '656',
    product: '50x50',
    variantKey: 'default',
    sizeKey: '50x50',
    qty: 6,
    theme: 'ARCO IRIS',
    ...overrides
  };
}

test('gera a mesma identidade usada pelo pedido V2', () => {
  const identity = createCartLineIdentity(line());

  assert.deepEqual(identity, {
    version: 1,
    lineId: 'drive-file-001:50x50:default:50x50',
    itemId: 'drive-file-001:50x50:default:50x50',
    driveFileId: 'drive-file-001',
    productKey: '50x50',
    variantKey: 'default',
    sizeKey: '50x50'
  });
  assert.equal(Object.isFrozen(identity), true);
});

test('código visual igual não une arquivos diferentes', () => {
  const first = line({ id: 'drive-file-a', code: '656' });
  const second = line({ id: 'drive-file-b', code: '656' });

  assert.notEqual(cartLineId(first), cartLineId(second));
  assert.equal(sameCartLine(first, second), false);
});

test('mesmo arquivo permanece separado por produto', () => {
  const round = line({ product: '50x50', sizeKey: '50x50' });
  const panel = line({ product: 'painel-150', sizeKey: '150x150' });

  assert.equal(cartLineId(round), 'drive-file-001:50x50:default:50x50');
  assert.equal(cartLineId(panel), 'drive-file-001:painel-150:default:150x150');
  assert.equal(sameCartLine(round, panel), false);
});

test('mesmo arquivo e produto permanecem separados por variante', () => {
  const small = line({
    product: 'sacolinha',
    sizeKey: 'default',
    variantKey: 'P'
  });
  const large = line({
    product: 'sacolinha',
    sizeKey: 'default',
    variantKey: 'G'
  });

  assert.equal(cartLineId(small), 'drive-file-001:sacolinha:P:default');
  assert.equal(cartLineId(large), 'drive-file-001:sacolinha:G:default');
  assert.equal(sameCartLine(small, large), false);
});

test('mesmo arquivo produto e variante permanecem separados por tamanho', () => {
  const standard = line({ sizeKey: '50x50' });
  const custom = line({ sizeKey: '60x60' });

  assert.notEqual(cartLineId(standard), cartLineId(custom));
  assert.equal(sameCartLine(standard, custom), false);
});

test('alias de produto converge para a chave canônica', () => {
  assert.equal(
    cartLineId(line({ product: 'retangular', sizeKey: 'default' })),
    'drive-file-001:lateral:default:default'
  );
  assert.equal(
    cartLineId(line({ product: 'redondo-indefinido', sizeKey: '150x150' })),
    'drive-file-001:painel-150:default:150x150'
  );
});

test('sacolinha lê variante legada de details.size e exige variante', () => {
  const legacy = line({
    product: 'sacolinha',
    variantKey: undefined,
    sizeKey: undefined,
    details: { size: 'M' }
  });
  assert.equal(cartLineId(legacy), 'drive-file-001:sacolinha:M:M');

  assert.throws(
    () => cartLineId(line({
      product: 'sacolinha',
      variantKey: undefined,
      sizeKey: 'default',
      details: {}
    })),
    error => error.code === 'VARIANTE_OBRIGATORIA'
  );
});

test('quantidade preço tema e observações não alteram a identidade', () => {
  const base = line();
  const changed = line({
    qty: 200,
    unitPrice: 0.01,
    theme: 'OUTRO TEMA',
    details: { observations: 'Outra observação' }
  });

  assert.equal(cartLineId(base), cartLineId(changed));
});

test('anexa identidade sem substituir o ID legado da arte por acidente', () => {
  const attached = attachCartLineIdentity(line());

  assert.equal(attached.id, 'drive-file-001');
  assert.equal(attached.driveFileId, 'drive-file-001');
  assert.equal(attached.lineId, 'drive-file-001:50x50:default:50x50');
  assert.equal(attached.itemId, attached.lineId);
  assert.equal(Object.isFrozen(attached), true);
});

test('indexa linhas distintas e rejeita duplicação real', () => {
  const lines = [
    line(),
    line({ product: 'painel-150', sizeKey: '150x150' })
  ];
  const index = indexCartLines(lines);

  assert.equal(index.size, 2);
  assert.equal(index.get('drive-file-001:50x50:default:50x50').index, 0);

  assert.throws(
    () => indexCartLines([line(), line({ qty: 20 })]),
    error => (
      error.code === 'CART_LINE_ID_DUPLICATED' &&
      error.firstIndex === 0 &&
      error.duplicateIndex === 1
    )
  );
});

test('localiza linha pelo contrato completo e ignora legado inválido', () => {
  const lines = [
    { id: '', product: '' },
    line({ product: 'painel-150', sizeKey: '150x150' }),
    line()
  ];

  const result = findCartLine(lines, line());
  assert.equal(result.index, 2);
  assert.equal(result.lineId, 'drive-file-001:50x50:default:50x50');
  assert.equal(findCartLine(lines, { id: '', product: '' }), null);
});

test('falha fechada sem arquivo ou produto configurado', () => {
  assert.throws(
    () => cartLineId(line({ id: '', driveFileId: '' })),
    error => error.code === 'CART_LINE_DRIVE_FILE_ID_REQUIRED'
  );
  assert.throws(
    () => cartLineId(line({ product: 'produto-inexistente' })),
    error => error.code === 'CART_LINE_PRODUCT_KEY_INVALID'
  );
});
