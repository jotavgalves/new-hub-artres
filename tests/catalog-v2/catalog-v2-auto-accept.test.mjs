import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogRouteKey,
  chunkRows,
  normalizeSearchText
} from '../../scripts/catalog-v2/publish-accepted-catalog-v2.mjs';

test('gera chaves determinísticas para rotas navegáveis', () => {
  assert.equal(catalogRouteKey('themes'), 'themes');
  assert.equal(catalogRouteKey('products', { folderId: 'tema-1' }), 'products:tema-1');
  assert.equal(
    catalogRouteKey('items', { folderId: 'catalog-index-product:abc:50x50:Teste', product: '50x50' }),
    'items:catalog-index-product:abc:50x50:Teste:50x50'
  );
});

test('normaliza busca em português sem conservar acentos ou pontuação', () => {
  assert.equal(normalizeSearchText('  Aniversário — 1º Ano_2657  '), 'aniversario 1o ano 2657');
});

test('divide lotes respeitando quantidade e bytes sem perder linhas', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: index + 1, value: 'x'.repeat(25) }));
  const batches = chunkRows(rows, 3, 500);
  assert.deepEqual(batches.map(batch => batch.length), [3, 3, 1]);
  assert.deepEqual(batches.flat(), rows);
});

test('rejeita uma linha individual maior que o limite do lote', () => {
  assert.throws(
    () => chunkRows([{ value: 'x'.repeat(1000) }], 100, 100),
    /CATALOG_BATCH_ROW_TOO_LARGE/
  );
});
