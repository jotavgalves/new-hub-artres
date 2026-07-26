import test from 'node:test';
import assert from 'node:assert/strict';

import { MemoryOrderLedger } from '../../src/v2/persistence/memory-order-ledger.mjs';
import {
  assertOrderLedgerPort,
  validateLedgerSubmissionCommand,
  validateLedgerSubmissionResult
} from '../../src/v2/persistence/order-ledger-port.mjs';
import {
  formatOrderNumberV2,
  orderLedgerShardName,
  parseOrderNumberV2
} from '../../src/v2/orders/order-number.mjs';

function preparedOrder(overrides = {}) {
  return {
    schemaVersion: 2,
    status: 'Novo',
    seller: { id: 'ana', label: 'Ana' },
    customer: { name: 'Cliente Teste', whatsapp: '5581999999999' },
    items: [
      {
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
      }
    ],
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
    source: 'catalog-v2',
    ...overrides
  };
}

function command(overrides = {}) {
  return {
    idempotencyKey: 'idem_0123456789abcdef',
    fingerprint: 'a'.repeat(64),
    submissionCreatedAt: '2026-07-26T20:00:00.000Z',
    requestId: 'req-1',
    actor: 'catalog-v2',
    preparedOrder: preparedOrder(),
    ...overrides
  };
}

test('numeração mantém o formato histórico e bloco alfabético', () => {
  assert.equal(formatOrderNumberV2('2026-07-26T20:00:00.000Z', 1), 'PED2600001A');
  assert.equal(formatOrderNumberV2('2026-07-26T20:00:00.000Z', 10_000), 'PED2600000A');
  assert.equal(formatOrderNumberV2('2026-07-26T20:00:00.000Z', 10_001), 'PED2600001B');
  assert.deepEqual(parseOrderNumberV2('PED2600001B'), { yearCode: '26', sequence: 10_001 });
  assert.equal(orderLedgerShardName('2026-07-26T20:00:00.000Z'), 'orders:26');
});

test('port exige todas as operações mínimas', () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  assert.equal(assertOrderLedgerPort(ledger), ledger);
  assert.throws(
    () => assertOrderLedgerPort({ submit() {} }),
    error => error && error.code === 'ORDER_LEDGER_PORT_INVALID' && error.missingMethods.includes('getOrder')
  );
});

test('comando válido não permite número antecipado pelo cliente', () => {
  const valid = validateLedgerSubmissionCommand(command());
  assert.equal(valid.ok, true);
  assert.equal(valid.command.preparedOrder.orderNumber, undefined);

  const invalid = validateLedgerSubmissionCommand(command({
    preparedOrder: preparedOrder({ orderNumber: 'PED2699999Z' })
  }));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes('PREPARED_ORDER_NUMBER_MUST_BE_EMPTY'));
});

test('submissão cria pedido, idempotência e outbox em uma única operação lógica', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  const result = await ledger.submit(command());
  const snapshot = ledger.snapshot();

  assert.equal(result.action, 'CREATED');
  assert.equal(result.orderNumber, 'PED2600001A');
  assert.equal(result.replayed, false);
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.idempotency.length, 1);
  assert.equal(snapshot.outbox.length, 1);
  assert.equal(snapshot.outbox[0].aggregateId, 'PED2600001A');
  assert.equal(validateLedgerSubmissionResult(result).ok, true);
});

test('replay devolve o mesmo pedido sem consumir nova sequência', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  const first = await ledger.submit(command());
  const replay = await ledger.submit(command({ requestId: 'req-2' }));
  const snapshot = ledger.snapshot();

  assert.equal(first.orderNumber, replay.orderNumber);
  assert.equal(replay.action, 'REPLAY');
  assert.equal(replay.replayed, true);
  assert.equal(snapshot.nextSequence, 2);
  assert.equal(snapshot.orders.length, 1);
  assert.equal(snapshot.outbox.length, 1);
});

test('mesma chave com fingerprint diferente é conflito', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  await ledger.submit(command());

  await assert.rejects(
    () => ledger.submit(command({ fingerprint: 'b'.repeat(64) })),
    error => error && error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );
});

test('falha antes do commit não deixa pedido, chave ou outbox parciais', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });

  await assert.rejects(
    () => ledger.submit(command({
      beforeCommit() {
        throw new Error('FALHA_SIMULADA');
      }
    })),
    /FALHA_SIMULADA/
  );

  const snapshot = ledger.snapshot();
  assert.equal(snapshot.nextSequence, 1);
  assert.deepEqual(snapshot.orders, []);
  assert.deepEqual(snapshot.idempotency, []);
  assert.deepEqual(snapshot.outbox, []);
});

test('ledger anual rejeita comando de outro ano', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });

  await assert.rejects(
    () => ledger.submit(command({ submissionCreatedAt: '2027-01-01T00:00:00.000Z' })),
    error => error && error.code === 'LEDGER_YEAR_MISMATCH'
  );
});

test('outbox é entregue explicitamente e de forma idempotente', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  await ledger.submit(command());

  const pending = await ledger.listPendingOutbox();
  assert.equal(pending.length, 1);

  assert.deepEqual(await ledger.markOutboxDelivered([pending[0].id], '2026-07-26T20:01:00.000Z'), { updated: 1 });
  assert.deepEqual(await ledger.markOutboxDelivered([pending[0].id], '2026-07-26T20:02:00.000Z'), { updated: 0 });
  assert.deepEqual(await ledger.listPendingOutbox(), []);
});
