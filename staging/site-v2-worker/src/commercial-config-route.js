import {
  COMMERCIAL_CONFIG_OBJECT_NAME,
  commercialConfigToProductSnapshot,
  normalizeCommercialConfig,
  publicCommercialConfigView
} from '../../../src/v2/products/commercial-config.mjs';

const MAX_CONFIG_BODY_BYTES = 32 * 1024;
const MAX_HISTORY = 50;

export async function loadActiveCommercialConfig(env, options = {}) {
  const catalogVersion = positiveInteger(options.catalogVersion);
  if (!catalogVersion) throw configRouteError('COMMERCIAL_CONFIG_CATALOG_VERSION_INVALID');
  const stub = commercialConfigStub(env);
  const config = normalizeCommercialConfig(await stub.getCommercialConfig());
  return Object.freeze({
    config,
    publicView: publicCommercialConfigView(config),
    productSnapshot: commercialConfigToProductSnapshot(config, { catalogVersion })
  });
}

export async function handlePublicCommercialConfig(request, env, requestId) {
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);

  try {
    const config = normalizeCommercialConfig(await commercialConfigStub(env).getCommercialConfig());
    return json({
      ok: true,
      requestId,
      config: publicCommercialConfigView(config)
    }, 200, {
      ETag: `"commercial-config-v${config.version}"`
    });
  } catch (error) {
    return routeFailure(error, requestId);
  }
}

export async function handleAdminCommercialConfig(request, env, requestId) {
  const stub = commercialConfigStub(env);

  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const limit = boundedPositiveInteger(url.searchParams.get('history'), 10, MAX_HISTORY);
      const [config, history] = await Promise.all([
        stub.getCommercialConfig(),
        stub.listCommercialConfigHistory(limit)
      ]);
      return json({
        ok: true,
        requestId,
        versioned: true,
        config: publicCommercialConfigView(normalizeCommercialConfig(config)),
        history: (Array.isArray(history) ? history : []).map(entry => ({
          version: positiveInteger(entry.version),
          actor: safeText(entry.actor, 120),
          requestId: safeText(entry.requestId, 100),
          createdAt: validIsoDate(entry.createdAt)
        }))
      });
    }

    if (request.method === 'PUT') {
      const body = await readJsonBody(request, MAX_CONFIG_BODY_BYTES);
      const expectedVersion = positiveInteger(body.expectedVersion);
      if (!expectedVersion) throw configRouteError('COMMERCIAL_CONFIG_EXPECTED_VERSION_REQUIRED');
      const updated = await stub.updateCommercialConfig({
        expectedVersion,
        config: body.config,
        actor: 'staging-admin',
        requestId,
        updatedAt: new Date().toISOString()
      });
      const normalized = normalizeCommercialConfig(updated);
      return json({
        ok: true,
        requestId,
        updated: true,
        config: publicCommercialConfigView(normalized)
      }, 200, {
        ETag: `"commercial-config-v${normalized.version}"`
      });
    }

    return methodNotAllowed(['GET', 'PUT'], requestId);
  } catch (error) {
    return routeFailure(error, requestId);
  }
}

function commercialConfigStub(env) {
  if (!env?.ORDER_LEDGER || typeof env.ORDER_LEDGER.getByName !== 'function') {
    throw configRouteError('COMMERCIAL_CONFIG_STORE_NOT_CONFIGURED');
  }
  return env.ORDER_LEDGER.getByName(COMMERCIAL_CONFIG_OBJECT_NAME);
}

async function readJsonBody(request, maxBytes) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) throw configRouteError('CONTENT_TYPE_NOT_JSON');
  const declared = Number.parseInt(request.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw configRouteError('COMMERCIAL_CONFIG_BODY_TOO_LARGE');
  }

  const text = await readLimitedText(request, maxBytes);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw configRouteError('COMMERCIAL_CONFIG_JSON_INVALID');
    }
    return parsed;
  } catch (error) {
    if (error?.code) throw error;
    throw configRouteError('COMMERCIAL_CONFIG_JSON_INVALID');
  }
}

async function readLimitedText(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('COMMERCIAL_CONFIG_BODY_TOO_LARGE').catch(() => {});
        throw configRouteError('COMMERCIAL_CONFIG_BODY_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function routeFailure(error, requestId) {
  const code = publicCode(error);
  const extra = code === 'COMMERCIAL_CONFIG_VERSION_CONFLICT' && positiveInteger(error?.currentVersion)
    ? { currentVersion: positiveInteger(error.currentVersion) }
    : {};
  return json({ ok: false, error: code, requestId, ...extra }, statusForCode(code));
}

function publicCode(error) {
  const code = String(error?.code || error?.message || 'COMMERCIAL_CONFIG_FAILED');
  return /^[A-Z0-9_:.-]{3,160}$/.test(code) ? code : 'COMMERCIAL_CONFIG_FAILED';
}

function statusForCode(code) {
  if (code === 'CONTENT_TYPE_NOT_JSON') return 415;
  if (code === 'COMMERCIAL_CONFIG_BODY_TOO_LARGE') return 413;
  if (code === 'COMMERCIAL_CONFIG_JSON_INVALID') return 400;
  if (code === 'COMMERCIAL_CONFIG_VERSION_CONFLICT') return 409;
  if (code.includes('NOT_CONFIGURED') || code.includes('CURRENT_MISSING')) return 503;
  if (
    code.includes('INVALID') ||
    code.includes('REQUIRED') ||
    code.includes('MISMATCH') ||
    code.includes('BELOW_MINIMUM') ||
    code.includes('UNKNOWN_PRODUCT')
  ) return 422;
  return 500;
}

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
    Allow: methods.join(', ')
  });
}

function validIsoDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function safeText(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = positiveInteger(value) || fallback;
  return Math.min(Math.max(parsed, 1), maximum);
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function configRouteError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    }
  });
}
