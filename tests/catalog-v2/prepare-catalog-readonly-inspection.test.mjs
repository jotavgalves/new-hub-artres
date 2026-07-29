import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCatalogReadonlyInspectionFiles } from '../../scripts/catalog-v2/prepare-catalog-readonly-inspection.mjs';

const BASE = {
  name: 'new-hub-artres-v2-staging',
  main: 'staging/site-v2-worker/src/index-shadow.js',
  workers_dev: true,
  vars: {
    ENVIRONMENT: 'staging',
    STAGING_WRITE_ENABLED: 'true',
    STAGING_LOW_LEVEL_LEDGER_ENABLED: 'false',
    SUPABASE_SHADOW_ENABLED: 'true',
    CATALOG_READONLY_BRIDGE_ENABLED: 'false',
    CATALOG_READONLY_TIMEOUT_MS: '5000',
    CATALOG_READONLY_MAX_RESPONSE_BYTES: '2097152'
  },
  secrets: { required: ['STAGING_API_TOKEN'] }
};

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-inspection-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('gera configuração ativa temporária e configuração segura sem alterar a origem', async () => {
  await withTemp(async dir => {
    const sourcePath = join(dir, 'source.jsonc');
    const activePath = join(dir, 'active.jsonc');
    const safePath = join(dir, 'safe.jsonc');
    await writeFile(sourcePath, `${JSON.stringify(BASE, null, 2)}\n`);

    const result = await prepareCatalogReadonlyInspectionFiles({
      sourcePath,
      activePath,
      safePath,
      baseUrl: 'https://example.pages.dev',
      rootDriveId: 'root-folder-1234567890'
    });

    const source = JSON.parse(await readFile(sourcePath, 'utf8'));
    const active = JSON.parse(await readFile(activePath, 'utf8'));
    const safe = JSON.parse(await readFile(safePath, 'utf8'));

    assert.equal(result.ok, true);
    assert.deepEqual(source, BASE);
    assert.equal(active.vars.CATALOG_READONLY_BRIDGE_ENABLED, 'true');
    assert.equal(active.vars.CATALOG_LEGACY_BASE_URL, 'https://example.pages.dev');
    assert.equal(active.vars.CATALOG_V2_ROOT_DRIVE_ID, 'root-folder-1234567890');
    assert.equal(active.vars.STAGING_LOW_LEVEL_LEDGER_ENABLED, 'false');
    assert.equal(safe.vars.CATALOG_READONLY_BRIDGE_ENABLED, 'false');
    assert.equal(Object.hasOwn(safe.vars, 'CATALOG_LEGACY_BASE_URL'), false);
    assert.equal(Object.hasOwn(safe.vars, 'CATALOG_V2_ROOT_DRIVE_ID'), false);
  });
});

test('rejeita origem insegura e identificadores reais já versionados', async () => {
  await withTemp(async dir => {
    const sourcePath = join(dir, 'source.jsonc');
    const activePath = join(dir, 'active.jsonc');
    const safePath = join(dir, 'safe.jsonc');
    await writeFile(sourcePath, JSON.stringify(BASE));

    await assert.rejects(
      prepareCatalogReadonlyInspectionFiles({
        sourcePath,
        activePath,
        safePath,
        baseUrl: 'http://example.com/path?token=x',
        rootDriveId: 'root-folder-1234567890'
      }),
      error => error?.code === 'CATALOG_LEGACY_BASE_URL_INVALID'
    );

    const contaminated = structuredClone(BASE);
    contaminated.vars.CATALOG_LEGACY_BASE_URL = 'https://example.pages.dev';
    await writeFile(sourcePath, JSON.stringify(contaminated));
    await assert.rejects(
      prepareCatalogReadonlyInspectionFiles({
        sourcePath,
        activePath,
        safePath,
        baseUrl: 'https://example.pages.dev',
        rootDriveId: 'root-folder-1234567890'
      }),
      error => error?.code === 'CATALOG_REAL_IDENTIFIERS_MUST_NOT_BE_VERSIONED'
    );
  });
});
