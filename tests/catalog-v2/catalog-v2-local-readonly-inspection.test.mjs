import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCatalogV2LocalReadonlyInspection } from '../../scripts/catalog-v2/run-catalog-v2-local-readonly-inspection.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('percorre catálogo e compara o contrato V2 sem staging ativo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-v2-local-'));
  const reportPath = join(dir, 'report.json');
  const calls = [];

  const fetchMock = async function(url, init) {
    assert.equal(this, globalThis);
    const parsed = new URL(url);
    calls.push(parsed.toString());
    assert.equal(parsed.hostname, 'legacy.example.com');
    assert.equal(init.method, 'GET');
    assert.equal(Object.hasOwn(init.headers, 'Authorization'), false);

    if (parsed.pathname === '/api/catalog-meta') {
      return jsonResponse({ ok: true, catalogVersion: 9 });
    }

    const mode = parsed.searchParams.get('mode');
    const folderId = parsed.searchParams.get('folderId');

    if (mode === 'themes') {
      return jsonResponse({
        ok: true,
        source: 'catalog_index',
        folders: [{ id: 'theme-1', name: 'Tema 1', theme: 'Tema 1' }]
      });
    }
    if (mode === 'products' && folderId === 'theme-1') {
      return jsonResponse({
        ok: true,
        source: 'catalog_index',
        folders: [
          { id: 'sub-1', parentId: 'theme-1', name: 'Subtema', theme: 'Tema 1' },
          {
            id: 'catalog-index-product:theme-1:50x50:Bolinhas',
            parentId: 'theme-1',
            name: 'Bolinhas 50x50',
            kind: 'product',
            directItems: true,
            product: '50x50'
          }
        ]
      });
    }
    if (mode === 'products' && folderId === 'sub-1') {
      return jsonResponse({
        ok: true,
        source: 'catalog_index',
        folders: [{
          id: 'catalog-index-product:sub-1:50x50:Bolinhas',
          parentId: 'sub-1',
          name: 'Bolinhas 50x50',
          kind: 'product',
          directItems: true,
          product: '50x50'
        }]
      });
    }
    if (mode === 'items' && folderId?.includes('theme-1')) {
      return jsonResponse({
        ok: true,
        source: 'catalog_index',
        items: [
          { id: 'art-1', code: '1', theme: 'Tema 1', size: '50x50', image: 'https://img.example/1' },
          { id: 'art-2', code: '2', theme: 'Tema 1', size: '50x50', image: 'https://img.example/2' }
        ]
      });
    }
    if (mode === 'items' && folderId?.includes('sub-1')) {
      return jsonResponse({
        ok: true,
        source: 'catalog_index',
        items: [
          { id: 'art-2', code: '2', theme: 'Tema 1', size: '50x50', image: 'https://img.example/2' },
          { id: 'art-3', code: '3', theme: 'Tema 1', size: '50x50', image: 'https://img.example/3' }
        ]
      });
    }
    return jsonResponse({ ok: false, error: 'UNEXPECTED_REQUEST' }, 500);
  };

  try {
    const report = await runCatalogV2LocalReadonlyInspection({
      legacyBaseUrl: 'https://legacy.example.com',
      rootDriveId: 'root-folder-1234567890',
      reportPath,
      fetch: fetchMock
    });

    assert.equal(report.ok, true);
    assert.equal(report.executionMode, 'github-actions-local-contract');
    assert.equal(report.catalogVersion, 9);
    assert.equal(report.requestCount, 6);
    assert.equal(report.themeCount, 1);
    assert.equal(report.folderCount, 2);
    assert.equal(report.productCount, 2);
    assert.equal(report.artworkCount, 3);
    assert.equal(report.rejectedCount, 0);
    assert.equal(report.differenceCount, 0);
    assert.equal(report.traversalComplete, true);
    assert.deepEqual(report.rejectionSummary, []);
    assert.deepEqual(report.differenceSummary, []);

    const persisted = await readFile(reportPath, 'utf8');
    for (const forbidden of ['theme-1', 'sub-1', 'art-1', 'img.example', 'legacy.example.com']) {
      assert.equal(persisted.includes(forbidden), false);
    }
    assert.equal(calls.length, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('relatório de falha agrega somente códigos de rejeição', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-v2-local-failure-'));
  const reportPath = join(dir, 'report.json');
  const fetchMock = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/catalog-meta') {
      return jsonResponse({ ok: true, catalogVersion: 4 });
    }
    return jsonResponse({
      ok: true,
      folders: [{ id: 'theme-secret', name: 'Tema secreto' }],
      items: [{ id: 'art-secret', theme: 'Tema secreto', image: 'https://secret.example/image' }]
    });
  };

  try {
    await assert.rejects(
      runCatalogV2LocalReadonlyInspection({
        legacyBaseUrl: 'https://legacy.example.com',
        rootDriveId: 'root-folder-1234567890',
        reportPath,
        fetch: fetchMock
      }),
      error => error?.code === 'CATALOG_ROWS_REJECTED'
    );

    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.ok, false);
    assert.equal(report.error, 'CATALOG_ROWS_REJECTED');
    assert.equal(report.rejectedCount, 1);
    assert.deepEqual(report.rejectionSummary, [{ code: 'ARTWORK_CODE_MISSING', count: 1 }]);
    const text = JSON.stringify(report);
    assert.equal(text.includes('theme-secret'), false);
    assert.equal(text.includes('art-secret'), false);
    assert.equal(text.includes('secret.example'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
