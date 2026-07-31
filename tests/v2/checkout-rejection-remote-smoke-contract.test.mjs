import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('tests/v2/run-staging-checkout-invalid-rejections-remote-smoke.mjs', 'utf8');

test('smoke repete somente respostas transitórias com limite curto', () => {
  assert.match(source, /MAX_TRANSIENT_ATTEMPTS = 3/);
  assert.match(source, /TRANSIENT_HTTP_STATUSES = new Set\(\[429, 500, 502, 503, 504\]\)/);
  assert.match(source, /requestExpectedRejection/);
  assert.match(source, /isTransientResult/);
  assert.match(source, /attempt \* 750/);
});

test('resposta de sucesso para arte inválida continua sendo falha imediata', () => {
  assert.match(source, /status >= 200 && status < 300/);
  assert.match(source, /_NOT_REJECTED/);
  assert.match(source, /status !== 422/);
  assert.match(source, /actualCode !== testCase\.expectedCode/);
});

test('diagnóstico preserva status ou código sanitizado sem dados privados', () => {
  assert.match(source, /_HTTP_\$\{status \|\| 0\}/);
  assert.match(source, /publicCode\(result\?\.payload\?\.error, 'UNKNOWN_ERROR'\)/);
  assert.match(source, /assertPrivateValuesAbsent/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(?:driveFileId|whatsapp|idempotencyKey)/);
});
