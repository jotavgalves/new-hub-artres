import { constantTimeEqualSecrets, validateBodyByteLength } from '../../../src/v2/http/request-guard.mjs';
import { orderLedgerShardName } from '../../../src/v2/orders/order-number.mjs';
import { OrderLedger } from './order-ledger-do.js';

export { OrderLedger };

const MAX_JSON_BYTES = 128 * 1024;

export default {
  async fetch(request, env) {
    const startedAt = Date.now();
    const url = new URL(request.url);
    const requestId = request.headers.get('x-request-id') || request.headers.get('cf-ray') || crypto.randomUUID();

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({
          ok: true,
          service: 'new-hub-artres-v2-staging',
          environment: env.ENVIRONMENT || 'staging',
          writesEnabled: env.STAGING_WRITE_ENABLED === 'true',
          persistence: 'durable-object-sqlite',
          requestId
        });
      }

      if (!url.pathname.startsWith('/internal/v2/ledger/')) {
        return json({ ok: false, error: 'ROUTE_NOT_FOUND', requestId }, 404);
      }

      const authorized = await constantTimeEqualSecrets(
        request.headers.get('x-staging-token'),
        env.STAGING_API_TOKEN
      );
      if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);

      if (url.pathname === '/internal/v2/ledger/submit') {
        if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId);
        if (env.STAGING_WRITE_ENABLED !== 'true') {
          return json({ ok: false, error: 'STAGING_WRITES_DISABLED', requestId }, 503);
        }

        const contentType = String(request.headers.get('content-type') || '').toLowerCase();
        if (!contentType.startsWith('application/json')) {
          return json({ ok: false, error: 'CONTENT_TYPE_NOT_JSON', requestId }, 415);
        }

        const declaredLength = Number.parseInt(request.headers.get('content-length') || '', 10);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
          return json({ ok: false, error: 'REQUEST_BODY_TOO_LARGE', requestId }, 413);
        }

        const rawBody = await request.text();
        const bodyLength = validateBodyByteLength(rawBody, MAX_JSON_BYTES);
        if (!bodyLength.ok) return json({ ok: false, error: bodyLength.error, requestId }, 413);

        let command;
        try {
          command = JSON.parse(rawBody);
        } catch (_) {
          return json({ ok: false, error: 'INVALID_JSON', requestId }, 400);
        }

        const stub = ledgerStub(env, command.submissionCreatedAt);
        const result = await stub.submit({ ...command, requestId });
        return json({ ok: true, requestId, ...result }, result.replayed ? 200 : 201);
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
        return json({ ok: true, requestId, order });
      }

      if (url.pathname === '/internal/v2/ledger/outbox') {
        if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);
        const createdAt = String(url.searchParams.get('createdAt') || '').trim();
        if (!createdAt) return json({ ok: false, error: 'CREATED_AT_REQUIRED', requestId }, 400);
        const events = await ledgerStub(env, createdAt).listPendingOutbox(50);
        return json({ ok: true, requestId, events });
      }

      return json({ ok: false, error: 'ROUTE_NOT_FOUND', requestId }, 404);
    } catch (error) {
      const code = String(error?.code || error?.message || 'STAGING_INTERNAL_ERROR').slice(0, 120);
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

function ledgerStub(env, createdAt) {
  const shardName = orderLedgerShardName(createdAt);
  return env.ORDER_LEDGER.getByName(shardName);
}

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
    Allow: methods.join(', ')
  });
}

function statusForError(code) {
  if (code === 'IDEMPOTENCY_KEY_CONFLICT') return 409;
  if (code.includes('INVALID') || code.includes('REQUIRED') || code.includes('MISMATCH')) return 422;
  if (code === 'ORDER_NOT_FOUND') return 404;
  return 500;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    }
  });
}
