import {
  DEFAULT_MAX_JSON_BYTES,
  validatePublicOrderRequest
} from '../../../src/v2/http/request-guard.mjs';

const PUBLIC_CHECKOUT_ROUTE = '/api/orders/v2';
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export function publicCheckoutProtectionStatus(env = {}) {
  const allowedOrigins = parseAllowedOrigins(env.PUBLIC_CHECKOUT_ALLOWED_ORIGINS);
  const rateLimiterConfigured = typeof env.PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER?.limit === 'function';

  return Object.freeze({
    configured: allowedOrigins.length > 0 && rateLimiterConfigured,
    requiresOrigin: true,
    allowedOriginCount: allowedOrigins.length,
    rateLimiterConfigured,
    route: PUBLIC_CHECKOUT_ROUTE,
    keyStrategy: 'route-and-idempotency-sha256'
  });
}

export async function handlePublicCheckoutProtectionProbe(request, env, requestId, options = {}) {
  const protection = await protectPublicCheckoutRequest(request, env, requestId, options);
  if (!protection.ok) return protection.response;

  return publicCheckoutJson({
    ok: true,
    dryRun: true,
    writesPerformed: false,
    requestId,
    originAllowed: true,
    rateLimitApplied: protection.rateLimitApplied === true
  });
}

export async function protectPublicCheckoutRequest(request, env = {}, requestId = '', options = {}) {
  const allowedOrigins = options.allowedOrigins || parseAllowedOrigins(env.PUBLIC_CHECKOUT_ALLOWED_ORIGINS);
  const validation = validatePublicOrderRequest(request, {
    allowedOrigins,
    requireOrigin: true,
    maxJsonBytes: options.maxJsonBytes || DEFAULT_MAX_JSON_BYTES
  });

  if (!validation.ok) {
    const failure = publicValidationFailure(validation);
    return Object.freeze({
      ok: false,
      validation,
      response: publicCheckoutJson(
        { ok: false, error: failure.code, requestId },
        failure.status,
        failure.headers
      )
    });
  }

  const limiter = options.rateLimiter || env.PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') {
    return Object.freeze({
      ok: false,
      validation,
      response: publicCheckoutJson(
        { ok: false, error: 'PUBLIC_CHECKOUT_PROTECTION_NOT_CONFIGURED', requestId },
        503
      )
    });
  }

  const rateLimitKey = await createPublicCheckoutRateLimitKey({
    route: PUBLIC_CHECKOUT_ROUTE,
    idempotencyKey: validation.request.idempotencyKey
  });

  let limited;
  try {
    limited = await limiter.limit({ key: rateLimitKey });
  } catch (_) {
    return Object.freeze({
      ok: false,
      validation,
      response: publicCheckoutJson(
        { ok: false, error: 'PUBLIC_CHECKOUT_RATE_LIMIT_UNAVAILABLE', requestId },
        503
      )
    });
  }

  if (limited?.success !== true) {
    return Object.freeze({
      ok: false,
      validation,
      response: publicCheckoutJson(
        { ok: false, error: 'PUBLIC_CHECKOUT_RATE_LIMITED', requestId },
        429,
        { 'Retry-After': String(DEFAULT_RETRY_AFTER_SECONDS) }
      )
    });
  }

  return Object.freeze({
    ok: true,
    validation,
    rateLimitApplied: true
  });
}

export async function createPublicCheckoutRateLimitKey(input = {}) {
  const route = clean(input.route || PUBLIC_CHECKOUT_ROUTE);
  const idempotencyKey = clean(input.idempotencyKey);
  if (!route || !idempotencyKey) throw protectionError('PUBLIC_CHECKOUT_RATE_KEY_INVALID');

  const bytes = new TextEncoder().encode(`${route}\n${idempotencyKey}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

  return `checkout:v2:${hex}`;
}

export function publicCheckoutJson(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...extraHeaders
    }
  });
}

function publicValidationFailure(validation) {
  const errors = Array.isArray(validation?.errors) ? validation.errors : [];

  if (errors.includes('METHOD_NOT_ALLOWED')) {
    return { code: 'METHOD_NOT_ALLOWED', status: 405, headers: { Allow: 'POST' } };
  }
  if (errors.includes('REQUEST_BODY_TOO_LARGE')) {
    return { code: 'REQUEST_BODY_TOO_LARGE', status: 413 };
  }
  if (errors.includes('CONTENT_TYPE_NOT_JSON')) {
    return { code: 'CONTENT_TYPE_NOT_JSON', status: 415 };
  }
  if (errors.includes('ALLOWED_ORIGINS_NOT_CONFIGURED')) {
    return { code: 'PUBLIC_CHECKOUT_PROTECTION_NOT_CONFIGURED', status: 503 };
  }
  if (errors.some(error => [
    'ORIGIN_REQUIRED',
    'ORIGIN_NOT_ALLOWED',
    'CROSS_SITE_REQUEST_REJECTED'
  ].includes(error))) {
    return { code: 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED', status: 403 };
  }
  if (errors.some(error => String(error || '').startsWith('IDEMPOTENCY_KEY_'))) {
    return { code: 'IDEMPOTENCY_KEY_INVALID', status: 422 };
  }

  return { code: 'PUBLIC_CHECKOUT_REQUEST_INVALID', status: 400 };
}

function parseAllowedOrigins(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const origins = [];

  for (const entry of entries) {
    const text = clean(entry);
    if (!text) continue;
    try {
      const url = new URL(text);
      if (!['https:', 'http:'].includes(url.protocol)) continue;
      if (!origins.includes(url.origin)) origins.push(url.origin);
    } catch (_) {
      // Origem inválida é descartada e a ausência de configuração falha fechada.
    }
  }

  return origins;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function protectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
