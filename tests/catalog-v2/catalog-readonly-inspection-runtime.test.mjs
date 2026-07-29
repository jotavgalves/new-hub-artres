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

function previewPayload({ folders = [], artworks = [], version = 7, differences = 0, rejected = 0 } = {}) {
  return {
    ok: differences === 0 && rejected === 0,
    readOnly: true,
    source: 'legacy-public-api',
    catalogVersion: version,
    v2: { catalogVersion: version, rejectedCount: rejected, folders, artworks },
    comparison: { totalDifferences: differences, equivalent: differences === 0 }
  };
}

test('percorre temas, subpastas e produtos sem persistir IDs no relatório', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-runtime-'));
  const reportPath = join(dir, 'report.json');
  const seen = [];
  const fetchMock = async function(url, init = {}) {
    assert.equal(this, globalThis);
    const parsed = new URL(url);
    seen.push({ url: parsed, init });
    assert.equal(init.method, 'GET');

    if (parsed.pathname === '/health') {
      return jsonResponse({
        ok: true,
        catalogReadonlyBridge: { enabled: true, configured: true }
      });
    }

    assert.equal(parsed.pathname, '/internal/v2/catalog/preview');
    assert.equal(init.headers['x-staging-token'], 't'.repeat(40));
    const mode = parsed.searchParams.get('mode');
    const folderId = parsed.searchParams.get('folderId');

    if (mode === 'themes') {
      return jsonResponse(previewPayload({ folders: [{ id: 'theme-1' }] }));
    }
    if (mode === 'products' && folderId === 'theme-1') {
      return jsonResponse(previewPayload({
        folders: [
          { id: 'sub-1' },
          { id: 'catalog-index-product:theme-1:50x50:Bolinhas' }
        ]
      }));
    }
    if (mode === 'products' && folderId === 'sub-1') {
      return jsonResponse(previewPayload({
        folders: [{ id: 'catalog-index-product:sub-1:50x50:Bolinhas' }]
      }));
    }
    if (mode === 'items' && folderId?.includes('theme-1')) {
      return jsonResponse(previewPayload({ artworks: [{ id: 'art-1' }, { id: 'art-2' }] }));
    }
    if (mode === 'items' && folderId?.includes('sub-1')) {
      return jsonResponse(previewPayload({ artworks: [{ id: 'art-2' }, { id: 'art-3' }] }));
    }
    return jsonResponse({ ok: false, error: 'UNEXPECTED_REQUEST' }, 500);
  };

  try {
    const report = await runCatalogReadonlyInspection({
      stagingUrl: 'https://staging.example.com',
      token: 't'.repeat(40),
      reportPath,
      fetch: fetchMock
    });

    assert.equal(report.ok, true);
    assert.equal(report.themeCount, 1);
    assert.equal(report.folderCount, 2);
    assert.equal(report.productCount, 2);
    assert.equal(report.artworkCount, 3);
    assert.equal(report.requestCount, 5);
    assert.equal(report.traversalComplete, true);
    const persisted = await readFile(reportPath, 'utf8');
    assert.equal(persisted.includes('theme-1'), false);
    assert.equal(persisted.includes('art-1'), false);
    assert.equal(persisted.includes('staging.example.com'), false);
    assert.equal(seen.length, 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falha sanitizada quando a comparação encontra divergência', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-runtime-failure-'));
  const reportPath = join(dir, 'report.json');
  let calls = 0;
  const fetchMock = async url => {
    calls += 1;
    const parsed = new URL(url);
    if (parsed.pathname === '/health') {
      return jsonResponse({ ok: true, catalogReadonlyBridge: { enabled: true, configured: true } });
    }
    return jsonResponse(previewPayload({ folders: [{ id: 'theme-secret' }], differences: 1 }));
  };

  try {
    await assert.rejects(
      runCatalogReadonlyInspection({
        stagingUrl: 'https://staging.example.com',
        token: 't'.repeat(40),
        reportPath,
        fetch: fetchMock
      }),
      error => error?.code === 'CATALOG_PREVIEW_FAILED' || error?.code === 'CATALOG_SHADOW_DIFFERENCE_FOUND'
    );
    const persisted = await readFile(reportPath, 'utf8');
    assert.equal(persisted.includes('theme-secret'), false);
    assert.match(persisted, /CATALOG_/);
    assert.equal(calls, 2);
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
