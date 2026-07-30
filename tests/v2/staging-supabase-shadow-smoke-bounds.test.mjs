import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('tests/v2/run-staging-supabase-shadow-remote-smoke.mjs', 'utf8');

test('smoke da sombra consulta somente pedidos recentes dentro do limite de resposta', () => {
  assert.match(source, /const ORDER_LIST_LIMIT = 20;/);
  assert.equal((source.match(/p_limit: ORDER_LIST_LIMIT/g) || []).length, 2);
  assert.doesNotMatch(source, /p_limit:\s*100/);
  assert.match(source, /const MAX_RESPONSE_BYTES = 64 \* 1024;/);
});
