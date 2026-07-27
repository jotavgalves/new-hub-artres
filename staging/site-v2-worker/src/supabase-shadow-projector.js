const DEFAULT_TIMEOUT_MS = 3500;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const RPC_PATH = '/rest/v1/rpc/armazem_v2_project_order_v1';

export function supabaseShadowStatus(env = {}) {
  const enabled = String(env.SUPABASE_SHADOW_ENABLED || '') === 'true';
  const url = normalizedBaseUrl(env.SUPABASE_V2_URL);
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
  const baseUrl = normalizedBaseUrl(env.SUPABASE_V2_URL);
  const serviceRoleKey = String(env.SUPABASE_V2_SERVICE_ROLE_KEY || '').trim();
  const timeoutMs = boundedTimeout(env.SUPABASE_SHADOW_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(new URL(RPC_PATH, `${baseUrl}/`).toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'X-Client-Info': 'new-hub-artres-v2-staging-shadow/1'
      },
      body: JSON.stringify({ p_projection: projection }),
      signal: controller.signal
    });

    const responseText = await readLimitedResponseText(response, MAX_RESPONSE_BYTES);
    if (!response.ok) throw shadowError(`SUPABASE_SHADOW_HTTP_${response.status}`);

    let payload;
    try {
      payload = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
      throw shadowError('SUPABASE_SHADOW_RESPONSE_INVALID');
    }

    if (
      payload?.ok !== true ||
      !['CREATED', 'REPLAY'].includes(payload?.action) ||
      payload?.orderNumber !== projection.order.orderNumber
    ) {
      throw shadowError('SUPABASE_SHADOW_RESPONSE_MISMATCH');
    }

    return {
      ok: true,
      action: payload.action,
      replayed: payload.replayed === true,
      orderNumber: payload.orderNumber,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw shadowError('SUPABASE_SHADOW_TIMEOUT');
    if (String(error?.code || '').startsWith('SUPABASE_SHADOW_')) throw error;
    throw shadowError('SUPABASE_SHADOW_REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedResponseText(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw shadowError('SUPABASE_SHADOW_RESPONSE_TOO_LARGE');
  }

  if (!response.body) return '';
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
        await reader.cancel('SUPABASE_SHADOW_RESPONSE_TOO_LARGE').catch(() => {});
        throw shadowError('SUPABASE_SHADOW_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function normalizedBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text.startsWith('https://')) return '';
  try {
    const url = new URL(text);
    const rootPath = url.pathname === '' || url.pathname === '/';
    const cleanAuthority = !url.username && !url.password && !url.search && !url.hash;
    return url.protocol === 'https:' && rootPath && cleanAuthority ? url.origin : '';
  } catch (_) {
    return '';
  }
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
