import { buildCatalogResponseV2, createCatalogContext } from './schema.mjs';
import { compareCatalogShadow } from './shadow-compare.mjs';

export const LEGACY_CATALOG_BRIDGE_SCHEMA_VERSION = 1;
export const DEFAULT_LEGACY_CATALOG_RESPONSE_BYTES = 2 * 1024 * 1024;

const ALLOWED_MODES = new Set([
  'themes',
  'products',
  'items',
  'search',
  'globalSearch',
  'folderSearch'
]);

const ALLOWED_QUERY_KEYS = new Set([
  'folderId',
  'theme',
  'product',
  'q',
  'code',
  'imageId'
]);

export function legacyCatalogBridgeStatus(input = {}) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const rootDriveId = identity(input.rootDriveId);
  return deepFreeze({
    enabled: input.enabled === true || input.enabled === 'true',
    configured: Boolean(baseUrl && rootDriveId),
    mode: 'legacy-public-readonly',
    target: baseUrl ? new URL(baseUrl).hostname : '',
    rootConfigured: Boolean(rootDriveId)
  });
}

export async function fetchLegacyCatalogBridge(input = {}) {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw bridgeError('LEGACY_CATALOG_BASE_URL_INVALID');

  const rootDriveId = identity(input.rootDriveId);
  if (!rootDriveId) throw bridgeError('ROOT_DRIVE_ID_REQUIRED');

  const mode = normalizeMode(input.mode);
  const query = sanitizeQuery(input.query, mode);
  const fetchImpl = input.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw bridgeError('LEGACY_CATALOG_FETCH_REQUIRED');

  const timeoutMs = boundedInteger(input.timeoutMs, 250, 15_000, 5_000);
  const maxResponseBytes = boundedInteger(
    input.maxResponseBytes,
    1_024,
    8 * 1024 * 1024,
    DEFAULT_LEGACY_CATALOG_RESPONSE_BYTES
  );

  const driveUrl = new URL('/api/drive', baseUrl);
  driveUrl.searchParams.set('mode', mode);
  for (const [key, value] of Object.entries(query)) driveUrl.searchParams.set(key, value);

  const metadataUrl = new URL('/api/catalog-meta', baseUrl);
  const [legacyPayload, metadataPayload] = await Promise.all([
    fetchJson(driveUrl, { fetchImpl, timeoutMs, maxResponseBytes }),
    fetchJson(metadataUrl, {
      fetchImpl,
      timeoutMs,
      maxResponseBytes: Math.min(maxResponseBytes, 128 * 1024)
    })
  ]);

  if (!legacyPayload || legacyPayload.ok !== true) {
    throw bridgeError('LEGACY_CATALOG_RESPONSE_INVALID');
  }
  if (!metadataPayload || metadataPayload.ok !== true) {
    throw bridgeError('LEGACY_CATALOG_METADATA_INVALID');
  }

  const catalogVersion = positiveInteger(
    metadataPayload.catalogVersion || legacyPayload.configVersion || input.catalogVersion
  );
  if (!catalogVersion) throw bridgeError('CATALOG_VERSION_REQUIRED');

  const productKey = clean(input.productKey || '50x50');
  const productName = clean(input.productName || legacyPayload.productName || 'Bolinhas 50x50');
  const context = createCatalogContext({
    catalogVersion,
    roots: [{
      rootDriveId,
      driveId: clean(input.driveId || 'legacy-public-catalog'),
      productKey,
      productName,
      structure: clean(input.structure || 'theme-or-subtheme-images'),
      active: true
    }]
  });

  const rows = legacyPayloadToRows(legacyPayload, {
    mode,
    query,
    rootDriveId,
    productKey,
    productName
  });

  const v2 = buildCatalogResponseV2({
    context,
    rootDriveId,
    rows,
    strict: false
  });

  const legacyComparable = rowsToLegacyComparable(rows, catalogVersion);
  const comparison = compareCatalogShadow({
    legacy: legacyComparable,
    v2,
    maxDetails: input.maxComparisonDetails
  });

  return deepFreeze({
    ok: v2.rejectedCount === 0 && comparison.equivalent,
    schemaVersion: LEGACY_CATALOG_BRIDGE_SCHEMA_VERSION,
    readOnly: true,
    source: 'legacy-public-api',
    mode,
    catalogVersion,
    rootDriveId,
    upstream: {
      source: clean(legacyPayload.source || 'public-api'),
      folderCount: legacyComparable.folders.length,
      artworkCount: legacyComparable.items.length
    },
    v2,
    comparison
  });
}

