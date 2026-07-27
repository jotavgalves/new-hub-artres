import { buildCatalogResponseV2, createCatalogContext } from './schema.mjs';

export const CATALOG_SOURCE_VERSION = 1;
export const CATALOG_INDEX_TABLE = 'catalog_index';

const SELECT_COLUMNS = [
  'drive_id',
  'parent_drive_id',
  'root_drive_id',
  'type',
  'name',
  'mime_type',
  'path',
  'path_parts',
  'depth',
  'theme',
  'subtheme',
  'product',
  'size',
  'code',
  'extension',
  'drive_url',
  'thumbnail_url',
  'search_text',
  'indexed_at',
  'deleted_at'
];

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_ROWS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function catalogReadStatus(env = {}) {
  const enabled = String(env.CATALOG_V2_READ_ENABLED || '') === 'true';
  const url = normalizedBaseUrl(env.ARTS_SUPABASE_URL);
  const serviceKey = clean(env.ARTS_SUPABASE_SERVICE_KEY);

  return deepFreeze({
    enabled,
    configured: Boolean(url && serviceKey.length >= 32),
    mode: 'read-only',
    source: 'catalog_index',
    aliases: {
      url: url ? 'ARTS_SUPABASE_URL' : '',
      key: serviceKey ? 'ARTS_SUPABASE_SERVICE_KEY' : ''
    },
    genericAliasesAccepted: false,
    valuesExposed: false
  });
}

export function createSupabaseCatalogSource(options = {}) {
  const baseUrl = requireHttpsBaseUrl(options.url);
  const serviceKey = clean(options.serviceKey);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = clamp(options.timeoutMs, 500, 15000, DEFAULT_TIMEOUT_MS);
  const pageSize = clamp(options.pageSize, 1, 1000, DEFAULT_PAGE_SIZE);
  const maxRows = clamp(options.maxRows, 1, 10000, DEFAULT_MAX_ROWS);
  const maxResponseBytes = clamp(
    options.maxResponseBytes,
    1024,
    8 * 1024 * 1024,
    DEFAULT_MAX_RESPONSE_BYTES
  );

  if (serviceKey.length < 32) throw sourceError('CATALOG_SERVICE_KEY_MISSING_OR_SHORT');
  if (typeof fetchImpl !== 'function') throw sourceError('CATALOG_FETCH_IMPLEMENTATION_REQUIRED');

  return Object.freeze({
    version: CATALOG_SOURCE_VERSION,
    mode: 'read-only',
    table: CATALOG_INDEX_TABLE,
    async listRoot(input = {}) {
      const rootDriveId = identity(input.rootDriveId);
      if (!rootDriveId) throw sourceError('ROOT_DRIVE_ID_REQUIRED');

      const context = input.context || createCatalogContext({
        catalogVersion: input.catalogVersion,
        roots: input.roots
      });

      if (!context.roots?.[rootDriveId]) {
        throw sourceError('ROOT_DRIVE_NOT_CONFIGURED', rootDriveId);
      }

      const rows = [];
      let offset = 0;

      while (rows.length < maxRows) {
        const remaining = maxRows - rows.length;
        const currentLimit = Math.min(pageSize, remaining);
        const url = buildCatalogPageUrl(baseUrl, {
          rootDriveId,
          limit: currentLimit,
          offset
        });

        const page = await fetchCatalogPage({
          fetchImpl,
          url,
          serviceKey,
          timeoutMs,
          maxResponseBytes
        });

        rows.push(...page);
        if (page.length < currentLimit) break;
        offset += page.length;

        if (rows.length >= maxRows) {
          throw sourceError('CATALOG_ROW_LIMIT_EXCEEDED', String(maxRows));
        }
      }

      const response = buildCatalogResponseV2({
        context,
        rootDriveId,
        rows,
        strict: input.strict === true
      });

      return deepFreeze({
        ...response,
        source: {
          adapterVersion: CATALOG_SOURCE_VERSION,
          provider: 'supabase-rest',
          table: CATALOG_INDEX_TABLE,
          readOnly: true,
          pageSize,
          rowCount: rows.length,
          valuesExposed: false
        }
      });
    }
  });
}

export function buildCatalogPageUrl(baseUrl, input = {}) {
  const rootDriveId = identity(input.rootDriveId);
  if (!rootDriveId) throw sourceError('ROOT_DRIVE_ID_REQUIRED');

  const limit = clamp(input.limit, 1, 1000, DEFAULT_PAGE_SIZE);
  const offset = clamp(input.offset, 0, 1000000, 0);
  const url = new URL(`${requireHttpsBaseUrl(baseUrl)}/rest/v1/${CATALOG_INDEX_TABLE}`);

  url.searchParams.set('select', SELECT_COLUMNS.join(','));
  url.searchParams.set('root_drive_id', `eq.${rootDriveId}`);
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('order', 'depth.asc,name.asc,drive_id.asc');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  return url.toString();
}

async function fetchCatalogPage(input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('CATALOG_SOURCE_TIMEOUT'), input.timeoutMs);

  try {
    const response = await input.fetchImpl(input.url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        apikey: input.serviceKey,
        Authorization: `Bearer ${input.serviceKey}`,
        'Accept-Profile': 'public',
        'Cache-Control': 'no-cache',
        'X-Client-Info': 'armazem-v2-catalog-readonly/1'
      },
      signal: controller.signal
    });

    const text = await readBoundedText(response, input.maxResponseBytes);
    if (!response.ok) throw sourceError(`CATALOG_SOURCE_HTTP_${response.status}`);

    let payload;
    try {
      payload = text ? JSON.parse(text) : [];
    } catch {
      throw sourceError('CATALOG_SOURCE_INVALID_JSON');
    }

    if (!Array.isArray(payload)) throw sourceError('CATALOG_SOURCE_RESPONSE_NOT_ARRAY');
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw sourceError('CATALOG_SOURCE_TIMEOUT');
    if (error?.code) throw error;
    throw sourceError('CATALOG_SOURCE_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw sourceError('CATALOG_SOURCE_RESPONSE_TOO_LARGE');
  }

  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw sourceError('CATALOG_SOURCE_RESPONSE_TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('CATALOG_SOURCE_RESPONSE_TOO_LARGE');
      throw sourceError('CATALOG_SOURCE_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    combined.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function requireHttpsBaseUrl(value) {
  const normalized = normalizedBaseUrl(value);
  if (!normalized) throw sourceError('CATALOG_SUPABASE_URL_INVALID');
  return normalized;
}

function normalizedBaseUrl(value) {
  const text = clean(value).replace(/\/+$/, '');
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

function identity(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function sourceError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = clean(detail).slice(0, 120);
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
