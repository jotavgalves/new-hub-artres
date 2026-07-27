export const ORDER_PROJECTION_PORT_VERSION = 1;

export function assertOrderProjectionPort(value) {
  const missing = [];
  for (const method of ['projectOrderCreated', 'projectOrderStatusChanged', 'health']) {
    if (typeof value?.[method] !== 'function') missing.push(method);
  }

  if (missing.length) {
    const error = projectionError('ORDER_PROJECTION_PORT_INVALID');
    error.missingMethods = missing;
    throw error;
  }

  return value;
}

export function validateProjectionEvent(event = {}) {
  const errors = [];
  const id = positiveInteger(event.id);
  const eventType = clean(event.eventType);
  const aggregateId = clean(event.aggregateId).toUpperCase();
  const payload = event.payload;

  if (!id) errors.push('OUTBOX_EVENT_ID_INVALID');
  if (!['order.created.v2', 'order.status-changed.v2'].includes(eventType)) {
    errors.push('OUTBOX_EVENT_TYPE_UNSUPPORTED');
  }
  if (!/^PED\d{2}\d{5}[A-Z]$/.test(aggregateId)) errors.push('OUTBOX_AGGREGATE_ID_INVALID');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) errors.push('OUTBOX_PAYLOAD_INVALID');

  return Object.freeze({
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    event: errors.length ? null : deepFreeze({
      id,
      eventType,
      aggregateId,
      payload: JSON.parse(JSON.stringify(payload)),
      createdAt: validIsoDate(event.createdAt),
      status: clean(event.status || 'pending')
    })
  });
}

function projectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
