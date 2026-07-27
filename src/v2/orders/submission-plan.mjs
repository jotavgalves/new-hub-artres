import {
  createIdempotencyRecord,
  createOrderIntentFingerprint,
  decideIdempotency,
  renewIdempotencyRecord,
  completeIdempotencyRecord
} from './idempotency.mjs';
import {
  createOrderFromPricingQuoteV2,
  priceOrderIntentV2
} from './pricing.mjs';
import {
  validateBodyByteLength,
  validatePublicOrderRequest
} from '../http/request-guard.mjs';

export async function prepareOrderSubmissionV2(input = {}) {
  const requestValidation = validatePublicOrderRequest(input.request, {
    allowedOrigins: input.allowedOrigins,
    maxJsonBytes: input.maxJsonBytes,
    requireOrigin: input.requireOrigin
  });

  if (!requestValidation.ok) {
    return rejection('REQUEST_REJECTED', requestValidation.status, requestValidation.errors, {
      requestValidation
    });
  }

  const bodyValidation = validateBodyByteLength(input.rawBody, input.maxJsonBytes);
  if (!bodyValidation.ok) {
    return rejection('REQUEST_BODY_REJECTED', 413, [bodyValidation.error], {
      requestValidation,
      bodyValidation
    });
  }

  let body;
  try {
    body = JSON.parse(String(input.rawBody || ''));
  } catch (_) {
    return rejection('REQUEST_JSON_INVALID', 400, ['INVALID_JSON'], {
      requestValidation,
      bodyValidation
    });
  }

  let quote;
  try {
    quote = priceOrderIntentV2({
      items: body.items,
      catalogItems: input.catalogItems,
      productSnapshot: input.productSnapshot,
      catalogVersion: input.catalogVersion,
      configVersion: input.configVersion,
      serverDiscountPercent: input.serverDiscountPercent,
      clientTotals: body.totals || body.pricing,
      allowPassiveSimulation: input.mode !== 'active'
    });
  } catch (error) {
    return rejection('ORDER_PRICING_REJECTED', 422, [error?.code || 'ORDER_PRICING_FAILED', ...(error?.details || [])], {
      requestValidation,
      bodyValidation
    });
  }

  const intent = {
    schemaVersion: 2,
    seller: body.seller || {},
    customer: body.customer || {},
    items: quote.items,
    integrity: {
      catalogVersion: quote.integrity.catalogVersion,
      configVersion: quote.integrity.configVersion
    }
  };

  const fingerprint = await createOrderIntentFingerprint(intent);
  const idempotencyDecision = decideIdempotency(input.existingIdempotencyRecord, {
    fingerprint,
    now: input.now
  });

  if (idempotencyDecision.action === 'REPLAY_COMPLETED') {
    return deepFreeze({
      ok: true,
      action: 'REPLAY_COMPLETED',
      status: idempotencyDecision.status,
      replayed: true,
      response: idempotencyDecision.response,
      requestValidation,
      bodyValidation,
      fingerprint,
      quote: null,
      reservation: null
    });
  }

  if (!idempotencyDecision.shouldReserve) {
    return rejection(idempotencyDecision.action, idempotencyDecision.status, [idempotencyDecision.error], {
      requestValidation,
      bodyValidation,
      fingerprint,
      retryAfterSeconds: idempotencyDecision.retryAfterSeconds || 0
    });
  }

  const key = requestValidation.request.idempotencyKey;
  const reservation = input.existingIdempotencyRecord
    ? renewIdempotencyRecord(input.existingIdempotencyRecord, {
        now: input.now,
        ttlMs: input.idempotencyTtlMs,
        requestId: requestValidation.request.requestId
      })
    : await createIdempotencyRecord({
        key,
        fingerprint,
        now: input.now,
        ttlMs: input.idempotencyTtlMs,
        requestId: requestValidation.request.requestId
      });

  return deepFreeze({
    ok: true,
    action: 'READY_TO_PERSIST',
    status: 202,
    replayed: false,
    requestValidation,
    bodyValidation,
    fingerprint,
    quote,
    reservation,
    orderInput: {
      seller: sanitizeSeller(body.seller),
      customer: sanitizeCustomer(body.customer),
      requestItemCount: Array.isArray(body.items) ? body.items.length : 0
    }
  });
}

export function finalizeOrderSubmissionV2(plan, input = {}) {
  if (!plan || plan.action !== 'READY_TO_PERSIST' || !plan.quote || !plan.reservation) {
    throw submissionError('SUBMISSION_PLAN_NOT_READY');
  }

  const order = createOrderFromPricingQuoteV2({
    quote: plan.quote,
    orderNumber: input.orderNumber,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    status: input.status || 'Novo',
    seller: plan.orderInput.seller,
    customer: plan.orderInput.customer,
    requestItemCount: plan.orderInput.requestItemCount,
    productRegistryVersion: input.productRegistryVersion || 1,
    source: input.source || 'catalog-v2'
  });

  const response = deepFreeze({
    ok: true,
    orderNumber: order.orderNumber,
    replayed: false
  });

  const idempotencyRecord = completeIdempotencyRecord(plan.reservation, {
    orderNumber: order.orderNumber,
    response,
    now: input.updatedAt || input.createdAt
  });

  return deepFreeze({
    ok: true,
    action: 'PERSISTENCE_RESULT_READY',
    status: 201,
    order,
    response,
    idempotencyRecord
  });
}

function rejection(action, status, errors, extra = {}) {
  return deepFreeze({
    ok: false,
    action,
    status,
    replayed: false,
    errors: unique(errors),
    ...extra
  });
}

function sanitizeSeller(value = {}) {
  return deepFreeze({
    id: identity(value?.id || value?.sellerId || value?.username),
    label: clean(value?.label || value?.name)
  });
}

function sanitizeCustomer(value = {}) {
  return deepFreeze({
    name: clean(value?.name || value?.nome).slice(0, 160),
    whatsapp: digits(value?.whatsapp || value?.phone).slice(0, 20),
    phone: digits(value?.phone || value?.whatsapp).slice(0, 20)
  });
}

function identity(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function submissionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
