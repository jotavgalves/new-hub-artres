import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCatalogResponseV2,
  createCatalogContext,
  mapCatalogRowV2,
  mapCatalogRowsV2,
  validateCatalogContext
} from '../../src/v2/catalog/schema.mjs';
import {
  catalogProductReferences,
  resolveCatalogProductKey
} from '../../src/v2/products/catalog-references.mjs';

function context() {
  return createCatalogContext({
    catalogVersion: 49,
    roots: [
      {
        rootDriveId: 'root-bolinhas',
        driveId: 'bolinhas',
        productKey: '50x50',
        productName: 'Bolinhas 50x50',
        active: true
      },
      {
        rootDriveId: 'root-sacolinhas',
        driveId: 'sacolinhas',
        productKey: 'sacolinha',
        productName: 'Sacolinha de Festa',
        active: true
      }
    ]
  });
}

function artwork(overrides = {}) {
  return {
    drive_id: 'file-2657',
    parent_drive_id: 'theme-1-ano',
    root_drive_id: 'root-bolinhas',
    type: 'artwork',
    name: '2657_1-ANO_50X50.jpg',
    mime_type: 'image/jpeg',
    path: '1 ANO/2657_1-ANO_50X50.jpg',
    depth: 1,
    theme: '1 ANO',
    subtheme: '',
    product: 'Bolinhas',
    size: '50x50',
    code: '2657',
    thumbnail_url: 'https://example.test/file-2657.jpg',
    indexed_at: '2026-07-26T17:00:00.000Z',
    deleted_at: null,
    ...overrides
  };
}

test('referências de produto são exatas, não heurísticas', () => {
  assert.equal(resolveCatalogProductKey('50x50'), '50x50');
  assert.equal(resolveCatalogProductKey('Bolinhas 50x50'), '50x50');
  assert.equal(resolveCatalogProductKey('Bolinhas'), '50x50');
  assert.equal(resolveCatalogProductKey('Sacolinha de Festa'), 'sacolinha');
  assert.equal(resolveCatalogProductKey('bolinhas especiais'), null);
  assert.ok(catalogProductReferences('50x50').includes('bolinhas 50x50'));
  assert.ok(catalogProductReferences('50x50').includes('bolinhas'));
});

test('contexto do catálogo permanece passivo e versionado', () => {
  const value = context();

  assert.equal(value.schemaVersion, 2);
  assert.equal(value.catalogVersion, 49);
  assert.equal(value.loadedByProduction, false);
  assert.equal(value.roots['root-bolinhas'].productKey, '50x50');
  assert.deepEqual(validateCatalogContext(value), { ok: true, errors: [] });
  assert.equal(Object.isFrozen(value), true);
});

test('mapeia arte pela raiz configurada e mantém Drive ID como identidade', () => {
  const item = mapCatalogRowV2(artwork({ product: 'Bolinhas 50x50' }), context(), {
    expectedRootDriveId: 'root-bolinhas'
  });

  assert.equal(item.id, 'file-2657');
  assert.equal(item.driveFileId, 'file-2657');
  assert.equal(item.rootDriveId, 'root-bolinhas');
  assert.equal(item.code, '2657');
  assert.equal(item.productKey, '50x50');
  assert.equal(item.productName, 'Bolinhas 50x50');
  assert.equal(item.sizeKey, '50x50');
  assert.equal(item.kind, 'artwork');
});

test('mapeia pasta sem inventar código de arte', () => {
  const folder = mapCatalogRowV2({
    drive_id: 'theme-1-ano',
    parent_drive_id: 'root-bolinhas',
    root_drive_id: 'root-bolinhas',
    type: 'folder',
    name: '1 ANO',
    theme: '1 ANO',
    product: 'Bolinhas 50x50',
    depth: 1,
    path: '1 ANO',
    deleted_at: null
  }, context());

  assert.equal(folder.kind, 'folder');
  assert.equal(folder.id, 'theme-1-ano');
  assert.equal(folder.productKey, '50x50');
  assert.equal(Object.hasOwn(folder, 'code'), false);
});

test('mesmo código pode existir em arquivos diferentes sem colisão', () => {
  const result = mapCatalogRowsV2([
    artwork({ drive_id: 'file-a', code: '2657', product: 'Bolinhas 50x50' }),
    artwork({ drive_id: 'file-b', code: '2657', product: 'Bolinhas 50x50' })
  ], context(), { expectedRootDriveId: 'root-bolinhas' });

  assert.equal(result.acceptedCount, 2);
  assert.equal(result.items[0].code, result.items[1].code);
  assert.notEqual(result.items[0].driveFileId, result.items[1].driveFileId);
});

test('rejeita linha fora da raiz solicitada', () => {
  assert.throws(
    () => mapCatalogRowV2(artwork({ root_drive_id: 'root-sacolinhas', product: 'Sacolinha de Festa' }), context(), {
      expectedRootDriveId: 'root-bolinhas'
    }),
    error => error && error.code === 'ROW_OUTSIDE_REQUESTED_ROOT'
  );
});

test('rejeita raiz não configurada', () => {
  assert.throws(
    () => mapCatalogRowV2(artwork({ root_drive_id: 'root-desconhecida' }), context()),
    error => error && error.code === 'ROOT_DRIVE_NOT_CONFIGURED'
  );
});

test('rejeita produto explícito incompatível com a raiz', () => {
  assert.throws(
    () => mapCatalogRowV2(artwork({ product: 'Sacolinha de Festa' }), context()),
    error => error && error.code === 'PRODUCT_ROOT_MISMATCH'
  );
});

test('rejeita produto não registrado sem fallback para painel', () => {
  assert.throws(
    () => mapCatalogRowV2(artwork({ product: 'Produto Totalmente Novo' }), context()),
    error => error && error.code === 'PRODUCT_NOT_CONFIGURED'
  );
});

test('rejeita linha excluída e arte sem código', () => {
  assert.throws(
    () => mapCatalogRowV2(artwork({ deleted_at: '2026-07-26T17:00:00.000Z' }), context()),
    error => error && error.code === 'ROW_DELETED'
  );

  assert.throws(
    () => mapCatalogRowV2(artwork({ code: '', name: '' }), context()),
    error => error && error.code === 'ARTWORK_CODE_MISSING'
  );
});

test('resposta versionada informa rejeições sem ocultar truncamento lógico', () => {
  const response = buildCatalogResponseV2({
    context: context(),
    rootDriveId: 'root-bolinhas',
    rows: [
      artwork({ product: 'Bolinhas 50x50' }),
      artwork({ drive_id: 'file-invalid', product: 'Produto Novo' })
    ]
  });

  assert.equal(response.ok, false);
  assert.equal(response.schemaVersion, 2);
  assert.equal(response.catalogVersion, 49);
  assert.equal(response.acceptedCount, 1);
  assert.equal(response.rejectedCount, 1);
  assert.equal(response.artworks.length, 1);
  assert.equal(response.rejected[0].error, 'PRODUCT_NOT_CONFIGURED');
});

test('modo estrito falha quando qualquer linha é rejeitada', () => {
  assert.throws(
    () => buildCatalogResponseV2({
      context: context(),
      rootDriveId: 'root-bolinhas',
      rows: [artwork({ product: 'Produto Novo' })],
      strict: true
    }),
    error => error && error.code === 'CATALOG_ROWS_REJECTED'
  );
});
