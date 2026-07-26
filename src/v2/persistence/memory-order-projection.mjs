import { validateProjectionEvent } from './order-projection-port.mjs';

export class MemoryOrderProjection {
  #orders = new Map();
  #events = new Set();
  #failEventIds = new Set();

  constructor(options = {}) {
    for (const id of options.failEventIds || []) {
      const normalized = positiveInteger(id);
      if (normalized) this.#failEventIds.add(normalized);
    }
  }

  async projectOrderCreated(input) {
    const event = requireEvent(input, 'order.created.v2');
    this.#maybeFail(event.id);
    if (this.#events.has(event.id)) return { action: 'REPLAY', projected: false };

    const order = event.payload?.order;
    if (!order || order.orderNumber !== event.aggregateId) {
      throw projectionError('ORDER_CREATED_PAYLOAD_INVALID');
    }

    this.#orders.set(event.aggregateId, deepFreeze(JSON.parse(JSON.stringify(order))));
    this.#events.add(event.id);
    return { action: 'PROJECTED', projected: true };
  }

  async projectOrderStatusChanged(input) {
    const event = requireEvent(input, 'order.status-changed.v2');
    this.#maybeFail(event.id);
    if (this.#events.has(event.id)) return { action: 'REPLAY', projected: false };

    const existing = this.#orders.get(event.aggregateId);
    if (!existing) throw projectionError('PROJECTED_ORDER_NOT_FOUND');

    const status = clean(event.payload?.status);
    const updatedAt = validIsoDate(event.payload?.updatedAt);
    if (!status || !updatedAt) throw projectionError('ORDER_STATUS_PAYLOAD_INVALID');

    this.#orders.set(event.aggregateId, deepFreeze({ ...existing, status, updatedAt }));
    this.#events.add(event.id);
    return { action: 'PROJECTED', projected: true };
  }

  async health() {
    return {
      ok: true,
      adapter: 'memory-order-projection',
      projectedOrders: this.#orders.size,
      projectedEvents: this.#events.size
    };
  }

  snapshot() {
    return deepFreeze({
      orders: [...this.#orders.values()],
      eventIds: [...this.#events.values()].sort((a, b) => a - b)
    });
  }

  #maybeFail(eventId) {
    if (this.#failEventIds.has(eventId)) throw projectionError('PROJECTION_FAILURE_SIMULATED');
  }
}

function requireEvent(input, expectedType) {
  const validation = validateProjectionEvent(input);
  if (!validation.ok) {
    const error = projectionError('PROJECTION_EVENT_INVALID');
    error.details = validation.errors;
    throw error;
  }
  if (validation.event.eventType !== expectedType) {
    throw projectionError('PROJECTION_EVENT_TYPE_MISMATCH');
  }
  return validation.event;
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
