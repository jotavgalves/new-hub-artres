import { adaptOrderForV2 } from './legacy-adapter.mjs';

export const IDEMPOTENCY_SCHEMA_VERSION = 1;
export const IDEMPOTENCY_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export async function createOrderIntentFingerprint(order) {
  const adapted = adaptOrderForV2(order || {});
  const intent = {
    sellerId: clean(adapted.seller.id),
    customerWhatsapp: digits(adapted.customer.whatsapp || adapted.customer.phone),
    items: adapted.items
      .map(item => ({
        itemId: clean(item.itemId),
        productKey: clean(item.productKey),
        variantKey: clean(item.variantKey),
        sizeKey: clean(item.sizeKey),
        quantity: positiveInteger(item.quantity) || 1
      }))
      .sort(compareIntentItems),
    catalogVersion: positiveInteger(order?.integrity?.catalogVersion || order?.catalogVersion),
    configVersion: positiveInteger(order?.integrity?.configVersion || order?.configVersion)
  };

  return sha256Hex(stableSerialize(intent));
}

export function normalizeIdempotencyKey(value) {
  const key = clean(value);
  if (key.length < 16 || key.length > 128) throw idempotencyError('IDEMPOTENCY_KEY_LENGTH_INVALID');
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) throw idempotencyError('IDEMPOTENCY_KEY_FORMAT_INVALID');
  return key;
}

export async function idempotencyStorageKey(value) {
  const key = normalizeIdempotencyKey(value);
  return `idempotency:v2:${await sha256Hex(key)}`;
}

export async function createIdempotencyRecord(input = {}) {
  const key = normalizeIdempotencyKey(input.key);
  const fingerprint = requireFingerprint(input.fingerprint);
  const now = validDate(input.now) || new Date();
  const ttlMs = clampTtl(input.ttlMs);

  return deepFreeze({
    schemaVersion: IDEMPOTENCY_SCHEMA_VERSION,
    storageKey: await idempotencyStorageKey(key),
    keyHashPrefix: (await sha256Hex(key)).slice(0, 12),
    fingerprint,
    status: 'processing',
    requestId: clean(input.requestId),
    orderNumber: '',
    response: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    attempt: 1
  });
}

