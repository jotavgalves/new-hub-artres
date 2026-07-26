import test from 'node:test';
import assert from 'node:assert/strict';

import { createAtomicLedgerCommandV2 } from '../../src/v2/orders/atomic-command.mjs';
import { MemoryOrderLedger } from '../../src/v2/persistence/memory-order-ledger.mjs';
import {
  STAGING_CATALOG_ITEMS,
  STAGING_CATALOG_VERSION,
  STAGING_CONFIG_VERSION,
  STAGING_PRODUCT_SNAPSHOT
} from '../../staging/site-v2-worker/src/staging-catalog-fixture.js';

function body(overrides = {}) {
  return {
    submissionCreatedAt: '2026-07-26T21:00:00.000Z',
    seller: { id: 'ana', label: 'Ana' },
    customer: { name: 'Cliente Sintético', whatsapp: '5581999999999' },
    items: [{
      driveFileId: 'staging-artwork-2657',
      productKey: '50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6,
      unitPrice: 0.01,
      lineSubtotal: 0.06
    }],
    totals: { subtotal: 0.06, total: 0.06 },
    ...overrides
  };
}

async function command(input = {}) {
  const requestBody = input.body || body();
  return createAtomicLedgerCommandV2({
    idempotencyKey: input.idempotencyKey || 'idem_atomic_0123456789',
    submissionCreatedAt: requestBody.submissionCreatedAt,
    body: requestBody,
    catalogItems: STAGING_CATALOG_ITEMS,
    productSnapshot: STAGING_PRODUCT_SNAPSHOT,
    catalogVersion: STAGING_CATALOG_VERSION,
    configVersion: STAGING_CONFIG_VERSION,
    serverDiscountPercent: 0,
    productRegistryVersion: 1,
    mode: 'active',
    source: 'catalog-v2-staging-synthetic',
    requestId: input.requestId || 'req-atomic-1',
    actor: 'staging-synthetic'
  });
}

test('comando atômico ignora preço e total enviados pelo navegador', async () => {
  const value = await command();
  const item = value.preparedOrder.items[0];

  assert.equal(item.unitPrice, 9.75);
  assert.equal(item.lineSubtotal, 58.5);
  assert.equal(value.preparedOrder.pricing.subtotal, 58.5);
  assert.equal(value.preparedOrder.pricing.total, 58.5);
  assert.ok(value.quoteWarnings.includes('CLIENT_ITEM_PRICE_IGNORED:staging-artwork-2657'));
  assert.ok(value.quoteWarnings.includes('CLIENT_ORDER_TOTALS_IGNORED'));
  assert.match(value.fingerprint, /^[a-f0-9]{64}$/);
});

test('comando mais ledger criam pedido, idempotência e outbox', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  const prepared = await command();
  const created = await ledger.submit(prepared);

  assert.equal(created.action, 'CREATED');
  assert.equal(created.orderNumber, 'PED2600001A');
  assert.equal(created.order.items[0].driveFileId, 'staging-artwork-2657');
  assert.equal(created.order.pricing.total, 58.5);
  assert.equal((await ledger.listPendingOutbox()).length, 1);
});

test('reenvio idêntico retorna replay sem novo pedido', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  const firstCommand = await command();
  const secondCommand = await command({ requestId: 'req-atomic-2' });

  const first = await ledger.submit(firstCommand);
  const replay = await ledger.submit(secondCommand);

  assert.equal(replay.action, 'REPLAY');
  assert.equal(replay.replayed, true);
  assert.equal(replay.orderNumber, first.orderNumber);
  assert.equal(ledger.snapshot().orders.length, 1);
});

test('mesma chave com cliente diferente produz conflito de fingerprint', async () => {
  const ledger = new MemoryOrderLedger({ yearCode: '26' });
  const first = await command();
  const second = await command({
    body: body({ customer: { name: 'Outro Cliente', whatsapp: '5581888888888' } })
  });

  assert.notEqual(first.fingerprint, second.fingerprint);
  await ledger.submit(first);
  await assert.rejects(
    () => ledger.submit(second),
    error => error && error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );
});

test('arte sintética inexistente é rejeitada antes do ledger', async () => {
  await assert.rejects(
    () => command({
      body: body({
        items: [{
          driveFileId: 'arte-inexistente',
          productKey: '50x50',
          quantity: 6
        }]
      })
    }),
    error => error && error.code === 'ARTWORK_NOT_FOUND'
  );
});

test('produto incompatível com a arte é rejeitado', async () => {
  await assert.rejects(
    () => command({
      body: body({
        items: [{
          driveFileId: 'staging-artwork-2657',
          productKey: 'sacolinha',
          quantity: 6
        }]
      })
    }),
    error => error && error.code === 'ARTWORK_PRODUCT_MISMATCH'
  );
});

test('quantidade fora do incremento é rejeitada antes da persistência', async () => {
  await assert.rejects(
    () => command({
      body: body({
        items: [{
          driveFileId: 'staging-artwork-2657',
          productKey: '50x50',
          quantity: 7
        }]
      })
    }),
    error => error && error.code === 'ORDER_QUANTITY_RULES_INVALID'
  );
});

test('duas artes repartem o mínimo total sem colisão de código ou identidade', async () => {
  const value = await command({
    body: body({
      items: [
        {
          driveFileId: 'staging-artwork-2657',
          productKey: '50x50',
          quantity: 2
        },
        {
          driveFileId: 'staging-artwork-2656',
          productKey: '50x50',
          quantity: 4
        }
      ]
    })
  });

  assert.equal(value.preparedOrder.items.length, 2);
  assert.equal(value.preparedOrder.qty, 6);
  assert.notEqual(value.preparedOrder.items[0].itemId, value.preparedOrder.items[1].itemId);
  assert.equal(value.preparedOrder.pricing.total, 58.5);
});
