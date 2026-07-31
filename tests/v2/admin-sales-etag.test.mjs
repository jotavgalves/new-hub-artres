import assert from 'node:assert/strict';
import test from 'node:test';

import { ifNoneMatchMatches } from '../../staging/site-v2-worker/src/ledger-inspection-routes.js';

const current = '"admin-sales-v1-12-25"';

test('If-None-Match aceita ETag forte e fraco equivalentes', () => {
  assert.equal(ifNoneMatchMatches(current, current), true);
  assert.equal(ifNoneMatchMatches(`W/${current}`, current), true);
  assert.equal(ifNoneMatchMatches(`w/ ${current}`, current), true);
});

test('If-None-Match aceita listas e curinga', () => {
  assert.equal(ifNoneMatchMatches(`"other", W/${current}`, current), true);
  assert.equal(ifNoneMatchMatches('*', current), true);
});

test('If-None-Match rejeita revisão ou limite diferentes', () => {
  assert.equal(ifNoneMatchMatches('"admin-sales-v1-13-25"', current), false);
  assert.equal(ifNoneMatchMatches('W/"admin-sales-v1-12-50"', current), false);
  assert.equal(ifNoneMatchMatches('', current), false);
  assert.equal(ifNoneMatchMatches('invalid', current), false);
});

test('If-None-Match rejeita cabeçalho excessivo', () => {
  assert.equal(ifNoneMatchMatches('x'.repeat(4097), current), false);
});
