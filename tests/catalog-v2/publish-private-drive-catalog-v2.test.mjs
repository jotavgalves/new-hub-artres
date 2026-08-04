import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chunkRows,
  runConfiguredPrivateDriveSync
} from '../../scripts/catalog-v2/publish-private-drive-catalog-v2.mjs';

test('sem credencial mantém a versão anterior e gera relatório explícito', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-private-'));
  const reportPath = join(dir, 'report.json');
  const result = await runConfiguredPrivateDriveSync({ serviceAccountJson: '', reportPath });
  assert.equal(result.ok, true);
  assert.equal(result.configured, false);
  assert.equal(result.action, 'NOT_CONFIGURED');
  assert.equal(result.accepted, false);
  const stored = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(stored.action, 'NOT_CONFIGURED');
});

test('divide a carga sem ultrapassar a contagem máxima', () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ driveId: `id-${index}`, payload: { index } }));
  const batches = chunkRows(rows, 100, 1_000_000);
  assert.deepEqual(batches.map(batch => batch.length), [100, 100, 5]);
});
