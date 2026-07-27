import test from 'node:test';
import assert from 'node:assert/strict';

import { compareCatalogShadow } from '../../src/v2/catalog/shadow-compare.mjs';

const legacy = {
  catalogVersion: 49,
  folders: [
    {
      id: 'theme-1',
      parentId: 'root-bolinhas',
      rootDriveId: 'root-bolinhas',
      name: '1 ANO',
      theme: '1 ANO',
      product: 'Bolinhas',
      kind: 'folder'
    }
  ],
  items: [
    {
      id: 'file-2657',
      code: '2657',
      theme: '1 ANO',
      subtheme: '',
      product: '50x50',
      size: '50x50',
      image: 'https://legacy.example.test/file-2657.jpg'
    }
  ]
};

const v2 = {
  catalogVersion: 49,
  folders: [
    {
      id: 'theme-1',
      parentId: 'root-bolinhas',
      rootDriveId: 'root-bolinhas',
      name: '1 ANO',
      theme: '1 ANO',
      productKey: '50x50',
      kind: 'folder'
    }
  ],
  artworks: [
    {
      driveFileId: 'file-2657',
      code: '2657',
      theme: '1 ANO',
      subtheme: '',
      productKey: '50x50',
      sizeKey: '50x50',
      image: 'https://v2.example.test/file-2657.jpg'
    }
  ]
};

test('considera equivalentes contratos com mesma identidade e semântica', () => {
  const report = compareCatalogShadow({ legacy, v2 });

  assert.equal(report.equivalent, true);
  assert.equal(report.totalDifferences, 0);
  assert.equal(report.summary.legacyArtworks, 1);
  assert.equal(report.summary.v2Artworks, 1);
  assert.deepEqual(report.errors, []);
  assert.equal(report.valuesExposed, false);
  assert.equal(Object.isFrozen(report), true);
});

test('diferença de URL da imagem não é exposta quando ambas existem', () => {
  const report = compareCatalogShadow({ legacy, v2 });

  assert.deepEqual(report.differences.artworks.changed, []);
  assert.equal(JSON.stringify(report).includes('legacy.example.test'), false);
  assert.equal(JSON.stringify(report).includes('v2.example.test'), false);
});

test('detecta arte ausente, extra e alterada por Drive ID', () => {
  const changedV2 = structuredClone(v2);
  changedV2.artworks[0].theme = '2 ANOS';
  changedV2.artworks.push({
    ...changedV2.artworks[0],
    driveFileId: 'file-extra',
    code: '9999'
  });

  const report = compareCatalogShadow({ legacy, v2: changedV2 });

  assert.equal(report.equivalent, false);
  assert.equal(report.summary.changedArtworks, 1);
  assert.equal(report.summary.extraArtworksInV2, 1);
  assert.deepEqual(report.differences.artworks.changed[0], {
    id: 'file-2657',
    fields: ['theme']
  });
  assert.deepEqual(report.differences.artworks.extra[0], { id: 'file-extra' });
});

test('mesmo código com Drive ID diferente é ausência e extra, não equivalência falsa', () => {
  const changedV2 = structuredClone(v2);
  changedV2.artworks[0].driveFileId = 'outro-arquivo';

  const report = compareCatalogShadow({ legacy, v2: changedV2 });

  assert.equal(report.equivalent, false);
  assert.equal(report.differences.artworks.totals.missing, 1);
  assert.equal(report.differences.artworks.totals.extra, 1);
});

test('detecta versão divergente mesmo com itens iguais', () => {
  const changedV2 = { ...v2, catalogVersion: 50 };
  const report = compareCatalogShadow({ legacy, v2: changedV2 });

  assert.equal(report.equivalent, false);
  assert.ok(report.errors.includes('CATALOG_VERSION_MISMATCH:49:50'));
});

test('normaliza referência explícita Bolinhas sem heurística', () => {
  const changedLegacy = structuredClone(legacy);
  changedLegacy.items[0].product = 'Bolinhas';

  const report = compareCatalogShadow({ legacy: changedLegacy, v2 });

  assert.equal(report.equivalent, true);
});

test('limita detalhes, mas preserva totais completos das diferenças', () => {
  const changedV2 = structuredClone(v2);
  changedV2.artworks = [];
  const changedLegacy = structuredClone(legacy);
  changedLegacy.items.push(
    { ...changedLegacy.items[0], id: 'file-2', code: '2' },
    { ...changedLegacy.items[0], id: 'file-3', code: '3' }
  );

  const report = compareCatalogShadow({ legacy: changedLegacy, v2: changedV2, maxDetails: 1 });

  assert.equal(report.differences.artworks.missing.length, 1);
  assert.equal(report.differences.artworks.totals.missing, 3);
  assert.equal(report.differences.artworks.truncated, true);
});
