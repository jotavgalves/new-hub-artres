import { orderLedgerShardName } from '../../../src/v2/orders/order-number.mjs';
import { resolveAcceptedCatalogCheckoutItems } from './accepted-catalog-checkout-resolver.js';
import { validateAcceptedCheckoutItems } from './accepted-checkout-item-validator.js';
import { priceAcceptedCheckoutDraft } from './accepted-checkout-pricing.js';
import { prepareAcceptedCheckoutCanonicalDraft } from './accepted-checkout-canonical-draft.js';

const MAX_JSON_BYTES = 128 * 1024;

export async function handleAcceptedCheckoutSubmit(request, env, requestId, options = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId);

  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return json({ ok: false, error: 'CONTENT_TYPE_NOT_JSON', requestId }, 415);
  }

  if (env.STAGING_WRITE_ENABLED !== 'true') {
    return json({ ok: false, error: 'STAGING_WRITES_DISABLED', requestId }, 503);
  }

  try {
    const rawIdempotencyKey = String(request.headers.get('idempotency-key') || '').trim();
    if (rawIdempotencyKey.length < 16 || rawIdempotencyKey.length > 128) {
      throw routeError('IDEMPOTENCY_KEY_INVALID');
    }

    const body = await readJsonBody(request, MAX_JSON_BYTES);
    const submissionCreatedAt = validSubmissionDate(body.submissionCreatedAt);
    if (!submissionCreatedAt) throw routeError('SUBMISSION_CREATED_AT_INVALID');

    const requestItems = Array.isArray(body.items) ? body.items : [];
    const driveFileIds = requestItems.map(item => item?.driveFileId || item?.id || '');
    const resolveItems = options.resolveItems || resolveAcceptedCatalogCheckoutItems;
    const validateItems = options.validateItems || validateAcceptedCheckoutItems;
    const priceDraft = options.priceDraft || priceAcceptedCheckoutDraft;
    const prepareDraft = options.prepareDraft || prepareAcceptedCheckoutCanonicalDraft;

    const resolved = await resolveItems(driveFileIds, env, options);
    const validated = validateItems(requestItems, resolved.items);
    const priced = await priceDraft({ body, resolved, validated, env });
    const canonical = await prepareDraft({
      body,
      resolved,
      validated,
      priced,
      requestId,
      idempotencyKey: rawIdempotencyKey,
      submissionCreatedAt,
      source: 'catalog-v2-staging-accepted-synthetic',
      actor: 'staging-checkout-synthetic',
      dryRun: false
    });

    const ledger = options.ledger || ledgerStub(env, canonical.command.submissionCreatedAt);
    const result = await ledger.submit(canonical.command);
    notifyCommitted(options.onOrderCommitted, {
      command: canonical.command,
      result,
      requestId
    });

    return json({
      ok: true,
      requestId,
      action: result.action,
      replayed: result.replayed === true,
      orderNumber: result.orderNumber,
      schemaVersion: result.order?.schemaVersion,
      itemCount: Array.isArray(result.order?.items) ? result.order.items.length : 0,
      quantity: result.order?.qty,
      pricing: result.order?.pricing,
      catalogVersion: result.order?.integrity?.catalogVersion,
      configVersion: result.order?.integrity?.configVersion,
      canonicalDetailsPreserved: Array.isArray(result.order?.items) &&
        result.order.items.every(item => item.details && typeof item.details === 'object'),
      customerPreserved: Boolean(result.order?.customer?.name && result.order?.customer?.whatsapp),
      sellerPreserved: Boolean(result.order?.seller?.id),
      warnings: Array.isArray(priced.warnings) ? priced.warnings : []
    }, result.replayed ? 200 : 201);
  } catch (error) {
    const code = publicErrorCode(error);
    return json({
      ok: false,
      error: code,
      requestId,
      ...(Number.isInteger(error?.itemIndex) ? { itemIndex: error.itemIndex } : {})
    }, statusForError(code));
  }
}

function ledgerStub(env, createdAt) {
  if (!env?.ORDER_LEDGER || typeof env.ORDER_LEDGER.getByName !== 'function') {
    throw routeError('ORDER_LEDGER_NOT_CONFIGURED');
  }
  return env.ORDER_LEDGER.getByName(orderLedgerShardName(createdAt));
}

function notifyCommitted(callback, payload) {
  if (typeof callback !== 'function') return;
  try {
    const returned = callback(payload);
    if (returned && typeof returned.then === 'function') {
      void Promise.resolve(returned).catch(() => {});
    }
  } catch (_) {
    // A projeção é best-effort e nunca altera a confirmação do ledger.
  }
}

async function readJsonBody(request, maxBytes) {
  const declaredLength = Number.parseInt(request.headers.get('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw routeError('REQUEST_BODY_TOO_LARGE');
  }
  const text = await readLimitedText(request, maxBytes);
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw routeError('INVALID_JSON');
    }
    return payload;
  } catch (error) {
    if (error?.code === 'INVALID_JSON') throw error;
    throw routeError('INVALID_JSON');
  }
}

async function readLimitedText(request, maxBytes) {
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
        throw routeError('REQUEST_BODY_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function validSubmissionDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return '';
  const now = Date.now();
  const age = now - date.getTime();
  if (age < -5 * 60 * 1000 || age > 7 * 24 * 60 * 60 * 1000) return '';
  return date.toISOString();
}

function publicErrorCode(error) {
  const code = String(error?.code || error?.message || 'CHECKOUT_SUBMIT_FAILED');
  return /^[A-Z0-9_]{3,100}$/.test(code) ? code : 'CHECKOUT_SUBMIT_FAILED';
}

function statusForError(code) {
  if (code === 'IDEMPOTENCY_KEY_CONFLICT') return 409;
  if (code === 'CONTENT_TYPE_NOT_JSON') return 415;
  if (code === 'REQUEST_BODY_TOO_LARGE') return 413;
  if (code === 'INVALID_JSON') return 400;
  if (code.includes('TIMEOUT')) return 504;
  if (code.includes('NOT_CONFIGURED') || code.includes('DISABLED')) return 503;
  if (code.includes('RPC_') || code.includes('RESPONSE_TOO_LARGE')) return 502;
  if (
    code.includes('INVALID') ||
    code.includes('REQUIRED') ||
    code.includes('MISMATCH') ||
    code.includes('NOT_FOUND') ||
    code.includes('NOT_ALLOWED') ||
    code.includes('DUPLICATED') ||
    code.includes('LIMIT_EXCEEDED')
  ) return 422;
  return 500;
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
