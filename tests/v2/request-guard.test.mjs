import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSafeRequestLog,
  constantTimeEqualSecrets,
  createRateLimitKeys,
  validateBodyByteLength,
  validatePublicOrderRequest
} from '../../src/v2/http/request-guard.mjs';

const validRequest = {
  method: 'POST',
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'content-length': '1024',
    origin: 'https://artes.example.test',
    'sec-fetch-site': 'same-origin',
    'idempotency-key': '6dcfa85f-4401-49ca-a19b-1b9ce61cc638',
    'x-request-id': 'req-123'
  }
};

const options = {
  allowedOrigins: ['https://artes.example.test'],
  maxJsonBytes: 128 * 1024
};

test('aceita requisição JSON same-origin com chave de idempotência', () => {
  const result = validatePublicOrderRequest(validRequest, options);

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.errors, []);
  assert.equal(result.request.origin, 'https://artes.example.test');
  assert.equal(result.request.idempotencyKey, '6dcfa85f-4401-49ca-a19b-1b9ce61cc638');
});

test('rejeita método diferente de POST', () => {
  const result = validatePublicOrderRequest({
    ...validRequest,
    method: 'GET'
  }, options);

  assert.equal(result.ok, false);
  assert.equal(result.status, 405);
  assert.ok(result.errors.includes('METHOD_NOT_ALLOWED'));
});

test('rejeita Content-Type incorreto', () => {
  const result = validatePublicOrderRequest({
    ...validRequest,
    headers: { ...validRequest.headers, 'content-type': 'text/plain' }
  }, options);

  assert.equal(result.status, 415);
  assert.ok(result.errors.includes('CONTENT_TYPE_NOT_JSON'));
});

test('rejeita corpo acima do limite informado', () => {
  const result = validatePublicOrderRequest({
    ...validRequest,
    headers: { ...validRequest.headers, 'content-length': String(129 * 1024) }
  }, options);

  assert.equal(result.status, 413);
  assert.ok(result.errors.includes('REQUEST_BODY_TOO_LARGE'));
});

test('rejeita origem não autorizada e requisição cross-site', () => {
  const result = validatePublicOrderRequest({
    ...validRequest,
    headers: {
      ...validRequest.headers,
      origin: 'https://malicioso.example',
      'sec-fetch-site': 'cross-site'
    }
  }, options);

  assert.equal(result.status, 403);
  assert.ok(result.errors.includes('ORIGIN_NOT_ALLOWED'));
  assert.ok(result.errors.includes('CROSS_SITE_REQUEST_REJECTED'));
});

test('rejeita origem ausente por padrão', () => {
  const headers = { ...validRequest.headers };
  delete headers.origin;
  const result = validatePublicOrderRequest({ ...validRequest, headers }, options);

  assert.equal(result.status, 403);
  assert.ok(result.errors.includes('ORIGIN_REQUIRED'));
});

test('rejeita lista de origens não configurada', () => {
  const result = validatePublicOrderRequest(validRequest, { allowedOrigins: [] });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('ALLOWED_ORIGINS_NOT_CONFIGURED'));
});

test('rejeita chave de idempotência ausente ou malformada', () => {
  const headers = { ...validRequest.headers };
  delete headers['idempotency-key'];
  const missing = validatePublicOrderRequest({ ...validRequest, headers }, options);
  const invalid = validatePublicOrderRequest({
    ...validRequest,
    headers: { ...validRequest.headers, 'idempotency-key': 'chave com espaço e comprimento suficiente' }
  }, options);

  assert.ok(missing.errors.includes('IDEMPOTENCY_KEY_LENGTH_INVALID'));
  assert.ok(invalid.errors.includes('IDEMPOTENCY_KEY_FORMAT_INVALID'));
});

test('comparação de segredo aceita valor igual e rejeita diferente', async () => {
  assert.equal(await constantTimeEqualSecrets('token-seguro', 'token-seguro'), true);
  assert.equal(await constantTimeEqualSecrets('token-errado', 'token-seguro'), false);
  assert.equal(await constantTimeEqualSecrets('', 'token-seguro'), false);
});

test('gera chaves de rate limit com HMAC sem expor dados originais', async () => {
  const keys = await createRateLimitKeys({
    salt: 'segredo-de-rate-limit-com-tamanho-suficiente',
    ip: '203.0.113.9',
    idempotencyKey: '6dcfa85f-4401-49ca-a19b-1b9ce61cc638',
    phone: '+55 (81) 99999-9999',
    fingerprint: 'a'.repeat(64)
  });

  assert.match(keys.ip, /^rate:v2:ip:[0-9a-f]{64}$/);
  assert.match(keys.phone, /^rate:v2:phone:[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(keys).includes('203.0.113.9'), false);
  assert.equal(JSON.stringify(keys).includes('81999999999'), false);
  assert.equal(JSON.stringify(keys).includes('6dcfa85f'), false);
});

test('rejeita salt de rate limit curto', async () => {
  await assert.rejects(
    () => createRateLimitKeys({ salt: 'curto', ip: '203.0.113.9' }),
    error => error && error.code === 'RATE_LIMIT_SALT_TOO_SHORT'
  );
});

test('log seguro preserva somente sufixos de hashes e metadados operacionais', async () => {
  const validation = validatePublicOrderRequest(validRequest, options);
  const rateKeys = await createRateLimitKeys({
    salt: 'segredo-de-rate-limit-com-tamanho-suficiente',
    ip: '203.0.113.9',
    idempotencyKey: validation.request.idempotencyKey,
    phone: '+55 (81) 99999-9999',
    fingerprint: 'a'.repeat(64)
  });
  const log = buildSafeRequestLog({
    validation,
    rateKeys,
    environment: 'staging',
    status: 201,
    latencyMs: 42
  });

  assert.equal(log.validationOk, true);
  assert.equal(log.environment, 'staging');
  assert.equal(log.status, 201);
  assert.equal(log.latencyMs, 42);
  assert.equal(log.ipHash.length, 12);
  assert.equal(JSON.stringify(log).includes('203.0.113.9'), false);
  assert.equal(JSON.stringify(log).includes('81999999999'), false);
});

test('valida tamanho real do corpo em bytes', () => {
  const small = validateBodyByteLength(JSON.stringify({ ok: true }), 1024);
  const large = validateBodyByteLength('á'.repeat(600), 1024);

  assert.equal(small.ok, true);
  assert.equal(large.ok, false);
  assert.equal(large.error, 'REQUEST_BODY_TOO_LARGE');
  assert.equal(large.bytes, 1200);
});
