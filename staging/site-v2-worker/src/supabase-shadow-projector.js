import {
  DEFAULT_SUPABASE_RPC_RESPONSE_BYTES,
  normalizeSupabaseUrl,
  SupabaseRpcClient
} from '../../../src/v2/persistence/supabase-rpc-client.mjs';

const DEFAULT_TIMEOUT_MS = 3500;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 10000;
const RPC_FUNCTION = 'armazem_v2_project_order_v1';

export function supabaseShadowStatus(env = {}) {
  const enabled = String(env.SUPABASE_SHADOW_ENABLED || '') === 'true';
  const url = normalizeSupabaseUrl(env.SUPABASE_V2_URL);
  const serviceRoleKey = String(env.SUPABASE_V2_SERVICE_ROLE_KEY || '').trim();

  return {
    enabled,
    configured: Boolean(url && serviceRoleKey.length >= 32),
    mode: 'best-effort',
    target: url ? 'supabase-v2-staging' : 'unconfigured'
  };
}

export function buildSupabaseOrderProjection({ command = {}, result = {} } = {}) {
  const order = result.order && typeof result.order === 'object' ? result.order : null;
  const orderNumber = String(result.orderNumber || order?.orderNumber || '').trim().toUpperCase();
  const eventCreatedAt = validIsoDate(command.submissionCreatedAt || order?.createdAt);
  const idempotencyKey = String(command.idempotencyKey || '').trim().toLowerCase();
  const fingerprint = String(command.fingerprint || '').trim().toLowerCase();

  if (!order || !/^PED\d{7}[A-Z]$/.test(orderNumber)) throw shadowError('SUPABASE_SHADOW_ORDER_INVALID');
  if (!eventCreatedAt) throw shadowError('SUPABASE_SHADOW_EVENT_DATE_INVALID');
  if (!/^idempotency:v2:[a-f0-9]{64}$/.test(idempotencyKey)) {
    throw shadowError('SUPABASE_SHADOW_IDEMPOTENCY_INVALID');
  }
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw shadowError('SUPABASE_SHADOW_FINGERPRINT_INVALID');

  return {
    contractVersion: 1,
    eventId: `shadow:order.created.v2:${orderNumber}`,
    eventType: 'order.created.v2',
    eventCreatedAt,
    idempotencyKey,
    fingerprint,
    requestId: safeText(command.requestId, 160),
    actor: safeText(command.actor || 'staging-shadow', 120),
    order
  };
}

export function scheduleSupabaseShadowProjection({
  ctx,
  env = {},
  command = {},
  result = {},
  fetchImpl = globalThis.fetch,
  logger = console
} = {}) {
  const status = supabaseShadowStatus(env);
  if (!status.enabled) return { scheduled: false, state: 'disabled' };

  if (!status.configured || typeof fetchImpl !== 'function') {
    emitLog(logger, 'error', {
      event: 'supabase-shadow-projection-not-scheduled',
      code: 'SUPABASE_SHADOW_NOT_CONFIGURED',
      requestId: safeText(command.requestId, 100),
      orderNumber: safeText(result.orderNumber, 20)
    });
    return { scheduled: false, state: 'misconfigured' };
  }

  const task = projectOrderToSupabase({ env, command, result, fetchImpl })
    .then(projectionResult => {
      emitLog(logger, 'log', {
        level: 'info',
        event: 'supabase-shadow-projection-succeeded',
        requestId: safeText(command.requestId, 100),
        orderNumber: projectionResult.orderNumber,
        action: projectionResult.action,
        latencyMs: projectionResult.latencyMs
      });
      return projectionResult;
    })
    .catch(error => {
      emitLog(logger, 'error', {
        level: 'error',
        event: 'supabase-shadow-projection-failed',
        requestId: safeText(command.requestId, 100),
        orderNumber: safeText(result.orderNumber, 20),
        code: publicShadowErrorCode(error)
      });
      return { ok: false, code: publicShadowErrorCode(error) };
    });

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  else void task;

  return { scheduled: true, state: 'scheduled' };
}

export async function projectOrderToSupabase({
  env = {},
  command = {},
  result = {},
  fetchImpl = globalThis.fetch
} = {}) {
  const status = supabaseShadowStatus(env);
  if (!status.enabled) throw shadowError('SUPABASE_SHADOW_DISABLED');
  if (!status.configured) throw shadowError('SUPABASE_SHADOW_NOT_CONFIGURED');
  if (typeof fetchImpl !== 'function') throw shadowError('SUPABASE_SHADOW_FETCH_UNAVAILABLE');

  const projection = buildSupabaseOrderProjection({ command, result });
  const startedAt = Date.now();
  let payload;

  try {
    const client = new SupabaseRpcClient({
      url: env.SUPABASE_V2_URL,
      serviceKey: env.SUPABASE_V2_SERVICE_ROLE_KEY,
      fetch: fetchImpl,
      schema: 'public',
      timeoutMs: boundedTimeout(env.SUPABASE_SHADOW_TIMEOUT_MS),
      maxResponseBytes: DEFAULT_SUPABASE_RPC_RESPONSE_BYTES
    });

    payload = await client.call(RPC_FUNCTION, { p_projection: projection });
  } catch (error) {
    throw mapRpcError(error);
  }

  const normalized = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
  if (
    normalized?.ok !== true ||
    !['CREATED', 'REPLAY'].includes(normalized?.action) ||
    normalized?.orderNumber !== projection.order.orderNumber
  ) {
    throw shadowError('SUPABASE_SHADOW_RESPONSE_MISMATCH');
  }

  return {
    ok: true,
    action: normalized.action,
    replayed: normalized.replayed === true,
    orderNumber: normalized.orderNumber,
    latencyMs: Date.now() - startedAt
  };
}

function mapRpcError(error) {
  if (error?.code === 'SUPABASE_RPC_RESPONSE_TOO_LARGE') {
    return shadowError('SUPABASE_SHADOW_RESPONSE_TOO_LARGE');
  }
  if (error?.code === 'SUPABASE_RPC_TIMEOUT') {
    return shadowError('SUPABASE_SHADOW_TIMEOUT');
  }
  if (error?.code === 'SUPABASE_RPC_REQUEST_FAILED') {
    const status = Number(error.status || 0);
    return shadowError(
      Number.isInteger(status) && status >= 100 && status <= 599
        ? `SUPABASE_SHADOW_HTTP_${status}`
        : 'SUPABASE_SHADOW_REQUEST_FAILED'
    );
  }
  if (
    error?.code === 'SUPABASE_URL_INVALID' ||
    error?.code === 'SUPABASE_SECRET_KEY_INVALID' ||
    error?.code === 'SUPABASE_SCHEMA_INVALID'
  ) {
    return shadowError('SUPABASE_SHADOW_NOT_CONFIGURED');
  }
  if (error?.code === 'SUPABASE_FETCH_REQUIRED') {
    return shadowError('SUPABASE_SHADOW_FETCH_UNAVAILABLE');
  }
  return shadowError('SUPABASE_SHADOW_REQUEST_FAILED');
}

function boundedTimeout(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(parsed, MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

function validIsoDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function safeText(value, maximum) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._:@-]/g, '')
    .slice(0, maximum);
}

function emitLog(logger, method, payload) {
  const target = logger && typeof logger[method] === 'function' ? logger[method].bind(logger) : null;
  if (target) target(JSON.stringify(payload));
}

function publicShadowErrorCode(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  return /^SUPABASE_SHADOW_[A-Z0-9_]{1,80}$/.test(code)
    ? code
    : 'SUPABASE_SHADOW_REQUEST_FAILED';
}

function shadowError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