export function decideIdempotency(existing, incoming = {}) {
  const fingerprint = requireFingerprint(incoming.fingerprint);
  const now = validDate(incoming.now) || new Date();

  if (!existing) {
    return decision('ACCEPT_NEW', 201, true, false);
  }

  if (existing.schemaVersion !== IDEMPOTENCY_SCHEMA_VERSION) {
    return decision('REJECT_INVALID_RECORD', 500, false, false);
  }

  if (clean(existing.fingerprint) !== fingerprint) {
    return decision('REJECT_CONFLICT', 409, false, false, 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST');
  }

  const expired = isExpired(existing, now);

  if (existing.status === 'completed') {
    return deepFreeze({
      ...decision('REPLAY_COMPLETED', 200, false, true),
      orderNumber: clean(existing.orderNumber),
      response: sanitizeReplayResponse(existing.response)
    });
  }

  if (existing.status === 'processing' && !expired) {
    return deepFreeze({
      ...decision('IN_PROGRESS', 409, false, false, 'IDEMPOTENT_REQUEST_IN_PROGRESS'),
      retryAfterSeconds: retryAfter(existing, now)
    });
  }

  if (existing.status === 'processing' && expired) {
    return decision('RETRY_EXPIRED', 202, true, false);
  }

  if (existing.status === 'failed-retryable') {
    return decision('RETRY_FAILED', 202, true, false);
  }

  return decision('REJECT_INVALID_STATE', 500, false, false, 'IDEMPOTENCY_STATE_INVALID');
}

export function renewIdempotencyRecord(existing, input = {}) {
  assertRecord(existing);
  const now = validDate(input.now) || new Date();
  const ttlMs = clampTtl(input.ttlMs);

  return deepFreeze({
    ...existing,
    status: 'processing',
    requestId: clean(input.requestId || existing.requestId),
    response: null,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    attempt: positiveInteger(existing.attempt) + 1
  });
}

export function completeIdempotencyRecord(existing, input = {}) {
  assertRecord(existing);
  const orderNumber = clean(input.orderNumber);
  if (!orderNumber) throw idempotencyError('ORDER_NUMBER_REQUIRED');
  const now = validDate(input.now) || new Date();

  return deepFreeze({
    ...existing,
    status: 'completed',
    orderNumber,
    response: sanitizeReplayResponse(input.response || {
      ok: true,
      orderNumber,
      replayed: false
    }),
    updatedAt: now.toISOString()
  });
}

export function failIdempotencyRecord(existing, input = {}) {
  assertRecord(existing);
  const now = validDate(input.now) || new Date();

  return deepFreeze({
    ...existing,
    status: 'failed-retryable',
    response: null,
    updatedAt: now.toISOString(),
    failureCode: clean(input.failureCode || 'ORDER_CREATION_FAILED').slice(0, 100)
  });
}

export function validateIdempotencyRecord(record) {
  const errors = [];

  if (!record || record.schemaVersion !== IDEMPOTENCY_SCHEMA_VERSION) errors.push('IDEMPOTENCY_SCHEMA_VERSION_INVALID');
  if (!clean(record?.storageKey).startsWith('idempotency:v2:')) errors.push('IDEMPOTENCY_STORAGE_KEY_INVALID');
  if (!/^[0-9a-f]{64}$/.test(clean(record?.fingerprint))) errors.push('IDEMPOTENCY_FINGERPRINT_INVALID');
  if (!['processing', 'completed', 'failed-retryable'].includes(record?.status)) errors.push('IDEMPOTENCY_STATUS_INVALID');
  if (!validDate(record?.createdAt)) errors.push('IDEMPOTENCY_CREATED_AT_INVALID');
  if (!validDate(record?.updatedAt)) errors.push('IDEMPOTENCY_UPDATED_AT_INVALID');
  if (!validDate(record?.expiresAt)) errors.push('IDEMPOTENCY_EXPIRES_AT_INVALID');
  if (!positiveInteger(record?.attempt)) errors.push('IDEMPOTENCY_ATTEMPT_INVALID');
  if (record?.status === 'completed' && !clean(record?.orderNumber)) errors.push('IDEMPOTENCY_ORDER_NUMBER_REQUIRED');

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

function decision(action, status, shouldReserve, replayed, error = '') {
  return deepFreeze({
    action,
    status,
    shouldReserve,
    replayed,
    error
  });
}

function compareIntentItems(left, right) {
  return [left.itemId, left.productKey, left.variantKey, left.sizeKey]
    .join('|')
    .localeCompare([right.itemId, right.productKey, right.variantKey, right.sizeKey].join('|'));
}

function isExpired(record, now) {
  const expiresAt = validDate(record?.expiresAt);
  return !expiresAt || expiresAt.getTime() <= now.getTime();
}

function retryAfter(record, now) {
  const expiresAt = validDate(record?.expiresAt);
  if (!expiresAt) return 1;
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}

function sanitizeReplayResponse(value = {}) {
  return deepFreeze({
    ok: value?.ok !== false,
    orderNumber: clean(value?.orderNumber),
    replayed: true
  });
}

function assertRecord(record) {
  const validation = validateIdempotencyRecord(record);
  if (!validation.ok) {
    const error = idempotencyError('IDEMPOTENCY_RECORD_INVALID');
    error.details = validation.errors;
    throw error;
  }
}

function requireFingerprint(value) {
  const fingerprint = clean(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw idempotencyError('IDEMPOTENCY_FINGERPRINT_INVALID');
  return fingerprint;
}

function clampTtl(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return IDEMPOTENCY_DEFAULT_TTL_MS;
  return Math.min(Math.max(parsed, 60 * 1000), 7 * 24 * 60 * 60 * 1000);
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function validDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function idempotencyError(code) {
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
