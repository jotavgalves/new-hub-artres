import { validateProjectionEvent } from './order-projection-port.mjs';
import { SupabaseRpcClient } from './supabase-rpc-client.mjs';

export class SupabaseOrderProjection {
  #client;
  #schema;

  constructor(options = {}) {
    this.#client = new SupabaseRpcClient(options);
    this.#schema = this.#client.schema;
  }

  async projectOrderCreated(input) {
    const event = requireEvent(input, 'order.created.v2');
    const order = event.payload?.order;
    if (!order || order.orderNumber !== event.aggregateId) {
      throw projectionError('ORDER_CREATED_PAYLOAD_INVALID');
    }

    return this.#rpc('project_order_created_v2', {
      p_event_key: eventKey(event),
      p_event_id: event.id,
      p_event_type: event.eventType,
      p_order_number: event.aggregateId,
      p_order: order,
      p_event_created_at: event.createdAt || order.createdAt
    });
  }

  async projectOrderStatusChanged(input) {
    const event = requireEvent(input, 'order.status-changed.v2');
    const status = clean(event.payload?.status);
    const updatedAt = validIsoDate(event.payload?.updatedAt);
    if (!status || !updatedAt) throw projectionError('ORDER_STATUS_PAYLOAD_INVALID');

    return this.#rpc('project_order_status_changed_v2', {
      p_event_key: eventKey(event),
      p_event_id: event.id,
      p_event_type: event.eventType,
      p_order_number: event.aggregateId,
      p_status: status,
      p_updated_at: updatedAt,
      p_event: event.payload
    });
  }

  async health(options = {}) {
    if (options.probe !== true) {
      return {
        ok: true,
        adapter: 'supabase-order-projection',
        configured: true,
        probed: false,
        schema: this.#schema
      };
    }

    const result = await this.#rpc('order_projection_health_v2', {}, false);
    return {
      ok: result?.ok !== false,
      adapter: 'supabase-order-projection',
      configured: true,
      probed: true,
      schema: this.#schema,
      result
    };
  }

  async #rpc(functionName, body, normalize = true) {
    let payload;
    try {
      payload = await this.#client.call(functionName, body);
    } catch (error) {
      if (error?.code === 'SUPABASE_RPC_RESPONSE_TOO_LARGE') {
        throw projectionError('SUPABASE_PROJECTION_RESPONSE_TOO_LARGE');
      }

      if (error?.code === 'SUPABASE_RPC_REQUEST_FAILED' || error?.code === 'SUPABASE_RPC_TIMEOUT') {
        const mapped = projectionError('SUPABASE_PROJECTION_REQUEST_FAILED');
        mapped.status = Number(error.status || 0);
        mapped.remoteCode = clean(error.remoteCode).slice(0, 80);
        mapped.remoteMessage = clean(error.remoteMessage).slice(0, 240);
        throw mapped;
      }

      throw error;
    }

    const result = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
    return normalize ? normalizeProjectionResult(result) : result;
  }
}

export function createProjectionEventKey(input = {}) {
  const validation = validateProjectionEvent(input);
  if (!validation.ok) {
    const error = projectionError('PROJECTION_EVENT_INVALID');
    error.details = validation.errors;
    throw error;
  }
  return eventKey(validation.event);
}

function eventKey(event) {
  return `${event.eventType}:${event.aggregateId}:${event.id}`;
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

function normalizeProjectionResult(value) {
  if (value === null || value === undefined || value === '') {
    return { action: 'PROJECTED', projected: true };
  }

  if (typeof value === 'boolean') {
    return value
      ? { action: 'PROJECTED', projected: true }
      : { action: 'REPLAY', projected: false };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw projectionError('SUPABASE_PROJECTION_RESPONSE_INVALID');
  }

  const action = clean(value.action || value.result || 'PROJECTED').toUpperCase();
  if (!['PROJECTED', 'REPLAY'].includes(action)) {
    throw projectionError('SUPABASE_PROJECTION_ACTION_INVALID');
  }

  return {
    action,
    projected: action === 'PROJECTED',
    orderNumber: clean(value.order_number || value.orderNumber).toUpperCase()
  };
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

function projectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
