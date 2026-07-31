import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/deploy-site-v2-staging.yml', 'utf8');
const wrapper = await readFile('tests/v2/run-staging-synthetic-remote-smoke-with-code.mjs', 'utf8');
const smoke = await readFile('tests/v2/run-staging-admin-cache-remote-smoke.mjs', 'utf8');

test('alterações no smoke do cache acionam o deploy de staging', () => {
  assert.match(workflow, /tests\/v2\/run-staging-admin-cache-remote-smoke\.mjs/);
  assert.match(wrapper, /run-staging-admin-cache-remote-smoke\.mjs/);
});

test('smoke remoto exige estabilização 304 revisão e evento ao vivo', () => {
  assert.match(smoke, /waitForStableNotModified/);
  assert.match(smoke, /ADMIN_CACHE_STABLE_304_TIMEOUT/);
  assert.match(smoke, /event === 'revision'/);
  assert.match(smoke, /ADMIN_CACHE_UPDATED_304_HTTP_/);
});
