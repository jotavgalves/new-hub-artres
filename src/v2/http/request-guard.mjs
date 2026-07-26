import { normalizeIdempotencyKey } from '../orders/idempotency.mjs';

export const DEFAULT_MAX_JSON_BYTES = 128 * 1024;

export function validatePublicOrderRequest(requestLike = {}, options = {}) {
  const headers = normalizeHeaders(requestLike.headers);
  const method = clean(requestLike.method || 'GET').toUpperCase();
  const maxJsonBytes = clamp(options.maxJsonBytes, 1024, 1024 * 1024, DEFAULT_MAX_JSON_BYTES);
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins || []);
  const errors = [];

  if (method !== 'POST') errors.push('METHOD_NOT_ALLOWED');

  const contentType = clean(headers.get('content-type')).toLowerCase();
  if (!contentType.startsWith('application/json')) errors.push('CONTENT_TYPE_NOT_JSON');

  const contentLength = parseContentLength(headers.get('content-length'));
  if (contentLength !== null && contentLength > maxJsonBytes) errors.push('REQUEST_BODY_TOO_LARGE');

  const fetchSite = clean(headers.get('sec-fetch-site')).toLowerCase();
  if (fetchSite === 'cross-site') errors.push('CROSS_SITE_REQUEST_REJECTED');

  const origin = normalizeOrigin(headers.get('origin'));
  const requireOrigin = options.requireOrigin !== false;

  if (!origin && requireOrigin) errors.push('ORIGIN_REQUIRED');
  if (origin && !allowedOrigins.includes(origin)) errors.push('ORIGIN_NOT_ALLOWED');
  if (!allowedOrigins.length) errors.push('ALLOWED_ORIGINS_NOT_CONFIGURED');

  const rawIdempotencyKey = headers.get('idempotency-key');
  let idempotencyKey = '';
  try {
    idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
  } catch (error) {
    errors.push(error?.code || 'IDEMPOTENCY_KEY_INVALID');
  }

  const status = statusForErrors(errors);

  return deepFreeze({
    ok: errors.length === 0,
    status,
    errors: unique(errors),
    request: {
      method,
      origin,
      fetchSite,
      contentType,
      contentLength,
      maxJsonBytes,
      idempotencyKey,
      requestId: safeRequestId(headers)
    }
  });
}

export async function constantTimeEqualSecrets(received, configured) {
  const left = clean(received);
  const right = clean(configured);
  if (!left || !right) return false;

  const [leftHash, rightHash] = await Promise.all([
    sha256Bytes(left),
    sha256Bytes(right)
  ]);

  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash[index] ^ rightHash[index];
  }
  return difference === 0;
}

export async function createRateLimitKeys(input = {}) {
  const salt = clean(input.salt);
  if (salt.length < 16) throw guardError('RATE_LIMIT_SALT_TOO_SHORT');

  const entries = {
    ip: clean(input.ip),
    idempotency: clean(input.idempotencyKey),
    phone: digits(input.phone),
    fingerprint: clean(input.fingerprint)
  };

  const output = {};
  for (const [kind, value] of Object.entries(entries)) {
    if (!value) continue;
    output[kind] = `rate:v2:${kind}:${await hmacHex(salt, value)}`;
  }

  return deepFreeze(output);
}

export function buildSafeRequestLog(input = {}) {
  const validation = input.validation || {};
  const rateKeys = input.rateKeys || {};

  return deepFreeze({
    requestId: clean(input.requestId || validation.request?.requestId).slice(0, 100),
    environment: clean(input.environment || 'unknown').slice(0, 40),
    route: clean(input.route || '/api/orders/v2').slice(0, 120),
    method: clean(validation.request?.method),
    originAllowed: validation.ok === true || !validation.errors?.includes('ORIGIN_NOT_ALLOWED'),
    validationOk: validation.ok === true,
    validationErrors: unique(validation.errors || []).slice(0, 20),
    idempotencyKeyHash: hashSuffix(rateKeys.idempotency),
    ipHash: hashSuffix(rateKeys.ip),
    phoneHash: hashSuffix(rateKeys.phone),
    fingerprintHash: hashSuffix(rateKeys.fingerprint),
    status: Number(input.status || validation.status || 0) || 0,
    latencyMs: Math.max(0, Number(input.latencyMs || 0) || 0)
  });
}

export function validateBodyByteLength(rawBody, maxBytes = DEFAULT_MAX_JSON_BYTES) {
  const limit = clamp(maxBytes, 1024, 1024 * 1024, DEFAULT_MAX_JSON_BYTES);
  const bytes = new TextEncoder().encode(String(rawBody ?? '')).byteLength;

  return deepFreeze({
    ok: bytes <= limit,
    bytes,
    maxBytes: limit,
    error: bytes <= limit ? '' : 'REQUEST_BODY_TOO_LARGE'
  });
}

function statusForErrors(errors) {
  if (!errors.length) return 200;
  if (errors.includes('METHOD_NOT_ALLOWED')) return 405;
  if (errors.includes('REQUEST_BODY_TOO_LARGE')) return 413;
  if (errors.includes('CONTENT_TYPE_NOT_JSON')) return 415;
  if (errors.some(error => ['ORIGIN_REQUIRED', 'ORIGIN_NOT_ALLOWED', 'CROSS_SITE_REQUEST_REJECTED'].includes(error))) return 403;
  if (errors.includes('ALLOWED_ORIGINS_NOT_CONFIGURED')) return 500;
  return 400;
}

function normalizeAllowedOrigins(values) {
  return unique((Array.isArray(values) ? values : [values]).map(normalizeOrigin).filter(Boolean));
}

function normalizeOrigin(value) {
  const text = clean(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function normalizeHeaders(value) {
  if (value instanceof Headers) return value;
  const headers = new Headers();
  for (const [key, entry] of Object.entries(value || {})) {
    if (entry !== undefined && entry !== null) headers.set(key, String(entry));
  }
  return headers;
}

function parseContentLength(value) {
  const text = clean(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeRequestId(headers) {
  return clean(headers.get('x-request-id') || headers.get('cf-ray')).slice(0, 100);
}

async function sha256Bytes(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest);
}

async function hmacHex(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function hashSuffix(value) {
  const text = clean(value);
  if (!text) return '';
  return text.slice(-12);
}

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
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

function guardError(code) {
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
