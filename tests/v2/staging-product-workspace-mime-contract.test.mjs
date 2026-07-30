import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('smoke remoto aceita os MIME JavaScript válidos observados no edge', async () => {
  const source = await readFile('tests/v2/run-staging-accepted-catalog-remote-smoke.mjs', 'utf8');

  assert.match(source, /'application\/javascript'/);
  assert.match(source, /'text\/javascript'/);
  assert.match(source, /allowedContentTypes\.includes\(probe\.contentType\)/);
  assert.match(source, /workspaceContentType/);
  assert.doesNotMatch(source, /probe\.contentType !== expectedContentType/);
});
