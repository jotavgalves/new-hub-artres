export const ORDER_LEDGER_PORT_VERSION = 1;

export function assertOrderLedgerPort(value) {
  const missing = [];
  for (const method of ['submit', 'getOrder', 'listPendingOutbox', 'markOutboxDelivered']) {
    if (typeof value?.[method] !== 'function') missing.push(method);
  }

  if (missing.length) {
    const error = ledgerPortError('ORDER_LEDGER_PORT_INVALID');
    error.missingMethods = missing;
    throw error;
  }

  return value;
}

export function validateLedgerSubmissionCommand(input = {}) {
  const errors = [];
  const idempotencyKey = clean(input.idempotencyKey).toLowerCase();
  const fingerprint = clean(input.fingerprint).toLowerCase();
  const submissionCreatedAt = validIsoDate(input.submissionCreatedAt);
  const preparedOrder = input.preparedOrder;

  if (!/^idempotency:v2:[a-f0-9]{64}$/.test(idempotencyKey)) errors.push('IDEMPOTENCY_STORAGE_KEY_INVALID');
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) errors.push('FINGERPRINT_INVALID');
  if (!submissionCreatedAt) errors.push('SUBMISSION_CREATED_AT_INVALID');
  if (!preparedOrder || typeof preparedOrder !== 'object' || Array.isArray(preparedOrder)) {
    errors.push('PREPARED_ORDER_REQUIRED');
  } else {
    if (preparedOrder.schemaVersion !== 2) errors.push('PREPARED_ORDER_SCHEMA_INVALID');
    if (!Array.isArray(preparedOrder.items) || !preparedOrder.items.length) errors.push('PREPARED_ORDER_ITEMS_REQUIRED');
    if (preparedOrder.orderNumber || preparedOrder.orderCode || preparedOrder.displayId) {
      errors.push('PREPARED_ORDER_NUMBER_MUST_BE_EMPTY');
    }
    if (!preparedOrder.pricing || preparedOrder.pricing.currency !== 'BRL') {
      errors.push('PREPARED_ORDER_PRICING_INVALID');
    }
  }

  return Object.freeze({
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    command: errors.length ? null : deepFreeze({
      idempotencyKey,
      fingerprint,
      submissionCreatedAt,
      preparedOrder: deepClone(preparedOrder),
      requestId: clean(input.requestId).slice(0, 160),
      actor: clean(input.actor || 'catalog-v2').slice(0, 120)
    })
  });
}

export function validateLedgerSubmissionResult(value = {}) {
  const errors = [];

  if (!['CREATED', 'REPLAY'].includes(value.action)) errors.push('LEDGER_ACTION_INVALID');
  if (!/^PED\d{2}\d{5}[A-Z]$/.test(clean(value.orderNumber))) errors.push('ORDER_NUMBER_INVALID');
  if (typeof value.replayed !== 'boolean') errors.push('REPLAY_FLAG_INVALID');
  if (!value.order || typeof value.order !== 'object') errors.push('ORDER_RESULT_REQUIRED');
  if (value.action === 'CREATED' && value.replayed !== false) errors.push('CREATED_REPLAY_FLAG_INVALID');
  if (value.action === 'REPLAY' && value.replayed !== true) errors.push('REPLAY_ACTION_FLAG_INVALID');

  return Object.freeze({ ok: errors.length === 0, errors: [...new Set(errors)] });
}

function ledgerPortError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
