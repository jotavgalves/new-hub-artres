import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleOutboxInspection,
  handleRecentAdminOrders
} from '../../staging/site-v2-worker/src/ledger-inspection-routes.js';

function order(number, total = 58.5) {
  return {
    schemaVersion: 2,
    orderNumber: number,
    orderCode: number,
    displayId: number,
    status: 'Novo',
    seller: { id: 'ci', label: 'CI' },
    customer: { name: 'Cliente Privado', whatsapp: '5581999999999' },
    items: [{ driveFileId: 'staging-artwork-2657', quantity: 6 }],
    qty: 6,
    pricing: { total },
    integrity: { catalogVersion: 9001 },
    source: 'catalog-v2-staging-synthetic',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z'
  };
}

function environment(stub) {
  const requestedShards = [];
  return {
    env: {
      ENVIRONMENT: 'staging',
      ORDER_LEDGER: {
        getByName(name) {
          requestedShards.push(name);
          return stub;
        }
      }
    },
    requestedShards
  };
}

async function payload(response) {
  return response.json();
}

test('painel lê pedidos recentes diretamente e redige cliente', async () => {
  const recent = [
    order('PED2600102A', 78),
    order('PED2600101A', 58.5)
  ];
  const calls = [];
  const { env, requestedShards } = environment({
    async listRecentOrders(limit) {
      calls.push(['listRecentOrders', limit]);
      return recent;
    },
    async health() {
      calls.push(['health']);
      return { orderCount: 102, pendingOutbox: 102 };
    }
  });

  const response = await handleRecentAdminOrders(
    new Request('https://staging.invalid/internal/v2/admin/orders?limit=2'),
    env,
    'request-admin'
  );
  const body = await payload(response);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['listRecentOrders', 2], ['health']]);
  assert.equal(requestedShards.length, 1);
  assert.equal(body.readOnly, true);
  assert.equal(body.orders[0].orderNumber, 'PED2600102A');
  assert.deepEqual(body.orders[0].customer, { redacted: true });
  assert.equal(body.summary.returned, 2);
  assert.equal(body.summary.orderCount, 102);
  assert.equal(body.summary.pendingOutbox, 102);
  assert.equal(JSON.stringify(body).includes('Cliente Privado'), false);
  assert.equal(JSON.stringify(body).includes('5581999999999'), false);
});

test('outbox consulta o agregado exato sem percorrer a fila antiga', async () => {
  const createdAt = '2026-07-29T12:00:00.000Z';
  const target = 'PED2600102A';
  const calls = [];
  const { env } = environment({
    async getOutboxEventByAggregateId(number) {
      calls.push(['getOutboxEventByAggregateId', number]);
      return {
        id: 102,
        eventType: 'order.created.v2',
        aggregateId: target,
        payload: { schemaVersion: 1, orderNumber: target, order: order(target) },
        status: 'pending',
        createdAt,
        deliveredAt: ''
      };
    },
    async listPendingOutbox() {
      throw new Error('SHOULD_NOT_LIST_PENDING_OUTBOX');
    }
  });

  const response = await handleOutboxInspection(
    new Request(`https://staging.invalid/internal/v2/ledger/outbox?createdAt=${encodeURIComponent(createdAt)}&number=${target}`),
    env,
    'request-outbox'
  );
  const body = await payload(response);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['getOutboxEventByAggregateId', target]]);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].aggregateId, target);
  assert.equal(body.events[0].eventType, 'order.created.v2');
  assert.deepEqual(body.events[0].payload.order.customer, { redacted: true });
  assert.equal(JSON.stringify(body).includes('Cliente Privado'), false);
});

test('evento já entregue continua auditável pela consulta direta', async () => {
  const target = 'PED2600103A';
  const { env } = environment({
    async getOutboxEventByAggregateId() {
      return {
        id: 103,
        eventType: 'order.created.v2',
        aggregateId: target,
        payload: { schemaVersion: 1, orderNumber: target, order: order(target) },
        status: 'delivered',
        createdAt: '2026-07-29T12:01:00.000Z',
        deliveredAt: '2026-07-29T12:01:01.000Z'
      };
    }
  });

  const response = await handleOutboxInspection(
    new Request(`https://staging.invalid/internal/v2/ledger/outbox?createdAt=2026-07-29T12%3A01%3A00.000Z&aggregateId=${target}`),
    env,
    'request-delivered'
  );
  const body = await payload(response);

  assert.equal(body.events[0].status, 'delivered');
  assert.equal(body.events[0].deliveredAt, '2026-07-29T12:01:01.000Z');
});

test('consulta sem número preserva a fila pendente FIFO', async () => {
  const calls = [];
  const { env } = environment({
    async listPendingOutbox(limit) {
      calls.push(limit);
      return [];
    }
  });

  const response = await handleOutboxInspection(
    new Request('https://staging.invalid/internal/v2/ledger/outbox?createdAt=2026-07-29T12%3A00%3A00.000Z&limit=75'),
    env,
    'request-fifo'
  );
  const body = await payload(response);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [75]);
  assert.deepEqual(body.events, []);
});

test('rotas permanecem somente leitura e exigem data na outbox', async () => {
  const { env } = environment({});

  const adminPost = await handleRecentAdminOrders(
    new Request('https://staging.invalid/internal/v2/admin/orders', { method: 'POST' }),
    env,
    'request-admin-post'
  );
  const outboxPost = await handleOutboxInspection(
    new Request('https://staging.invalid/internal/v2/ledger/outbox', { method: 'POST' }),
    env,
    'request-outbox-post'
  );
  const missingDate = await handleOutboxInspection(
    new Request('https://staging.invalid/internal/v2/ledger/outbox?number=PED2600102A'),
    env,
    'request-missing-date'
  );

  assert.equal(adminPost.status, 405);
  assert.equal(outboxPost.status, 405);
  assert.equal(missingDate.status, 400);
  assert.equal((await payload(missingDate)).error, 'CREATED_AT_REQUIRED');
});
