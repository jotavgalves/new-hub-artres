import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCatalogReadonlyInspection } from '../../scripts/catalog-v2/run-staging-catalog-readonly-inspection.mjs';
import { verifyCatalogBridgeDisabled } from '../../scripts/catalog-v2/verify-staging-catalog-bridge-disabled.mjs';
import { buildCatalogInspectionComment } from '../../scripts/catalog-v2/post-catalog-inspection-status.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function previewPayload({ folders = 0, artworks = 0, version = 7, differences = 0, rejected = 0 } = {}) {
  return {
    ok: differences === 0 && rejected === 0,
    readOnly: true,
    source: 'legacy-public-api',
    catalogVersion: version,
    upstream: { folderCount: folders, artworkCount: artworks },
    v2: { catalogVersion: version, rejectedCount: rejected, folders: [], artworks: [] },
    comparison: { totalDifferences: differences, equivalent: differences === 0 }
  };
}

test('usa IDs brutos apenas para navegação e não os persiste no relatório', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-runtime-'));
  const reportPath = join(dir, 'report.json');
  const seen = [];
  const fetchMock = async function(url, init = {}) {
    assert.equal(this, globalThis);
    const parsed = new URL(url);
    seen.push({ url: parsed, init });
    assert.equal(init.method, 'GET');

    if (parsed.hostname === 'staging.example.com' && parsed.pathname === '/health') {
      return jsonResponse({
        ok: true,
        catalogReadonlyBridge: { enabled: true, configured: true }
      });
    }

    const mode = parsed.searchParams.get('mode');
    const folderId = parsed.searchParams.get('folderId');

    if (parsed.hostname === 'staging.example.com') {
      assert.equal(parsed.pathname, '/internal/v2/catalog/preview');
      assert.equal(init.headers['x-staging-token'], 't'.repeat(40));
      if (mode === 'themes') return jsonResponse(previewPayload({ folders: 1 }));
      if (mode === 'products' && folderId === 'theme-1') return jsonResponse(previewPayload({ folders: 2 }));
      if (mode === 'products' && folderId === 'sub-1') return jsonResponse(previewPayload({ folders: 1 }));
      if (mode === 'items' && folderId?.includes('theme-1')) return jsonResponse(previewPayload({ artworks: 2 }));
      if (mode === 'items' && folderId?.includes('sub-1')) return jsonResponse(previewPayload({ artworks: 2 }));
    }

    if (parsed.hostname === 'legacy.example.com') {
      assert.equal(parsed.pathname, '/api/drive');
      assert.equal(Object.hasOwn(init.headers, 'x-staging-token'), false);
      if (mode === 'themes') {
        return jsonResponse({ ok: true, folders: [{ id: 'theme-1', kind: 'theme' }] });
      }
      if (mode === 'products' && folderId === 'theme-1') {
        return jsonResponse({
          ok: true,
          folders: [
            { id: 'sub-1', kind: 'folder' },
            { id: 'catalog-index-product:theme-1:50x50:Bolinhas', kind: 'product', directItems: true }
          ]
        });
      }
      if (mode === 'products' && folderId === 'sub-1') {
        return jsonResponse({
          ok: true,
          folders: [{ id: 'catalog-index-product:sub-1:50x50:Bolinhas', kind: 'product', directItems: true }]
        });
      }
      if (mode === 'items' && folderId?.includes('theme-1')) {
        return jsonResponse({ ok: true, items: [{ id: 'art-1' }, { id: 'art-2' }] });
      }
      if (mode === 'items' && folderId?.includes('sub-1')) {
        return jsonResponse({ ok: true, items: [{ id: 'art-2' }, { id: 'art-3' }] });
      }
    }

    return jsonResponse({ ok: false, error: 'UNEXPECTED_REQUEST' }, 500);
  };

  try {
    const report = await runCatalogReadonlyInspection({
      stagingUrl: 'https://staging.example.com',
      legacyBaseUrl: 'https://legacy.example.com',
      token: 't'.repeat(40),
      reportPath,
      fetch: fetchMock
    });

    assert.equal(report.ok, true);
    assert.equal(report.themeCount, 1);
    assert.equal(report.folderCount, 2);
    assert.equal(report.productCount, 2);
    assert.equal(report.artworkCount, 3);
    assert.equal(report.requestCount, 11);
    assert.equal(report.traversalComplete, true);
    const persisted = await readFile(reportPath, 'utf8');
    assert.equal(persisted.includes('theme-1'), false);
    assert.equal(persisted.includes('art-1'), false);
    assert.equal(persisted.includes('legacy.example.com'), false);
    assert.equal(persisted.includes('staging.example.com'), false);
    assert.equal(seen.length, 11);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falha sanitizada e contabiliza divergência encontrada pela ponte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-runtime-failure-'));
  const reportPath = join(dir, 'report.json');
  let calls = 0;
  const fetchMock = async url => {
    calls += 1;
    const parsed = new URL(url);
    if (parsed.pathname === '/health') {
      return jsonResponse({ ok: true, catalogReadonlyBridge: { enabled: true, configured: true } });
    }
    if (parsed.hostname === 'legacy.example.com') {
      return jsonResponse({ ok: true, folders: [{ id: 'theme-secret' }] });
    }
    return jsonResponse(previewPayload({ folders: 1, differences: 1 }));
  };

  try {
    await assert.rejects(
      runCatalogReadonlyInspection({
        stagingUrl: 'https://staging.example.com',
        legacyBaseUrl: 'https://legacy.example.com',
        token: 't'.repeat(40),
        reportPath,
        fetch: fetchMock
      }),
      error => error?.code === 'CATALOG_SHADOW_DIFFERENCE_FOUND'
    );
    const persisted = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(JSON.stringify(persisted).includes('theme-secret'), false);
    assert.equal(persisted.error, 'CATALOG_SHADOW_DIFFERENCE_FOUND');
    assert.equal(persisted.differenceCount, 1);
    assert.equal(calls, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verificação final exige ponte desativada e rota bloqueada', async () => {
  const fetchMock = async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/health') {
      return jsonResponse({ ok: true, catalogReadonlyBridge: { enabled: false, configured: false } });
    }
    return jsonResponse({
      ok: false,
      error: 'CATALOG_READONLY_BRIDGE_DISABLED',
      readOnly: true
    }, 503);
  };

  const result = await verifyCatalogBridgeDisabled({
    stagingUrl: 'https://staging.example.com',
    token: 't'.repeat(40),
    fetch: fetchMock
  });
  assert.deepEqual(result, {
    ok: true,
    bridgeEnabled: false,
    bridgeConfigured: false,
    previewBlocked: true
  });
});

test('comentário público contém somente contagens e código genérico', () => {
  const comment = buildCatalogInspectionComment({
    report: {
      catalogVersion: 8,
      requestCount: 12,
      themeCount: 3,
      folderCount: 7,
      productCount: 4,
      artworkCount: 99,
      rejectedCount: 0,
      differenceCount: 0,
      traversalComplete: true,
      error: 'CATALOG_GENERIC_FAILURE',
      secret: 'should-not-appear',
      url: 'https://private.example'
    },
    inspectionOutcome: 'failure',
    deactivationOutcome: 'success',
    verifyOutcome: 'success',
    rollbackOutcome: 'skipped'
  });
  assert.match(comment, /Artes únicas: 99/);
  assert.match(comment, /Estado seguro confirmado ao final: \*\*sim\*\*/);
  assert.match(comment, /CATALOG_GENERIC_FAILURE/);
  assert.equal(comment.includes('should-not-appear'), false);
  assert.equal(comment.includes('private.example'), false);
});
