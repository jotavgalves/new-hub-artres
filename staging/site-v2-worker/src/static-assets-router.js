const STATIC_METHODS = new Set(['GET', 'HEAD']);
const PROBE_MAX_BYTES = 512 * 1024;
const EXPECTED_TITLE = /<title>Escolha suas Artes \| Armazém Festa e Eventos<\/title>/i;

export function isStaticAssetRoute(pathname) {
  const path = String(pathname || '');
  if (path === '/health') return false;
  if (path === '/admin' || path === '/admin/' || path.startsWith('/admin/')) return false;
  if (path.startsWith('/api/')) return false;
  if (path.startsWith('/internal/')) return false;
  return true;
}

export async function serveStaticAsset(request, env, requestId, options = {}) {
  if (!STATIC_METHODS.has(request.method)) {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
      Allow: 'GET, HEAD'
    });
  }

  const assetFetcher = env?.ASSETS?.fetch;
  if (typeof assetFetcher !== 'function') {
    return json({ ok: false, error: 'STAGING_ASSETS_NOT_CONFIGURED', requestId }, 503);
  }

  try {
    return await Reflect.apply(assetFetcher, env.ASSETS, [request]);
  } catch (_) {
    logAssetFailure(options.logger || console);
    return json({ ok: false, error: 'STAGING_ASSET_FETCH_FAILED', requestId }, 502);
  }
}

export async function probeStaticAssets(request, env, requestId, options = {}) {
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
      Allow: 'GET'
    });
  }

  const assetFetcher = env?.ASSETS?.fetch;
  if (typeof assetFetcher !== 'function') {
    return json({
      ok: true,
      requestId,
      bindingConfigured: false,
      probes: []
    });
  }

  const probes = [];
  for (const pathname of ['/index.html', '/']) {
    probes.push(await probeAssetPath(request, env, pathname, {
      logger: options.logger || console,
      maxBytes: boundedPositiveInteger(options.maxBytes, PROBE_MAX_BYTES, PROBE_MAX_BYTES)
    }));
  }

  return json({
    ok: true,
    requestId,
    bindingConfigured: true,
    probes
  });
}

async function probeAssetPath(originalRequest, env, pathname, options) {
  const target = new URL(pathname, originalRequest.url);
  const headers = new Headers({
    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    'Cache-Control': 'no-store'
  });
  const probeRequest = new Request(target, { method: 'GET', headers });

  try {
    const response = await Reflect.apply(env.ASSETS.fetch, env.ASSETS, [probeRequest]);
    const body = await readLimitedText(response, options.maxBytes);
    return Object.freeze({
      pathname,
      responseReceived: true,
      status: response.status,
      ok: response.ok,
      contentType: safeContentType(response.headers.get('content-type')),
      bodyBytes: new TextEncoder().encode(body).byteLength,
      titleMatched: EXPECTED_TITLE.test(body),
      error: ''
    });
  } catch (error) {
    logAssetFailure(options.logger);
    return Object.freeze({
      pathname,
      responseReceived: false,
      status: 0,
      ok: false,
      contentType: '',
      bodyBytes: 0,
      titleMatched: false,
      error: publicProbeCode(error)
    });
  }
}

async function readLimitedText(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw probeError('STAGING_ASSET_PROBE_RESPONSE_TOO_LARGE');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('STAGING_ASSET_PROBE_RESPONSE_TOO_LARGE').catch(() => {});
        throw probeError('STAGING_ASSET_PROBE_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function logAssetFailure(logger) {
  logger?.error?.(JSON.stringify({
    level: 'error',
    service: 'new-hub-artres-v2-staging',
    event: 'static-asset-fetch-failed',
    code: 'STAGING_ASSET_FETCH_FAILED'
  }));
}

function safeContentType(value) {
  const type = String(value || '').split(';', 1)[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type) ? type : '';
}

function publicProbeCode(error) {
  const code = String(error?.code || error?.message || 'STAGING_ASSET_FETCH_FAILED');
  return /^STAGING_ASSET_[A-Z0-9_]{3,80}$/.test(code)
    ? code
    : 'STAGING_ASSET_FETCH_FAILED';
}

function boundedPositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function probeError(code) {
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
      ...extraHeaders
    }
  });
}
