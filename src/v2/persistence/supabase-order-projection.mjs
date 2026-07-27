import { validateProjectionEvent } from './order-projection-port.mjs';

const MAX_REMOTE_RESPONSE_BYTES = 64 * 1024;

export class SupabaseOrderProjection {
  #url;
  #key;
  #fetch;
  #schema;

  constructor(options = {}) {
    this.#url = normalizeSupabaseUrl(options.url);
    this.#key = clean(options.serviceKey || options.secretKey);
    this.#fetch = options.fetch || globalThis.fetch;
    this.#schema = identifier(options.schema || 'public');

    if (!this.#url) throw projectionError('SUPABASE_URL_INVALID');
    if (this.#key.length < 20) throw projectionError('SUPABASE_SECRET_KEY_INVALID');
    if (typeof this.#fetch !== 'function') throw projectionError('SUPABASE_FETCH_REQUIRED');
    if (!this.#schema) throw projectionError('SUPABASE_SCHEMA_INVALID');
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

    const result = await this.#rpc('order_projection_health_v2', {});
    return {
      ok: result?.ok !== false,
      adapter: 'supabase-order-projection',
      configured: true,
      probed: true,
      schema: this.#schema,
      result
    };
  }

  async #rpc(functionName, body) {
    const response = await this.#fetch(
      `${this.#url}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
      {
        method: 'POST',
        headers: {
          apikey: this.#key,
          Authorization: `Bearer ${this.#key}`,
          'Content-Type': 'application/json',
          'Content-Profile': this.#schema,
          Accept: 'application/json',
          Prefer: 'return=representation'
        },
        body: JSON.stringify(body)
      }
    );

    const text = await readLimitedResponseText(response, MAX_REMOTE_RESPONSE_BYTES);
    const payload = parsePayload(text);

    if (!response.ok) {
      const error = projectionError('SUPABASE_PROJECTION_REQUEST_FAILED');
      error.status = response.status;
      error.remoteCode = safeRemoteText(payload?.code, this.#key, 80);
      error.remoteMessage = safeRemoteText(
        payload?.message || payload?.details || payload?.hint,
        this.#key,
        240
      );
      throw error;
    }

    const result = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
    return normalizeProjectionResult(result);
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

async function readLimitedResponseText(response, maxBytes) {
  const declaredLength = Number.parseInt(response?.headers?.get?.('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw projectionError('SUPABASE_PROJECTION_RESPONSE_TOO_LARGE');
  }

  if (!response?.body?.getReader) {
    const text = await response.text().catch(() => '');
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw projectionError('SUPABASE_PROJECTION_RESPONSE_TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('SUPABASE_PROJECTION_RESPONSE_TOO_LARGE').catch(() => {});
        throw projectionError('SUPABASE_PROJECTION_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
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

function normalizeSupabaseUrl(value) {
  const text = clean(value).replace(/\/$/, '').replace(/\/rest\/v1$/, '');
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function parsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function safeRemoteText(value, secret, maxLength) {
  const text = clean(value);
  if (!text) return '';
  const redacted = secret ? text.split(secret).join('[REDACTED]') : text;
  return redacted.slice(0, maxLength);
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function identifier(value) {
  const text = clean(value);
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text) ? text : '';
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function projectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
