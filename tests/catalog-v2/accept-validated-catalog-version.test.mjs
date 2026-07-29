import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptValidatedCatalogVersion } from '../../scripts/catalog-v2/accept-validated-catalog-version.mjs';

async function fixture(report, acceptedVersion = 49) {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-auto-accept-'));
  const reportPath = join(dir, 'report.json');
  const statePath = join(dir, 'accepted.json');
  await writeFile(reportPath, JSON.stringify(report));
  await writeFile(statePath, JSON.stringify({ acceptedCatalogVersion: acceptedVersion }));
  return { reportPath, statePath };
}

const validReport = version => ({
  ok: true,
  catalogVersion: version,
  generatedAt: '2026-07-29T07:00:00.000Z',
  traversalComplete: true,
  rejectedCount: 0,
  differenceCount: 0
});

test('aceita versão nova após validação integral', async () => {
  const paths = await fixture(validReport(50));
  const result = await acceptValidatedCatalogVersion(paths);
  assert.equal(result.changed, true);
  const state = JSON.parse(await readFile(paths.statePath, 'utf8'));
  assert.equal(state.acceptedCatalogVersion, 50);
  assert.equal(state.validation.traversalComplete, true);
});

test('não altera arquivo quando a versão já foi aceita', async () => {
  const paths = await fixture(validReport(49));
  const before = await readFile(paths.statePath, 'utf8');
  const result = await acceptValidatedCatalogVersion(paths);
  assert.equal(result.changed, false);
  assert.equal(await readFile(paths.statePath, 'utf8'), before);
});

test('rejeita versão com diferenças, rejeições ou percurso incompleto', async () => {
  for (const patch of [
    { differenceCount: 1 },
    { rejectedCount: 1 },
    { traversalComplete: false },
    { ok: false }
  ]) {
    const paths = await fixture({ ...validReport(50), ...patch });
    await assert.rejects(
      acceptValidatedCatalogVersion(paths),
      /CATALOG_VERSION_NOT_ELIGIBLE_FOR_AUTO_ACCEPT/
    );
  }
});

test('bloqueia regressão de versão', async () => {
  const paths = await fixture(validReport(48));
  await assert.rejects(
    acceptValidatedCatalogVersion(paths),
    /CATALOG_VERSION_REGRESSION/
  );
});
