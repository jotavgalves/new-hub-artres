import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCT_REGISTRY,
  REGISTRY_METADATA,
  buildItemId,
  canActivateProduct,
  getProductDefinition,
  requireProductDefinition,
  resolveProductKey,
  validateRegistry
} from '../../src/v2/products/registry.mjs';

test('o registro permanece passivo e fora da produção', () => {
  assert.equal(REGISTRY_METADATA.mode, 'passive-baseline');
  assert.equal(REGISTRY_METADATA.loadedByProduction, false);
  assert.equal(Object.isFrozen(PRODUCT_REGISTRY), true);
});

test('produto desconhecido não recebe fallback silencioso', () => {
  assert.equal(resolveProductKey('produto-inexistente'), null);
  assert.equal(getProductDefinition('produto-inexistente'), null);

  assert.throws(
    () => requireProductDefinition('produto-inexistente'),
    error => error && error.code === 'PRODUTO_NAO_CONFIGURADO'
  );
});

test('aliases conhecidos resolvem para a chave canônica', () => {
  assert.equal(resolveProductKey('redondo-indefinido'), 'painel-150');
  assert.equal(resolveProductKey('retangular'), 'lateral');
  assert.equal(getProductDefinition('retangular').label, 'Lateral');
});

test('bolinhas permanecem bloqueadas enquanto o preço estiver conflitante', () => {
  const bolinhas = requireProductDefinition('50x50');

  assert.equal(bolinhas.validationStatus, 'blocked-conflict');
  assert.equal(bolinhas.pricing.displayedUnitPrice, 9.75);
  assert.equal(bolinhas.pricing.frontendAdditionalUnitPrice, 9.90);
  assert.equal(bolinhas.pricing.packagePrice, 58.90);
  assert.equal(canActivateProduct('50x50'), false);
});

test('nenhum produto observado pode ser ativado automaticamente', () => {
  for (const key of Object.keys(PRODUCT_REGISTRY)) {
    assert.equal(canActivateProduct(key), false, `${key} não deveria estar ativo`);
  }
});

test('itemId inclui arquivo, produto, variante e tamanho', () => {
  assert.equal(
    buildItemId({
      driveFileId: 'arquivo-123',
      productKey: 'painel-150',
      variantKey: 'padrao',
      sizeKey: '150x150'
    }),
    'arquivo-123:painel-150:padrao:150x150'
  );
});

test('sacolinha exige variante na identidade', () => {
  assert.throws(
    () => buildItemId({ driveFileId: 'arquivo-456', productKey: 'sacolinha' }),
    error => error && error.code === 'VARIANTE_OBRIGATORIA'
  );

  assert.equal(
    buildItemId({ driveFileId: 'arquivo-456', productKey: 'sacolinha', variantKey: 'P', sizeKey: '15x20' }),
    'arquivo-456:sacolinha:P:15x20'
  );
});

test('arquivo do Drive é obrigatório na identidade', () => {
  assert.throws(
    () => buildItemId({ driveFileId: '', productKey: 'painel-150' }),
    error => error && error.code === 'DRIVE_FILE_ID_OBRIGATORIO'
  );
});

test('estrutura do registro não possui colisões internas', () => {
  const result = validateRegistry();
  assert.deepEqual(result, { ok: true, errors: [] });
});
