import { constantTimeEqualSecrets } from '../../../src/v2/http/request-guard.mjs';
import { createAtomicLedgerCommandV2 } from '../../../src/v2/orders/atomic-command.mjs';
import { orderLedgerShardName } from '../../../src/v2/orders/order-number.mjs';
import { OrderLedger } from './order-ledger-do.js';
import {
  STAGING_CATALOG_ITEMS,
  STAGING_CATALOG_VERSION,
  STAGING_CONFIG_VERSION,
  STAGING_PRODUCT_SNAPSHOT
} from './staging-catalog-fixture.js';

export { OrderLedger };

const MAX_JSON_BYTES = 128 * 1024;

export default {
  async fetch(request, env) {
    const startedAt = Date.now();
    const url = new URL(request.url);
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({
          ok: true,
          service: 'new-hub-artres-v2-staging',
          environment: env.ENVIRONMENT || 'staging',
          writesEnabled: env.STAGING_WRITE_ENABLED === 'true',
          lowLevelLedgerEnabled: env.STAGING_LOW_LEVEL_LEDGER_ENABLED === 'true',
          persistence: 'durable-object-sqlite',
          catalog: 'synthetic-staging-only',
          catalogVersion: STAGING_CATALOG_VERSION,
          requestId
        });
      }

      if (!url.pathname.startsWith('/internal/v2/')) {
        return json({ ok: false, error: 'ROUTE_NOT_FOUND', requestId }, 404);
      }

      const authorized = await constantTimeEqualSecrets(
        request.headers.get('x-staging-token'),
        env.STAGING_API_TOKEN
      );
      if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);

      if (url.pathname === '/internal/v2/orders/submit') {
        if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId);
        if (env.STAGING_WRITE_ENABLED !== 'true') {
          return json({ ok: false, error: 'STAGING_WRITES_DISABLED', requestId }, 503);
        }

        const body = await readJsonBody(request);
        const command = await createAtomicLedgerCommandV2({
          idempotencyKey: request.headers.get('idempotency-key'),
          submissionCreatedAt: body.submissionCreatedAt,
          body,
          catalogItems: STAGING_CATALOG_ITEMS,
          productSnapshot: STAGING_PRODUCT_SNAPSHOT,
          catalogVersion: STAGING_CATALOG_VERSION,
          configVersion: STAGING_CONFIG_VERSION,
          serverDiscountPercent: 0,
          productRegistryVersion: 1,
          mode: 'active',
          source: 'catalog-v2-staging-synthetic',
          requestId,
          actor: 'staging-synthetic'
        });

        const result = await ledgerStub(env, command.submissionCreatedAt).submit(command);
        return json(
          submissionResponseView(result, requestId, command.quoteWarnings),
          result.replayed ? 200 : 201
        );
      }

      if (url.pathname === '/internal/v2/ledger/submit') {
        if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId);
        if (env.STAGING_WRITE_ENABLED !== 'true') {
          return json({ ok: false, error: 'STAGING_WRITES_DISABLED', requestId }, 503);
        }
        if (env.STAGING_LOW_LEVEL_LEDGER_ENABLED !== 'true') {
          return json({ ok: false, error: 'LOW_LEVEL_LEDGER_DISABLED', requestId }, 503);
        }

        const command = await readJsonBody(request);
        const stub = ledgerStub(env, command.submissionCreatedAt);
        const result = await stub.submit({ ...command, requestId });
        return json(submissionResponseView(result, requestId), result.replayed ? 200 : 201);
      }

      if (url.pathname === '/internal/v2/ledger/order') {
        if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);
        const orderNumber = String(url.searchParams.get('number') || '').trim().toUpperCase();
        const createdAt = String(url.searchParams.get('createdAt') || '').trim();
        if (!orderNumber || !createdAt) {
          return json({ ok: false, error: 'ORDER_NUMBER_AND_CREATED_AT_REQUIRED', requestId }, 400);
        }

        const order = await ledgerStub(env, createdAt).getOrder(orderNumber);
        if (!order) return json({ ok: false, error: 'ORDER_NOT_FOUND', requestId }, 404);
        return json({ ok: true, requestId, order: orderInspectionView(order) });
      }

      if (url.pathname === '/internal/v2/ledger/outbox') {
        if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);
        const createdAt = String(url.searchParams.get('createdAt') || '').trim();
        if (!createdAt) return json({ ok: false, error: 'CREATED_AT_REQUIRED', requestId }, 400);
        const events = await ledgerStub(env, createdAt).listPendingOutbox(50);
        return json({ ok: true, requestId, events: events.map(outboxInspectionView) });
      }

      return json({ ok: false, error: 'ROUTE_NOT_FOUND', requestId }, 404);
    } catch (error) {
      const code = publicErrorCode(error);
      const status = statusForError(code);
      console.error(JSON.stringify({
        level: 'error',
        service: 'new-hub-artres-v2-staging',
        requestId,
        route: url.pathname,
        code,
        status,
        latencyMs: Date.now() - startedAt
      }));
      return json({ ok: false, error: code, requestId }, status);
    }
  }
};

async function readJsonBody(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw workerError('CONTENT_TYPE_NOT_JSON');

  const declaredLength = Number.parseInt(request.headers.get('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw workerError('REQUEST_BODY_TOO_LARGE');
  }

  const rawBody = await readLimitedTextBody(request, MAX_JSON_BYTES);
  try {
    const body = JSON.parse(rawBody);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_BODY');
    return body;
  } catch (_) {
    throw workerError('INVALID_JSON');
  }
}

async function readLimitedTextBody(request, maxBytes) {
  if (!request.body) return '';

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('REQUEST_BODY_TOO_LARGE').catch(() => {});
        throw workerError('REQUEST_BODY_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function ledgerStub(env, createdAt) {
  const shardName = orderLedgerShardName(createdAt);
  return env.ORDER_LEDGER.getByName(shardName);
}

function submissionResponseView(result, requestId, warnings = []) {
  return {
    ok: true,
    requestId,
    action: result.action,
    replayed: result.replayed,
    orderNumber: result.orderNumber,
    pricing: result.order.pricing,
    itemCount: result.order.items.length,
    warnings: Array.isArray(warnings) ? warnings : []
  };
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

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
    Allow: methods.join(', ')
  });
}

function statusForError(code) {
  if (code === 'IDEMPOTENCY_KEY_CONFLICT') return 409;
  if (code === 'CONTENT_TYPE_NOT_JSON') return 415;
  if (code === 'REQUEST_BODY_TOO_LARGE') return 413;
  if (code === 'INVALID_JSON') return 400;
  if (code.includes('INVALID') || code.includes('REQUIRED') || code.includes('MISMATCH')) return 422;
  if (code === 'ORDER_NOT_FOUND' || code === 'ARTWORK_NOT_FOUND') return 404;
  if (code.includes('DISABLED')) return 503;
  return 500;
}

function safeRequestId(headers) {
  return String(headers.get('x-request-id') || headers.get('cf-ray') || '')
    .trim()
    .replace(/[^A-Za-z0-9._:-]/g, '')
    .slice(0, 100);
}

function publicErrorCode(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_:-]{0,99}$/.test(code) ? code : 'STAGING_INTERNAL_ERROR';
}

function workerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
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
