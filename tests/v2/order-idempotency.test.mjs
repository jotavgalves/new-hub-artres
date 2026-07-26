import test from 'node:test';
import assert from 'node:assert/strict';

import {
  completeIdempotencyRecord,
  createIdempotencyRecord,
  createOrderIntentFingerprint,
  decideIdempotency,
  failIdempotencyRecord,
  idempotencyStorageKey,
  normalizeIdempotencyKey,
  renewIdempotencyRecord,
  validateIdempotencyRecord
} from '../../src/v2/orders/idempotency.mjs';

const order = {
  schemaVersion: 2,
  orderNumber: 'PENDENTE',
  seller: { id: 'ana', label: 'Ana' },
  customer: { name: 'Cliente', whatsapp: '5581999999999' },
  integrity: { catalogVersion: 49, configVersion: 3 },
  items: [
    {
      itemId: 'drive-file-1:50x50:default:50x50',
      driveFileId: 'drive-file-1',
      code: '2657',
      productKey: '50x50',
      productName: 'Bolinhas 50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6
    }
  ]
};

const key = '6dcfa85f-4401-49ca-a19b-1b9ce61cc638';
const now = new Date('2026-07-26T18:00:00.000Z');

test('fingerprint ignora nome e ordem dos itens, mas preserva intenção comercial', async () => {
  const first = await createOrderIntentFingerprint(order);
  const second = await createOrderIntentFingerprint({
    ...order,
    customer: { ...order.customer, name: 'Outro Nome' },
    items: [...order.items].reverse()
  });
  const changed = await createOrderIntentFingerprint({
    ...order,
    items: [{ ...order.items[0], quantity: 8 }]
  });

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test('chave de armazenamento usa hash e não expõe chave original', async () => {
  const storageKey = await idempotencyStorageKey(key);

  assert.match(storageKey, /^idempotency:v2:[0-9a-f]{64}$/);
  assert.equal(storageKey.includes(key), false);
});

test('valida formato e comprimento da chave', () => {
  assert.equal(normalizeIdempotencyKey(key), key);
  assert.throws(
    () => normalizeIdempotencyKey('curta'),
    error => error && error.code === 'IDEMPOTENCY_KEY_LENGTH_INVALID'
  );
  assert.throws(
    () => normalizeIdempotencyKey('chave com espaços e tamanho suficiente'),
    error => error && error.code === 'IDEMPOTENCY_KEY_FORMAT_INVALID'
  );
});

test('cria reserva válida em estado processing', async () => {
  const fingerprint = await createOrderIntentFingerprint(order);
  const record = await createIdempotencyRecord({
    key,
    fingerprint,
    requestId: 'req-1',
    now,
    ttlMs: 60_000
  });

  assert.equal(record.status, 'processing');
  assert.equal(record.attempt, 1);
  assert.equal(record.expiresAt, '2026-07-26T18:01:00.000Z');
  assert.deepEqual(validateIdempotencyRecord(record), { ok: true, errors: [] });
});

test('nova chave recebe ACCEPT_NEW', async () => {
  const fingerprint = await createOrderIntentFingerprint(order);
  const decision = decideIdempotency(null, { fingerprint, now });

  assert.deepEqual(decision, {
    action: 'ACCEPT_NEW',
    status: 201,
    shouldReserve: true,
    replayed: false,
    error: ''
  });
});

test('mesma chave em processamento retorna IN_PROGRESS', async () => {
  const fingerprint = await createOrderIntentFingerprint(order);
  const record = await createIdempotencyRecord({ key, fingerprint, now, ttlMs: 60_000 });
  const decision = decideIdempotency(record, {
    fingerprint,
    now: new Date('2026-07-26T18:00:30.000Z')
  });

  assert.equal(decision.action, 'IN_PROGRESS');
  assert.equal(decision.status, 409);
  assert.equal(decision.retryAfterSeconds, 30);
  assert.equal(decision.shouldReserve, false);
});

test('registro concluído retorna replay sem criar outro pedido', async () => {
  const fingerprint = await createOrderIntentFingerprint(order);
  const record = await createIdempotencyRecord({ key, fingerprint, now });
  const completed = completeIdempotencyRecord(record, {
    orderNumber: 'PED2600001A',
    now: new Date('2026-07-26T18:00:10.000Z'),
    response: { ok: true, orderNumber: 'PED2600001A', customer: 'não deve aparecer' }
  });
  const decision = decideIdempotency(completed, {
    fingerprint,
    now: new Date('2026-07-26T18:01:00.000Z')
  });

  assert.equal(decision.action, 'REPLAY_COMPLETED');
  assert.equal(decision.replayed, true);
  assert.equal(decision.orderNumber, 'PED2600001A');
  assert.deepEqual(decision.response, {
    ok: true,
    orderNumber: 'PED2600001A',
    replayed: true
  });
  assert.equal(JSON.stringify(decision).includes('customer'), false);
});

test('mesma chave com fingerprint diferente é conflito', async () => {
  const fingerprint = await createOrderIntentFingerprint(order);
  const different = await createOrderIntentFingerprint({
    ...order,
    items: [{ ...order.items[0], quantity: 8 }]
  });
  const record = await createIdempotencyRecord({ key, fingerprint, now });
  const decision = decideIdempotency(record, { fingerprint: different, now });

  assert.equal(decision.action, 'REJECT_CONFLICT');
  assert.equal(decision.status, 409);
  assert.equal(decision.error, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
});

test('reserva expirada pode ser renovada aumentando tentativa', async () => {
  const fingerprint = await createOrderIntentFingerprint(order);
  const record = await createIdempotencyRecord({ key, fingerprint, now, ttlMs: 60_000 });
  const expiredAt = new Date('2026-07-26T18:02:00.000Z');
  const decision = decideIdempotency(record, { fingerprint, now: expiredAt });
  const renewed = renewIdempotencyRecord(record, {
    now: expiredAt,
    ttlMs: 60_000,
    requestId: 'req-2'
  });

  assert.equal(decision.action, 'RETRY_EXPIRED');
  assert.equal(decision.shouldReserve, true);
  assert.equal(renewed.attempt, 2);
  assert.equal(renewed.requestId, 'req-2');
  assert.equal(renewed.expiresAt, '2026-07-26T18:03:00.000Z');
});

test('falha recuperável permite nova tentativa', async () => {
  const fingerprint = await createOrderIntentFingerprint(order);
  const record = await createIdempotencyRecord({ key, fingerprint, now });
  const failed = failIdempotencyRecord(record, {
    now: new Date('2026-07-26T18:00:10.000Z'),
    failureCode: 'DATABASE_TEMPORARILY_UNAVAILABLE'
  });
  const decision = decideIdempotency(failed, { fingerprint, now });

  assert.equal(failed.status, 'failed-retryable');
  assert.equal(decision.action, 'RETRY_FAILED');
  assert.equal(decision.shouldReserve, true);
});
