import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

const BOLINHAS_ROOT = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';
const PAINEL_150_ROOT = '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-';

test('índice legado deixa de depender de reindexação manual', async () => {
  const workflow = await read('.github/workflows/reindex-drive-catalog.yml');

  assert.match(workflow, /schedule:\s*\n\s*- cron: '2,12,22,32,42,52 \* \* \* \*'/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group: drive-catalog-reindex/);
  assert.match(workflow, new RegExp(BOLINHAS_ROOT));
  assert.match(workflow, new RegExp(PAINEL_150_ROOT));
  assert.match(workflow, /for root in "\$\{roots\[@\]\}"/);
  assert.match(workflow, /node scripts\/reindex-drive-catalog\.mjs "\$\{args\[@\]\}"/);
});

test('catálogo rápido autenticado é atualizado a cada dez minutos', async () => {
  const workflow = await read('.github/workflows/catalog-v2-auto-accept.yml');

  assert.match(workflow, /schedule:\s*\n\s*- cron: '7,17,27,37,47,57 \* \* \* \*'/);
  assert.match(workflow, /group: catalog-v2-private-drive-sync/);
  assert.match(workflow, /SUPABASE_V2_URL: https:\/\/kueklnkznwpbobqwugns\.supabase\.co/);
  assert.match(workflow, /node scripts\/catalog-v2\/publish-private-drive-catalog-v2\.mjs/);
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
});
