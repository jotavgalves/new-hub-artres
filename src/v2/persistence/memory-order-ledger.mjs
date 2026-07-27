import { formatOrderNumberV2, orderYearCode } from '../orders/order-number.mjs';
import {
  validateLedgerSubmissionCommand,
  validateLedgerSubmissionResult
} from './order-ledger-port.mjs';

export class MemoryOrderLedger {
  #yearCode;
  #counter;
  #orders;
  #idempotency;
  #outbox;
  #outboxSequence;

  constructor(options = {}) {
    this.#yearCode = clean(options.yearCode);
    this.#counter = positiveInteger(options.initialSequence) || 1;
    this.#orders = new Map();
    this.#idempotency = new Map();
    this.#outbox = new Map();
    this.#outboxSequence = 1;
  }

  async submit(input = {}) {
    const validation = validateLedgerSubmissionCommand(input);
    if (!validation.ok) {
      const error = ledgerError('LEDGER_COMMAND_INVALID');
      error.details = validation.errors;
      throw error;
    }

    const command = validation.command;
    const commandYear = orderYearCode(command.submissionCreatedAt);
    if (this.#yearCode && commandYear !== this.#yearCode) {
      throw ledgerError('LEDGER_YEAR_MISMATCH', `${commandYear}:${this.#yearCode}`);
    }

    const existing = this.#idempotency.get(command.idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== command.fingerprint) {
        throw ledgerError('IDEMPOTENCY_KEY_CONFLICT', command.idempotencyKey);
      }

      const order = this.#orders.get(existing.orderNumber);
      if (!order) throw ledgerError('IDEMPOTENCY_ORDER_MISSING', existing.orderNumber);

      return freezeResult({
        action: 'REPLAY',
        replayed: true,
        orderNumber: existing.orderNumber,
        order
      });
    }

    const draft = cloneState({
      counter: this.#counter,
      orders: this.#orders,
      idempotency: this.#idempotency,
      outbox: this.#outbox,
      outboxSequence: this.#outboxSequence
    });

    const orderNumber = formatOrderNumberV2(command.submissionCreatedAt, draft.counter);
    draft.counter += 1;

    const now = command.submissionCreatedAt;
    const order = deepFreeze({
      ...command.preparedOrder,
      orderNumber,
      orderCode: orderNumber,
      displayId: orderNumber,
      createdAt: command.preparedOrder.createdAt || now,
      updatedAt: command.preparedOrder.updatedAt || now,
      status: command.preparedOrder.status || 'Novo',
      source: command.preparedOrder.source || 'catalog-v2'
    });

    if (draft.orders.has(orderNumber)) throw ledgerError('ORDER_NUMBER_COLLISION', orderNumber);

    draft.orders.set(orderNumber, order);
    draft.idempotency.set(command.idempotencyKey, deepFreeze({
      idempotencyKey: command.idempotencyKey,
      fingerprint: command.fingerprint,
      orderNumber,
      requestId: command.requestId,
      actor: command.actor,
      createdAt: now
    }));

    const outboxId = draft.outboxSequence;
    draft.outboxSequence += 1;
    draft.outbox.set(outboxId, deepFreeze({
      id: outboxId,
      eventType: 'order.created.v2',
      aggregateId: orderNumber,
      payload: {
        schemaVersion: 1,
        orderNumber,
        order
      },
      status: 'pending',
      createdAt: now,
      deliveredAt: ''
    }));

    if (typeof input.beforeCommit === 'function') input.beforeCommit({ order, outboxId });

    this.#counter = draft.counter;
    this.#orders = draft.orders;
    this.#idempotency = draft.idempotency;
    this.#outbox = draft.outbox;
    this.#outboxSequence = draft.outboxSequence;

    const result = freezeResult({
      action: 'CREATED',
      replayed: false,
      orderNumber,
      order
    });

    const resultValidation = validateLedgerSubmissionResult(result);
    if (!resultValidation.ok) {
      const error = ledgerError('LEDGER_RESULT_INVALID');
      error.details = resultValidation.errors;
      throw error;
    }

    return result;
  }

  async getOrder(orderNumber) {
    return this.#orders.get(clean(orderNumber).toUpperCase()) || null;
  }

  async listPendingOutbox(limit = 50) {
    const capped = Math.min(Math.max(positiveInteger(limit) || 50, 1), 200);
    return [...this.#outbox.values()]
      .filter(event => event.status === 'pending')
      .sort((a, b) => a.id - b.id)
      .slice(0, capped)
      .map(event => deepFreeze(JSON.parse(JSON.stringify(event))));
  }

  async markOutboxDelivered(ids = [], deliveredAt = new Date().toISOString()) {
    const normalizedIds = [...new Set((Array.isArray(ids) ? ids : []).map(positiveInteger).filter(Boolean))];
    let updated = 0;

    for (const id of normalizedIds) {
      const event = this.#outbox.get(id);
      if (!event || event.status === 'delivered') continue;
      this.#outbox.set(id, deepFreeze({
        ...event,
        status: 'delivered',
        deliveredAt: validIsoDate(deliveredAt) || new Date().toISOString()
      }));
      updated += 1;
    }

    return Object.freeze({ updated });
  }

  snapshot() {
    return deepFreeze({
      yearCode: this.#yearCode,
      nextSequence: this.#counter,
      orders: [...this.#orders.values()],
      idempotency: [...this.#idempotency.values()],
      outbox: [...this.#outbox.values()]
    });
  }
}

function cloneState(state) {
  return {
    counter: state.counter,
    orders: new Map(state.orders),
    idempotency: new Map(state.idempotency),
    outbox: new Map(state.outbox),
    outboxSequence: state.outboxSequence
  };
}

function freezeResult(value) {
  return deepFreeze(value);
}

function ledgerError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
