import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminSalesEtag,
  buildAdminSalesSnapshot,
  sliceAdminSalesSnapshot
} from '../../staging/site-v2-worker/src/admin-sales-cache-model.js';

const orders = [
  {
    schemaVersion: 2,
    orderNumber: 'PED2600002B',
    displayId: 'PED2600002B',
    status: 'Novo',
    seller: { id: 'ana', label: 'Ana' },
    customer: { name: 'Cliente 2', whatsapp: '5581999999999' },
    items: [{ driveFileId: 'art-2', quantity: 1 }],
    qty: 1,
    pricing: { total: 59.9 },
    source: 'catalog-v2',
    createdAt: '2026-07-31T12:00:00.000Z',
    updatedAt: '2026-07-31T12:00:00.000Z'
  },
  {
    schemaVersion: 2,
    orderNumber: 'PED2600001A',
    displayId: 'PED2600001A',
    status: 'Novo',
    seller: { id: 'bia', label: 'Bia' },
    customer: { name: 'Cliente 1', whatsapp: '5581888888888' },
    items: [{ driveFileId: 'art-1', quantity: 6 }],
    qty: 6,
    pricing: { total: 58.5 },
    source: 'catalog-v2',
    createdAt: '2026-07-31T11:00:00.000Z',
    updatedAt: '2026-07-31T11:00:00.000Z'
  }
];

test('snapshot administrativo é versionado e remove dados pessoais', () => {
  const snapshot = buildAdminSalesSnapshot({
    orders,
    ledgerHealth: { orderCount: 2, pendingOutbox: 2 },
    meta: { revision: 7, updatedAt: orders[0].updatedAt, orderNumber: orders[0].orderNumber },
    generatedAt: '2026-07-31T12:01:00.000Z',
    verifiedAt: '2026-07-31T12:01:00.000Z',
    year: 2026
  });

  assert.equal(snapshot.revision, 7);
  assert.equal(snapshot.orders.length, 2);
  assert.deepEqual(snapshot.orders[0].customer, { redacted: true });
  assert.equal(Object.hasOwn(snapshot.orders[0].customer, 'whatsapp'), false);
});

test('recorte recalcula totais sem perder contagem global', () => {
  const snapshot = buildAdminSalesSnapshot({
    orders,
    ledgerHealth: { orderCount: 20, pendingOutbox: 3 },
    meta: { revision: 20, updatedAt: orders[0].updatedAt },
    generatedAt: '2026-07-31T12:01:00.000Z',
    verifiedAt: '2026-07-31T12:01:00.000Z',
    year: 2026
  });
  const sliced = sliceAdminSalesSnapshot(snapshot, 1, 'hit');

  assert.equal(sliced.orders.length, 1);
  assert.equal(sliced.summary.orderCount, 20);
  assert.equal(sliced.summary.returned, 1);
  assert.equal(sliced.summary.totalValue, 59.9);
  assert.equal(sliced.summary.itemQuantity, 1);
  assert.equal(sliced.cacheState, 'hit');
});

test('ETag muda por revisão e limite', () => {
  assert.equal(adminSalesEtag(12, 50), '"admin-sales-v1-12-50"');
  assert.notEqual(adminSalesEtag(12, 50), adminSalesEtag(13, 50));
  assert.notEqual(adminSalesEtag(12, 50), adminSalesEtag(12, 100));
});
