import { orderLedgerShardName } from '../../../src/v2/orders/order-number.mjs';

const MAX_ADMIN_ORDERS = 100;

export async function handleRecentAdminOrders(request, env, requestId) {
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);

  const url = new URL(request.url);
  const limit = boundedPositiveInteger(url.searchParams.get('limit'), 50, MAX_ADMIN_ORDERS);
  const year = new Date().getUTCFullYear();
  const shardDate = `${year}-01-01T00:00:00.000Z`;
  const stub = ledgerStub(env, shardDate);
  const [orders, ledgerHealth] = await Promise.all([
    stub.listRecentOrders(limit),
    stub.health()
  ]);
  const inspectedOrders = orders.map(orderInspectionView);

  return json({
    ok: true,
    requestId,
    readOnly: true,
    environment: env.ENVIRONMENT || 'staging',
    catalog: 'synthetic-staging-only',
    catalogVersion: 9001,
    year,
    summary: adminSummary(inspectedOrders, ledgerHealth),
    orders: inspectedOrders
  });
}

export async function handleOutboxInspection(request, env, requestId) {
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);

  const url = new URL(request.url);
  const createdAt = String(url.searchParams.get('createdAt') || '').trim();
  if (!createdAt) return json({ ok: false, error: 'CREATED_AT_REQUIRED', requestId }, 400);

  const orderNumber = String(
    url.searchParams.get('number') || url.searchParams.get('aggregateId') || ''
  ).trim().toUpperCase();
  const stub = ledgerStub(env, createdAt);

  if (orderNumber) {
    const event = await stub.getOutboxEventByAggregateId(orderNumber);
    return json({
      ok: true,
      requestId,
      events: event ? [outboxInspectionView(event)] : []
    });
  }

  const limit = boundedPositiveInteger(url.searchParams.get('limit'), 50, 200);
  const events = await stub.listPendingOutbox(limit);
  return json({ ok: true, requestId, events: events.map(outboxInspectionView) });
}

function ledgerStub(env, createdAt) {
  if (!env?.ORDER_LEDGER || typeof env.ORDER_LEDGER.getByName !== 'function') {
    throw routeError('ORDER_LEDGER_NOT_CONFIGURED');
  }
  return env.ORDER_LEDGER.getByName(orderLedgerShardName(createdAt));
}

function orderInspectionView(order = {}) {
  return {
    schemaVersion: order.schemaVersion,
    orderNumber: order.orderNumber,
    orderCode: order.orderCode,
    displayId: order.displayId,
    status: order.status,
    seller: order.seller,
    customer: { redacted: true },
    items: Array.isArray(order.items) ? order.items : [],
    qty: order.qty,
    pricing: order.pricing,
    integrity: order.integrity,
    source: order.source,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  };
}

function outboxInspectionView(event = {}) {
  const payload = event.eventType === 'order.created.v2'
    ? {
        schemaVersion: event.payload?.schemaVersion,
        orderNumber: event.payload?.orderNumber,
        order: orderInspectionView(event.payload?.order)
      }
    : { redacted: true };

  return {
    id: event.id,
    eventType: event.eventType,
    aggregateId: event.aggregateId,
    payload,
    status: event.status,
    createdAt: event.createdAt,
    deliveredAt: event.deliveredAt
  };
}

function adminSummary(orders, ledgerHealth = {}) {
  return {
    orderCount: Number(ledgerHealth.orderCount || 0),
    returned: orders.length,
    totalValue: orders.reduce((sum, order) => sum + finiteNumber(order.pricing?.total), 0),
    itemQuantity: orders.reduce((sum, order) => sum + finiteNumber(order.qty), 0),
    pendingOutbox: Number(ledgerHealth.pendingOutbox || 0)
  };
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
    Allow: methods.join(', ')
  });
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    }
  });
}

function routeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
