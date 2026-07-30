import { SupabaseRpcClient } from '../../../src/v2/persistence/supabase-rpc-client.mjs';

const ALLOWED_BROWSE_MODES = new Set(['themes', 'products', 'items']);
const ALLOWED_SEARCH_MODES = new Set(['search', 'globalSearch', 'folderSearch']);
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export const PANEL_150_DRIVE_ROOT_ID = '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-';

const PRODUCT_DRIVE_ROOTS = Object.freeze({
  'painel-150': PANEL_150_DRIVE_ROOT_ID
});

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
    const productKey = resolveRequestedProductKey(request, url);
    const driveRootId = PRODUCT_DRIVE_ROOTS[productKey] || '';

    if (ALLOWED_BROWSE_MODES.has(mode)) {
      const body = {
        p_mode: mode,
        p_folder_id: String(url.searchParams.get('folderId') || '').trim(),
        p_product_key: productKey
      };
      const rpcName = driveRootId
        ? 'armazem_v2_catalog_route_scoped_v1'
        : 'armazem_v2_catalog_route_v1';
      if (driveRootId) body.p_root_drive_id = driveRootId;
      const payload = await catalogRpc(rpcName, body, env, options);
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
      const body = {
        p_mode: mode,
        p_query: query,
        p_limit: mode === 'folderSearch' ? 60 : 80
      };
      const rpcName = driveRootId
        ? 'armazem_v2_catalog_search_scoped_v1'
        : 'armazem_v2_catalog_search_v1';
      if (driveRootId) {
        body.p_product_key = productKey;
        body.p_root_drive_id = driveRootId;
      }
      const payload = await catalogRpc(rpcName, body, env, options);
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

  try {
    const client = new SupabaseRpcClient({
      url: baseUrl,
      serviceKey: key,
      fetch: options.fetch || globalThis.fetch,
      schema: 'public',
      timeoutMs,
      maxResponseBytes
    });
    return await client.call(name, body || {});
  } catch (error) {
    throw mapRpcError(error);
  }
}

function mapRpcError(error) {
  const code = String(error?.code || '');
  if (code === 'SUPABASE_RPC_TIMEOUT') return routeError('CATALOG_ACCEPTED_TIMEOUT');
  if (code === 'SUPABASE_RPC_RESPONSE_TOO_LARGE') {
    return routeError('CATALOG_ACCEPTED_RESPONSE_TOO_LARGE');
  }
  if (code === 'SUPABASE_RPC_REQUEST_FAILED') {
    const remoteMessage = String(error?.remoteMessage || '').trim();
    if (/^[A-Z0-9_]{3,100}$/.test(remoteMessage)) return routeError(remoteMessage);
    const status = Number(error?.status || 0);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return routeError(`CATALOG_ACCEPTED_RPC_${status}`);
    }
    return routeError('CATALOG_ACCEPTED_RPC_FAILED');
  }
  if (
    code === 'SUPABASE_URL_INVALID' ||
    code === 'SUPABASE_SECRET_KEY_INVALID' ||
    code === 'SUPABASE_FETCH_REQUIRED' ||
    code === 'SUPABASE_SCHEMA_INVALID' ||
    code === 'SUPABASE_RPC_FUNCTION_INVALID' ||
    code === 'SUPABASE_RPC_BODY_INVALID'
  ) {
    return routeError('CATALOG_ACCEPTED_RPC_CLIENT_INVALID');
  }
  return routeError('CATALOG_ACCEPTED_FAILED');
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

export function resolveRequestedProductKey(request, url = new URL(request.url)) {
  const direct = String(url.searchParams.get('product') || '').trim();
  if (direct) return cleanProductKey(direct);

  try {
    const refererValue = String(request.headers.get('referer') || '').trim();
    if (refererValue) {
      const referer = new URL(refererValue);
      if (referer.origin === url.origin) {
        const value = referer.searchParams.get('produto') || referer.searchParams.get('product') || '';
        if (String(value).trim()) return cleanProductKey(value);
      }
    }
  } catch (_) {}

  return '50x50';
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
  if (code.includes('INVALID') || code.includes('REQUIRED') || code.includes('NOT_FOUND') || code.includes('OUTSIDE_ROOT')) return 422;
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