export function legacyPayloadToRows(payload = {}, options = {}) {
  const rootDriveId = identity(options.rootDriveId);
  if (!rootDriveId) throw bridgeError('ROOT_DRIVE_ID_REQUIRED');

  const productKey = clean(options.productKey || '50x50');
  const productName = clean(options.productName || payload.productName || 'Bolinhas 50x50');
  const fallbackParentId = identity(options.query?.folderId) || rootDriveId;
  const folders = collectFolders(payload);
  const artworks = collectArtworks(payload);
  const rows = [];

  for (const folder of folders) {
    const driveId = identity(folder?.id || folder?.driveId || folder?.drive_id);
    if (!driveId) continue;
    rows.push({
      drive_id: driveId,
      parent_drive_id: identity(folder.parentId || folder.parent_drive_id) || fallbackParentId,
      root_drive_id: rootDriveId,
      type: 'folder',
      name: clean(folder.name || folder.label || folder.productName || 'Pasta'),
      path: clean(folder.path),
      depth: nonNegativeInteger(folder.depth),
      theme: clean(folder.theme || options.query?.theme),
      subtheme: clean(folder.subtheme),
      product: productKey,
      product_name: productName,
      deleted_at: null
    });
  }

  for (const artwork of artworks) {
    const driveId = identity(artwork?.driveFileId || artwork?.id || artwork?.drive_id);
    if (!driveId) continue;
    rows.push({
      drive_id: driveId,
      parent_drive_id: identity(
        artwork.parentDriveId ||
        artwork.parentId ||
        artwork.themeId ||
        artwork.productFolderId
      ) || fallbackParentId,
      root_drive_id: rootDriveId,
      type: 'artwork',
      name: clean(artwork.originalName || artwork.name || artwork.code),
      mime_type: clean(artwork.mimeType || artwork.mime_type || 'image/*'),
      path: clean(artwork.path),
      theme: clean(artwork.theme || options.query?.theme || 'Sem tema'),
      subtheme: clean(artwork.subtheme),
      product: productKey,
      product_name: productName,
      size: clean(artwork.sizeKey || artwork.size || artwork.dimension || 'default'),
      code: cleanCode(artwork.code),
      drive_url: clean(artwork.driveUrl || artwork.drive_url),
      thumbnail_url: clean(artwork.image || artwork.thumbnail || artwork.thumbnail_url),
      indexed_at: clean(artwork.indexedAt || artwork.indexed_at),
      deleted_at: null
    });
  }

  return deepFreeze(dedupeRows(rows));
}

function collectFolders(payload) {
  const candidates = [
    payload.folders,
    payload.results,
    payload.themes,
    payload.products
  ];
  return candidates.find(Array.isArray) || [];
}

function collectArtworks(payload) {
  const candidates = [payload.items, payload.artworks];
  return candidates.find(Array.isArray) || [];
}

function rowsToLegacyComparable(rows, catalogVersion) {
  const folders = [];
  const items = [];

  for (const row of rows) {
    if (row.type === 'folder') {
      folders.push({
        id: row.drive_id,
        parentId: row.parent_drive_id,
        rootDriveId: row.root_drive_id,
        name: row.name,
        theme: row.theme,
        product: row.product,
        kind: 'folder'
      });
      continue;
    }

    if (row.type === 'artwork') {
      items.push({
        driveFileId: row.drive_id,
        code: row.code,
        theme: row.theme || 'Sem tema',
        subtheme: row.subtheme,
        product: row.product,
        size: row.size || 'default',
        image: row.thumbnail_url
      });
    }
  }

  return deepFreeze({ catalogVersion, folders, items });
}

function sanitizeQuery(value, mode) {
  const source = value instanceof URLSearchParams
    ? Object.fromEntries(value.entries())
    : isRecord(value) ? value : {};
  const output = {};

  for (const [key, raw] of Object.entries(source)) {
    if (!ALLOWED_QUERY_KEYS.has(key)) continue;
    const maxLength = key === 'q' ? 120 : 500;
    const text = clean(raw).slice(0, maxLength);
    if (text) output[key] = text;
  }

  if (mode === 'themes') return {};
  return deepFreeze(output);
}

function normalizeMode(value) {
  const mode = clean(value || 'themes');
  if (!ALLOWED_MODES.has(mode)) throw bridgeError('LEGACY_CATALOG_MODE_INVALID');
  return mode;
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await Reflect.apply(options.fetchImpl, globalThis, [url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store'
      },
      redirect: 'error',
      signal: controller.signal
    }]);

    if (!response || !response.ok) {
      const error = bridgeError(`LEGACY_CATALOG_HTTP_${Number(response?.status || 0)}`);
      error.status = Number(response?.status || 0);
      throw error;
    }

    const contentType = clean(response.headers?.get?.('content-type')).toLowerCase();
    if (contentType && !contentType.includes('application/json')) {
      throw bridgeError('LEGACY_CATALOG_CONTENT_TYPE_INVALID');
    }

    const text = await readLimitedResponseText(response, options.maxResponseBytes);
    try {
      const payload = JSON.parse(text);
      if (!isRecord(payload)) throw new Error('NOT_OBJECT');
      return payload;
    } catch (_) {
      throw bridgeError('LEGACY_CATALOG_JSON_INVALID');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw bridgeError('LEGACY_CATALOG_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedResponseText(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers?.get?.('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw bridgeError('LEGACY_CATALOG_RESPONSE_TOO_LARGE');
  }

  if (!response.body?.getReader) {
    const text = await response.text().catch(() => '');
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw bridgeError('LEGACY_CATALOG_RESPONSE_TOO_LARGE');
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
        await reader.cancel('LEGACY_CATALOG_RESPONSE_TOO_LARGE').catch(() => {});
        throw bridgeError('LEGACY_CATALOG_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function normalizeBaseUrl(value) {
  const text = clean(value).replace(/\/+$/, '');
  if (!text) return '';
  try {
    const url = new URL(text);
    const pathAllowed = !url.pathname || url.pathname === '/';
    const cleanAuthority = !url.username && !url.password && !url.search && !url.hash;
    if (url.protocol !== 'https:' || !pathAllowed || !cleanAuthority) return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function dedupeRows(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = `${row.type}:${row.drive_id}`;
    if (!row.drive_id || seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function cleanCode(value) {
  return String(value ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function identity(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bridgeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
