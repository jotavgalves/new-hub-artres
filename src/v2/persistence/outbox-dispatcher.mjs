import { assertOrderLedgerPort } from './order-ledger-port.mjs';
import { assertOrderProjectionPort, validateProjectionEvent } from './order-projection-port.mjs';

export async function dispatchOrderOutbox(input = {}) {
  const ledger = assertOrderLedgerPort(input.ledger);
  const projection = assertOrderProjectionPort(input.projection);
  const batchSize = Math.min(Math.max(positiveInteger(input.batchSize) || 25, 1), 100);
  const now = validIsoDate(input.now) || new Date().toISOString();
  const pending = await ledger.listPendingOutbox(batchSize);
  const deliveredIds = [];
  const results = [];

  for (const rawEvent of pending) {
    const validation = validateProjectionEvent(rawEvent);
    if (!validation.ok) {
      results.push({
        id: positiveInteger(rawEvent?.id) || 0,
        ok: false,
        action: 'INVALID_EVENT',
        errors: validation.errors
      });
      continue;
    }

    const event = validation.event;
    try {
      const projectionResult = await projectEvent(projection, event);
      deliveredIds.push(event.id);
      results.push({
        id: event.id,
        ok: true,
        action: projectionResult?.action || 'PROJECTED',
        projected: projectionResult?.projected !== false
      });
    } catch (error) {
      results.push({
        id: event.id,
        ok: false,
        action: 'PROJECTION_FAILED',
        error: clean(error?.code || error?.message || 'PROJECTION_FAILED').slice(0, 120)
      });
      if (input.stopOnError === true) break;
    }
  }

  const delivery = deliveredIds.length
    ? await ledger.markOutboxDelivered(deliveredIds, now)
    : { updated: 0 };

  return deepFreeze({
    ok: results.every(result => result.ok),
    requestedBatchSize: batchSize,
    pendingCount: pending.length,
    attemptedCount: results.length,
    deliveredCount: Number(delivery.updated || 0),
    failedCount: results.filter(result => !result.ok).length,
    results
  });
}

async function projectEvent(projection, event) {
  if (event.eventType === 'order.created.v2') return projection.projectOrderCreated(event);
  if (event.eventType === 'order.status-changed.v2') return projection.projectOrderStatusChanged(event);

  const error = new Error('OUTBOX_EVENT_TYPE_UNSUPPORTED');
  error.code = 'OUTBOX_EVENT_TYPE_UNSUPPORTED';
  throw error;
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
