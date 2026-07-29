const ALLOWED_BROWSE_MODES = new Set(['themes', 'products', 'items']);
const ALLOWED_SEARCH_MODES = new Set(['search', 'globalSearch', 'folderSearch']);
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export function catalogAcceptedStatus(env = {}) {
  const baseUrl = normalizeSupabaseUrl(env.SUPABASE_V2_URL);
  const key = String(env.SUPABASE_V2_SERVICE_ROLE_KEY || '').trim();
  return Object.freeze({
    enabled: env.CATALOG_ACCEPTED_ENABLED === 'true',
    configured: Boolean(baseUrl && key.length >= 32),
    source: 'supabase-accepted-readonly',
    target: baseUrl ? new URL(baseUrl).hostname : ''
  });
}

export async function handleCatalogAcceptedPublicRoute(request, env, requestId, options = {}) {
  const status = catalogAcceptedStatus(env);
  if (!status.enabled) return json({ ok: false, error: 'CATALOG_ACCEPTED_DISABLED', requestId }, 503);
  if (!status.configured) return json({ ok: false, error: 'CATALOG_ACCEPTED_NOT_CONFIGURED', requestId }, 503);
  if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);

  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/catalog-meta') {
      const payload = await catalogRpc('armazem_v2_catalog_status_v1', {}, env, options);
      if (payload?.configured !== true) {
        return json({ ok: false, error: 'CATALOG_ACCEPTED_NOT_READY', requestId }, 503);
      }
      return json({
        ok: true,
        catalogVersion: Number(payload.catalogVersion || 0),
        updatedAt: payload.acceptedAt || new Date(0).toISOString(),
        source: 'catalog_v2_accepted',
        routeCount: Number(payload.routeCount || 0),
        folderCount: Number(payload.folderCount || 0),
        itemCount: Number(payload.itemCount || 0)
      }, 200, 0);
    }

    if (url.pathname !== '/api/drive') {
      return json({ ok: false, error: 'ROUTE_NOT_FOUND', requestId }, 404);
    }

    const mode = String(url.searchParams.get('mode') || 'themes').trim();
    if (ALLOWED_BROWSE_MODES.has(mode)) {
      const payload = await catalogRpc('armazem_v2_catalog_route_v1', {
        p_mode: mode,
        p_folder_id: String(url.searchParams.get('folderId') || '').trim(),
        p_product_key: cleanProductKey(url.searchParams.get('product') || '')
      }, env, options);
      return json(payload, 200, 15);
    }

    if (ALLOWED_SEARCH_MODES.has(mode)) {
      const rawQuery = String(
        url.searchParams.get('q') ||
        url.searchParams.get('code') ||
        url.searchParams.get('imageId') ||
        ''
      ).trim();
      const query = normalizeSearchText(rawQuery);
      if (!query || ((mode === 'globalSearch' || mode === 'folderSearch') && query.length < 2)) {
        return json(emptySearchPayload(mode), 200, 15);
      }
      const payload = await catalogRpc('armazem_v2_catalog_search_v1', {
        p_mode: mode,
        p_query: query,
        p_limit: mode === 'folderSearch' ? 60 : 80
      }, env, options);
      return json(payload, 200, 15);
    }

    return json({ ok: false, error: 'MODO_INVALIDO', requestId }, 400);
  } catch (error) {
    const code = publicErrorCode(error);
    return json({ ok: false, error: code, requestId }, statusForError(code));
  }
}

async function catalogRpc(name, body, env, options) {
  const baseUrl = normalizeSupabaseUrl(env.SUPABASE_V2_URL);
  const key = String(env.SUPABASE_V2_SERVICE_ROLE_KEY || '').trim();
  const timeoutMs = boundedInteger(env.CATALOG_ACCEPTED_TIMEOUT_MS, 500, 15000, DEFAULT_TIMEOUT_MS);
  const maxResponseBytes = boundedInteger(
    env.CATALOG_ACCEPTED_MAX_RESPONSE_BYTES,
    1024,
    8 * 1024 * 1024,
    DEFAULT_MAX_RESPONSE_BYTES
  );
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw routeError('CATALOG_ACCEPTED_FETCH_REQUIRED');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const rpcUrl = new URL(`/rest/v1/rpc/${name}`, baseUrl);
    const response = await Reflect.apply(fetchImpl, globalThis, [rpcUrl, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(body || {})
    }]);
    const text = await readLimitedText(response, maxResponseBytes);
    if (!response.ok) {
      let message = '';
      try { message = String(JSON.parse(text)?.message || ''); } catch (_) {}
      throw routeError(/^[A-Z0-9_]{3,100}$/.test(message) ? message : `CATALOG_ACCEPTED_RPC_${response.status}`);
    }
    try {
      const payload = text ? JSON.parse(text) : {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('NOT_OBJECT');
      }
      return payload;
    } catch (_) {
      throw routeError('CATALOG_ACCEPTED_RPC_JSON_INVALID');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw routeError('CATALOG_ACCEPTED_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) throw routeError('CATALOG_ACCEPTED_RESPONSE_TOO_LARGE');
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
        await reader.cancel('CATALOG_ACCEPTED_RESPONSE_TOO_LARGE').catch(() => {});
        throw routeError('CATALOG_ACCEPTED_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function emptySearchPayload(mode) {
  if (mode === 'folderSearch') {
    return { ok: true, mode, source: 'catalog_v2_accepted', total: 0, results: [] };
  }
  if (mode === 'globalSearch') {
    return {
      ok: true,
      mode,
      source: 'catalog_v2_accepted',
      totalFolders: 0,
      totalItems: 0,
      folders: [],
      items: []
    };
  }
  return { ok: true, mode, source: 'catalog_v2_accepted', total: 0, items: [] };
}

export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function cleanProductKey(value) {
  const text = String(value || '50x50').trim();
  return /^[A-Za-z0-9._-]{1,120}$/.test(text) ? text : '50x50';
}

function normalizeSupabaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    return '';
  }
  return url.origin;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function publicErrorCode(error) {
  const code = String(error?.code || error?.message || 'CATALOG_ACCEPTED_FAILED');
  return /^[A-Z0-9_]{3,100}$/.test(code) ? code : 'CATALOG_ACCEPTED_FAILED';
}

function statusForError(code) {
  if (code === 'CATALOG_ACCEPTED_TIMEOUT') return 504;
  if (code === 'CATALOG_ACCEPTED_RESPONSE_TOO_LARGE') return 502;
  if (code.includes('NOT_READY') || code.includes('NOT_ACCEPTED')) return 503;
  if (code.includes('INVALID') || code.includes('REQUIRED') || code.includes('NOT_FOUND')) return 422;
  return 502;
}

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, 0, { Allow: methods.join(', ') });
}

function json(payload, status = 200, ttl = 0, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function routeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
