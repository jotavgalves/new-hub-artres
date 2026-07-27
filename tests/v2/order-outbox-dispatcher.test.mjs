import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryOrderLedger } from '../../src/v2/persistence/memory-order-ledger.mjs';
import { MemoryOrderProjection } from '../../src/v2/persistence/memory-order-projection.mjs';
import { dispatchOrderOutbox } from '../../src/v2/persistence/outbox-dispatcher.mjs';
import { assertOrderProjectionPort } from '../../src/v2/persistence/order-projection-port.mjs';

function command(overrides = {}) {
  return {
    idempotencyKey: `idempotency:v2:${'1'.repeat(64)}`,
    fingerprint: 'a'.repeat(64),
    submissionCreatedAt: '2026-07-26T20:00:00.000Z',
    requestId: 'req-1',
    actor: 'catalog-v2',
    preparedOrder: {
      schemaVersion: 2,
      status: 'Novo',
      seller: { id: 'ana', label: 'Ana' },
      customer: { name: 'Cliente Teste', whatsapp: '5581999999999' },
      items: [{
        itemId: 'drive-file-2657:50x50:default:50x50',
        driveFileId: 'drive-file-2657',
        code: '2657',
        productKey: '50x50',
        productName: 'Bolinhas 50x50',
        variantKey: 'default',
        sizeKey: '50x50',
        quantity: 6,
        unitPrice: 9.75,
        lineSubtotal: 58.5,
        details: {}
      }],
      qty: 6,
      pricing: {
        currency: 'BRL',
        subtotal: 58.5,
        discountPercent: 0,
        discountAmount: 0,
        total: 58.5,
        calculationVersion: 1
      },
      integrity: {
        catalogVersion: 49,
        configVersion: 3,
        productRegistryVersion: 1,
        requestItemCount: 1,
        canonicalItemCount: 1
      },
      source: 'catalog-v2'
    },
    ...overrides
  };
}

test('port de projeção exige operações explícitas', () => {
  const projection = new MemoryOrderProjection();
  assert.equal(assertOrderProjectionPort(projection), projection);
  assert.throws(
    () => assertOrderProjectionPort({ projectOrderCreated() {} }),
    error => error && error.code === 'ORDER_PROJECTION_PORT_INVALID'
  );
});

test('pedido criado é projetado e evento é marcado como entregue', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  const projection = new MemoryOrderProjection();
  await ledger.submit(command());

  const result = await dispatchOrderOutbox({
    ledger,
    projection,
    now: '2026-07-26T20:01:00.000Z'
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveredCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(projection.snapshot().orders[0].orderNumber, 'PED2600001A');
  assert.deepEqual(await ledger.listPendingOutbox(), []);
});

test('falha na projeção mantém evento pendente e pedido autoritativo intacto', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  const projection = new MemoryOrderProjection({ failEventIds: [1] });
  const created = await ledger.submit(command());

  const result = await dispatchOrderOutbox({ ledger, projection });

  assert.equal(result.ok, false);
  assert.equal(result.deliveredCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal((await ledger.listPendingOutbox()).length, 1);
  assert.equal((await ledger.getOrder(created.orderNumber)).orderNumber, created.orderNumber);
  assert.deepEqual(projection.snapshot().orders, []);
});

test('reexecução depois de falha projeta o mesmo pedido sem duplicar', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  await ledger.submit(command());

  const failedProjection = new MemoryOrderProjection({ failEventIds: [1] });
  await dispatchOrderOutbox({ ledger, projection: failedProjection });

  const healthyProjection = new MemoryOrderProjection();
  const success = await dispatchOrderOutbox({ ledger, projection: healthyProjection });
  const repeat = await dispatchOrderOutbox({ ledger, projection: healthyProjection });

  assert.equal(success.deliveredCount, 1);
  assert.equal(healthyProjection.snapshot().orders.length, 1);
  assert.equal(repeat.pendingCount, 0);
  assert.equal(repeat.deliveredCount, 0);
});

test('dispatcher pode continuar após uma falha e entregar os demais eventos', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  await ledger.submit(command());
  await ledger.submit(command({
    idempotencyKey: `idempotency:v2:${'2'.repeat(64)}`,
    fingerprint: 'b'.repeat(64),
    requestId: 'req-2',
    preparedOrder: {
      ...command().preparedOrder,
      customer: { name: 'Cliente Dois', whatsapp: '5581888888888' },
      items: [{
        ...command().preparedOrder.items[0],
        itemId: 'drive-file-2656:50x50:default:50x50',
        driveFileId: 'drive-file-2656',
        code: '2656'
      }]
    }
  }));

  const projection = new MemoryOrderProjection({ failEventIds: [1] });
  const result = await dispatchOrderOutbox({ ledger, projection, stopOnError: false });

  assert.equal(result.attemptedCount, 2);
  assert.equal(result.failedCount, 1);
  assert.equal(result.deliveredCount, 1);
  assert.equal((await ledger.listPendingOutbox()).length, 1);
  assert.equal(projection.snapshot().orders.length, 1);
});
