import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createCurrentSafetySnapshot } from '../../src/v2/products/current-config-adapter.mjs';
import {
  finalizeOrderSubmissionV2,
  prepareOrderSubmissionV2
} from '../../src/v2/orders/submission-plan.mjs';

const fixtureUrl = new URL('../fixtures/v2/current-public-config.sanitized.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
const productSnapshot = createCurrentSafetySnapshot(fixture);

const catalogItems = [
  {
    driveFileId: 'drive-file-2657',
    code: '2657',
    originalName: '2657_1-ANO_50X50.jpg',
    theme: '1 ANO',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas 50x50',
    sizeKey: '50x50'
  }
];

const idempotencyKey = '6dcfa85f-4401-49ca-a19b-1b9ce61cc638';
const allowedOrigins = ['https://artes.example.test'];
const now = new Date('2026-07-26T18:00:00.000Z');

function request(overrides = {}) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://artes.example.test',
      'sec-fetch-site': 'same-origin',
      'idempotency-key': idempotencyKey,
      'x-request-id': 'req-1'
    },
    ...overrides
  };
}

function body(overrides = {}) {
  return JSON.stringify({
    seller: { id: 'ana', label: 'Ana' },
    customer: { name: 'Cliente', whatsapp: '5581999999999' },
    items: [
      {
        driveFileId: 'drive-file-2657',
        productKey: '50x50',
        quantity: 6,
        unitPrice: 0.01,
        lineSubtotal: 0.06,
        details: { diameterCm: 50 }
      }
    ],
    totals: { subtotal: 0.06, total: 0.06 },
    ...overrides
  });
}

async function prepare(overrides = {}) {
  return prepareOrderSubmissionV2({
    request: request(),
    rawBody: body(),
    allowedOrigins,
    catalogItems,
    productSnapshot,
    catalogVersion: 49,
    configVersion: 3,
    now,
    mode: 'passive-simulation',
    ...overrides
  });
}

test('integra validação, preço e reserva sem persistir pedido', async () => {
  const plan = await prepare();

  assert.equal(plan.ok, true);
  assert.equal(plan.action, 'READY_TO_PERSIST');
  assert.equal(plan.status, 202);
  assert.equal(plan.quote.pricing.total, 58.5);
  assert.equal(plan.quote.items[0].unitPrice, 9.75);
  assert.ok(plan.quote.warnings.includes('CLIENT_ORDER_TOTALS_IGNORED'));
  assert.equal(plan.reservation.status, 'processing');
  assert.equal(plan.orderInput.customer.whatsapp, '5581999999999');
  assert.equal(Object.hasOwn(plan, 'order'), false);
});

test('finalização gera pedido canônico e conclui idempotência', async () => {
  const plan = await prepare();
  const result = finalizeOrderSubmissionV2(plan, {
    orderNumber: 'PED2600001A',
    createdAt: '2026-07-26T18:00:10.000Z',
    updatedAt: '2026-07-26T18:00:10.000Z'
  });

  assert.equal(result.action, 'PERSISTENCE_RESULT_READY');
  assert.equal(result.status, 201);
  assert.equal(result.order.schemaVersion, 2);
  assert.equal(result.order.orderNumber, 'PED2600001A');
  assert.equal(result.order.pricing.total, 58.5);
  assert.equal(result.order.items[0].itemId, 'drive-file-2657:50x50:default:50x50');
  assert.equal(result.idempotencyRecord.status, 'completed');
  assert.deepEqual(result.response, {
    ok: true,
    orderNumber: 'PED2600001A',
    replayed: false
  });
});

test('repetição concluída retorna o mesmo pedido sem nova cotação ou persistência', async () => {
  const plan = await prepare();
  const completed = finalizeOrderSubmissionV2(plan, {
    orderNumber: 'PED2600001A',
    createdAt: '2026-07-26T18:00:10.000Z'
  });

  const replay = await prepare({
    existingIdempotencyRecord: completed.idempotencyRecord,
    now: new Date('2026-07-26T18:01:00.000Z')
  });

  assert.equal(replay.ok, true);
  assert.equal(replay.action, 'REPLAY_COMPLETED');
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, {
    ok: true,
    orderNumber: 'PED2600001A',
    replayed: true
  });
  assert.equal(replay.quote, null);
  assert.equal(replay.reservation, null);
});

test('mesma chave com quantidade diferente é conflito', async () => {
  const plan = await prepare();
  const completed = finalizeOrderSubmissionV2(plan, {
    orderNumber: 'PED2600001A',
    createdAt: '2026-07-26T18:00:10.000Z'
  });

  const conflictBody = body({
    items: [
      {
        driveFileId: 'drive-file-2657',
        productKey: '50x50',
        quantity: 8
      }
    ]
  });

  const conflict = await prepare({
    rawBody: conflictBody,
    existingIdempotencyRecord: completed.idempotencyRecord
  });

  assert.equal(conflict.ok, false);
  assert.equal(conflict.action, 'REJECT_CONFLICT');
  assert.equal(conflict.status, 409);
  assert.ok(conflict.errors.includes('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST'));
});

test('origem inválida bloqueia antes do cálculo comercial', async () => {
  const invalidRequest = request({
    headers: {
      ...request().headers,
      origin: 'https://malicioso.example',
      'sec-fetch-site': 'cross-site'
    }
  });

  const result = await prepare({ request: invalidRequest });

  assert.equal(result.ok, false);
  assert.equal(result.action, 'REQUEST_REJECTED');
  assert.equal(result.status, 403);
  assert.equal(Object.hasOwn(result, 'quote'), false);
});

test('JSON inválido bloqueia sem reservar idempotência', async () => {
  const result = await prepare({ rawBody: '{invalido' });

  assert.equal(result.ok, false);
  assert.equal(result.action, 'REQUEST_JSON_INVALID');
  assert.equal(result.status, 400);
  assert.equal(Object.hasOwn(result, 'reservation'), false);
});

test('arte inexistente bloqueia antes da reserva', async () => {
  const result = await prepare({
    rawBody: body({
      items: [{ driveFileId: 'arquivo-inexistente', quantity: 6 }]
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.action, 'ORDER_PRICING_REJECTED');
  assert.equal(result.status, 422);
  assert.ok(result.errors.includes('ARTWORK_NOT_FOUND'));
});

test('modo ativo permanece bloqueado enquanto produto não está ativado', async () => {
  const result = await prepare({ mode: 'active' });

  assert.equal(result.ok, false);
  assert.equal(result.action, 'ORDER_PRICING_REJECTED');
  assert.ok(result.errors.includes('PRODUCT_CHECKOUT_DISABLED'));
});

test('não finaliza plano rejeitado', async () => {
  const rejected = await prepare({ rawBody: '{invalido' });

  assert.throws(
    () => finalizeOrderSubmissionV2(rejected, { orderNumber: 'PED2600001A' }),
    error => error && error.code === 'SUBMISSION_PLAN_NOT_READY'
  );
});
