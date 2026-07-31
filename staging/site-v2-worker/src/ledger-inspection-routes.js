import { orderLedgerShardName } from '../../../src/v2/orders/order-number.mjs';
import {
  adminSalesCacheStub
} from './admin-sales-cache-client.js';
import {
  adminOrderInspectionView,
  adminSalesEtag,
  adminSummary,
  boundedAdminLimit,
  buildAdminSalesSnapshot,
  sliceAdminSalesSnapshot
} from './admin-sales-cache-model.js';

export async function handleRecentAdminOrders(request, env, requestId) {
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);

  const url = new URL(request.url);
  const limit = boundedAdminLimit(url.searchParams.get('limit'));
  const cache = adminSalesCacheStub(env);
  const snapshot = cache
    ? await cache.getSnapshot(limit)
    : await directSnapshot(env, limit);
  const etag = adminSalesEtag(snapshot.revision, limit);
  const headers = adminSnapshotHeaders(snapshot, etag);

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  return json({
    ok: true,
    requestId,
    readOnly: true,
    environment: env.ENVIRONMENT || 'staging',
    catalog: 'synthetic-staging-only',
    catalogVersion: 9001,
    year: snapshot.year,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    generatedAt: snapshot.generatedAt,
    verifiedAt: snapshot.verifiedAt,
    cacheState: snapshot.cacheState,
    summary: snapshot.summary,
    orders: snapshot.orders
  }, 200, headers);
}

export async function handleAdminOrdersStream(request, env, requestId) {
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);
  const cache = adminSalesCacheStub(env);
  if (!cache) {
    return json({ ok: false, error: 'ADMIN_SALES_CACHE_NOT_CONFIGURED', requestId }, 503);
  }

  const response = await cache.fetch(new Request('https://admin-sales-cache.internal/events', {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      'X-Request-Id': requestId
    }
  }));
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
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

async function directSnapshot(env, limit) {
  const year = new Date().getUTCFullYear();
  const stub = ledgerStub(env, `${year}-01-01T00:00:00.000Z`);
  const [orders, ledgerHealth] = await Promise.all([
    stub.listRecentOrders(limit),
    stub.health()
  ]);
  const generatedAt = new Date().toISOString();
  const snapshot = buildAdminSalesSnapshot({
    orders,
    ledgerHealth,
    meta: {
      revision: Number(ledgerHealth.orderCount || 0),
      updatedAt: orders[0]?.updatedAt || orders[0]?.createdAt || generatedAt,
      orderNumber: orders[0]?.orderNumber || ''
    },
    generatedAt,
    verifiedAt: generatedAt,
    year
  });
  return sliceAdminSalesSnapshot(snapshot, limit, 'fallback');
}

function ledgerStub(env, createdAt) {
  if (!env?.ORDER_LEDGER || typeof env.ORDER_LEDGER.getByName !== 'function') {
    throw routeError('ORDER_LEDGER_NOT_CONFIGURED');
  }
  return env.ORDER_LEDGER.getByName(orderLedgerShardName(createdAt));
}

function outboxInspectionView(event = {}) {
  const payload = event.eventType === 'order.created.v2'
    ? {
        schemaVersion: event.payload?.schemaVersion,
        orderNumber: event.payload?.orderNumber,
        order: adminOrderInspectionView(event.payload?.order)
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

function adminSnapshotHeaders(snapshot, etag) {
  return {
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'ETag': etag,
    'Vary': 'X-Staging-Token',
    'X-Data-Revision': String(snapshot.revision || 0),
    'X-Data-Updated-At': String(snapshot.updatedAt || ''),
    'X-Data-Generated-At': String(snapshot.generatedAt || ''),
    'X-Data-Verified-At': String(snapshot.verifiedAt || '')
  };
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
    Allow: methods.join(', ')
  });
}

function json(payload, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, String(value));
  return new Response(JSON.stringify(payload), { status, headers });
}

function routeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export { adminSummary };
