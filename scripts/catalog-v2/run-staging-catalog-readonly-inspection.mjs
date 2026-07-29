import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

export async function runCatalogReadonlyInspection(options = {}) {
  const stagingUrl = normalizeHttpsOrigin(options.stagingUrl, 'STAGING_URL_INVALID');
  const legacyBaseUrl = normalizeHttpsOrigin(options.legacyBaseUrl, 'CATALOG_LEGACY_BASE_URL_INVALID');
  const token = String(options.token || '').trim();
  const reportPath = String(options.reportPath || '').trim();
  const fetchImpl = options.fetch || globalThis.fetch;
  if (token.length < 32) throw inspectionError('STAGING_API_TOKEN_MISSING_OR_SHORT');
  if (!reportPath) throw inspectionError('CATALOG_REPORT_FILE_REQUIRED');
  if (typeof fetchImpl !== 'function') throw inspectionError('FETCH_REQUIRED');

  const limits = {
    requests: boundedInteger(options.maxRequests, 20, 4000, 1600),
    folders: boundedInteger(options.maxFolders, 10, 2000, 800),
    artworks: boundedInteger(options.maxArtworks, 100, 250000, 100000),
    responseBytes: boundedInteger(options.maxResponseBytes, 1024, 8 * 1024 * 1024, DEFAULT_MAX_RESPONSE_BYTES),
    timeoutMs: boundedInteger(options.timeoutMs, 1000, 30000, 15000)
  };

  const state = {
    requestCount: 0,
    themeCount: 0,
    folderCount: 0,
    productCount: 0,
    artworkCount: 0,
    rejectedCount: 0,
    differenceCount: 0,
    catalogVersion: 0,
    traversalComplete: false
  };

  try {
    state.requestCount += 1;
    const health = await requestJson(new URL('/health', stagingUrl), {
      fetchImpl,
      timeoutMs: limits.timeoutMs,
      maxResponseBytes: 256 * 1024
    });
    const bridge = health?.catalogReadonlyBridge;
    if (!health?.ok || bridge?.enabled !== true || bridge?.configured !== true) {
      throw inspectionError('CATALOG_BRIDGE_NOT_ACTIVE_AND_CONFIGURED');
    }

    const requestPair = async (mode, query = {}) => {
      state.requestCount += 2;
      if (state.requestCount > limits.requests) throw inspectionError('CATALOG_REQUEST_LIMIT_REACHED');

      const previewUrl = new URL('/internal/v2/catalog/preview', stagingUrl);
      previewUrl.searchParams.set('mode', mode);
      const legacyUrl = new URL('/api/drive', legacyBaseUrl);
      legacyUrl.searchParams.set('mode', mode);
      for (const [key, value] of Object.entries(query)) {
        const text = String(value || '').trim();
        if (!text) continue;
        previewUrl.searchParams.set(key, text);
        legacyUrl.searchParams.set(key, text);
      }

      const [payload, legacy] = await Promise.all([
        requestJson(previewUrl, {
          fetchImpl,
          timeoutMs: limits.timeoutMs,
          maxResponseBytes: limits.responseBytes,
          headers: { 'x-staging-token': token }
        }),
        requestJson(legacyUrl, {
          fetchImpl,
          timeoutMs: limits.timeoutMs,
          maxResponseBytes: limits.responseBytes
        })
      ]);

      if (!legacy?.ok) throw inspectionError(publicCode(legacy?.error, 'LEGACY_CATALOG_DIRECT_READ_FAILED'));
      validatePreview(payload, state);

      const directFolders = uniqueRawFolders(legacy);
      const directArtworks = uniqueRawArtworks(legacy);
      const upstreamFolders = Number(payload?.upstream?.folderCount || 0);
      const upstreamArtworks = Number(payload?.upstream?.artworkCount || 0);
      if (upstreamFolders !== directFolders.length || upstreamArtworks !== directArtworks.length) {
        throw inspectionError('CATALOG_UPSTREAM_COUNT_MISMATCH');
      }

      return { payload, legacy, directFolders, directArtworks };
    };

    const themes = await requestPair('themes');
    state.themeCount = themes.directFolders.length;
    if (!state.themeCount) throw inspectionError('CATALOG_THEMES_EMPTY');

    const queue = themes.directFolders.map(folder => rawIdentity(folder));
    const visitedFolders = new Set();
    const visitedProducts = new Set();
    const artworkIds = new Set();

    while (queue.length) {
      const folderId = String(queue.shift() || '').trim();
      if (!folderId || visitedFolders.has(folderId)) continue;
      visitedFolders.add(folderId);
      if (visitedFolders.size > limits.folders) throw inspectionError('CATALOG_FOLDER_LIMIT_REACHED');

      const products = await requestPair('products', { folderId });
      for (const folder of products.directFolders) {
        const id = rawIdentity(folder);
        if (!id) continue;
        if (isRawProductFolder(folder, id)) {
          if (visitedProducts.has(id)) continue;
          visitedProducts.add(id);
          const items = await requestPair('items', { folderId: id, product: '50x50' });
          for (const artwork of items.directArtworks) {
            const artworkId = rawArtworkIdentity(artwork);
            if (artworkId) artworkIds.add(artworkId);
            if (artworkIds.size > limits.artworks) throw inspectionError('CATALOG_ARTWORK_LIMIT_REACHED');
          }
          continue;
        }
        if (!visitedFolders.has(id)) queue.push(id);
      }
    }

    state.folderCount = visitedFolders.size;
    state.productCount = visitedProducts.size;
    state.artworkCount = artworkIds.size;
    state.traversalComplete = queue.length === 0;

    if (!state.productCount) throw inspectionError('CATALOG_PRODUCTS_EMPTY');
    if (!state.artworkCount) throw inspectionError('CATALOG_ARTWORKS_EMPTY');
    if (!state.traversalComplete) throw inspectionError('CATALOG_TRAVERSAL_INCOMPLETE');

    const report = sanitizeReport({
      ok: true,
      generatedAt: new Date().toISOString(),
      bridgeActiveDuringInspection: true,
      ...state
    });
    await writePrivateReport(reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  } catch (error) {
    const report = sanitizeReport({
      ok: false,
      generatedAt: new Date().toISOString(),
      bridgeActiveDuringInspection: true,
      error: publicCode(error?.code || error?.message, 'CATALOG_INSPECTION_FAILED'),
      ...state
    });
    await writePrivateReport(reportPath, report).catch(() => {});
    throw inspectionError(report.error);
  }
}

function validatePreview(payload, state) {
  if (!payload || typeof payload !== 'object') throw inspectionError('CATALOG_PREVIEW_INVALID');
  const rejected = Number(payload?.v2?.rejectedCount || 0);
  const differences = Number(payload?.comparison?.totalDifferences || 0);
  state.rejectedCount += Number.isFinite(rejected) ? rejected : 0;
  state.differenceCount += Number.isFinite(differences) ? differences : 0;

  if (rejected > 0) throw inspectionError('CATALOG_ROWS_REJECTED');
  if (differences > 0 || payload?.comparison?.equivalent !== true) {
    throw inspectionError('CATALOG_SHADOW_DIFFERENCE_FOUND');
  }
  if (!payload.ok) throw inspectionError(publicCode(payload?.error, 'CATALOG_PREVIEW_FAILED'));
  if (payload.readOnly !== true || payload.source !== 'legacy-public-api') {
    throw inspectionError('CATALOG_PREVIEW_NOT_READ_ONLY');
  }

  const version = Number(payload?.catalogVersion || payload?.v2?.catalogVersion || 0);
  if (Number.isInteger(version) && version > 0) {
    if (state.catalogVersion && state.catalogVersion !== version) {
      throw inspectionError('CATALOG_VERSION_CHANGED_DURING_INSPECTION');
    }
    state.catalogVersion = version;
  }
}

function uniqueRawFolders(payload) {
  const candidates = [payload?.folders, payload?.results, payload?.themes, payload?.products];
  const rows = candidates.find(Array.isArray) || [];
  const map = new Map();
  for (const row of rows) {
    const id = rawIdentity(row);
    if (id && !map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function uniqueRawArtworks(payload) {
  const candidates = [payload?.items, payload?.artworks];
  const rows = candidates.find(Array.isArray) || [];
  const map = new Map();
  for (const row of rows) {
    const id = rawArtworkIdentity(row);
    if (id && !map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function rawIdentity(value) {
  return String(value?.id || value?.driveId || value?.drive_id || '').trim();
}

function rawArtworkIdentity(value) {
  return String(value?.driveFileId || value?.id || value?.drive_id || '').trim();
}

function isRawProductFolder(folder, id) {
  return folder?.kind === 'product' ||
    folder?.directItems === true ||
    id.startsWith('catalog-index-product:');
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await Reflect.apply(options.fetchImpl, globalThis, [url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    }]);
    const body = await readLimitedText(response, options.maxResponseBytes);
    if (!response.ok) {
      let payload;
      try { payload = JSON.parse(body); } catch (_) { payload = null; }
      throw inspectionError(publicCode(payload?.error, `CATALOG_HTTP_${response.status}`));
    }
    try {
      return JSON.parse(body);
    } catch (_) {
      throw inspectionError('CATALOG_RESPONSE_NOT_JSON');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw inspectionError('CATALOG_REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw inspectionError('CATALOG_RESPONSE_TOO_LARGE');
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
        await reader.cancel('CATALOG_RESPONSE_TOO_LARGE').catch(() => {});
        throw inspectionError('CATALOG_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function sanitizeReport(input) {
  return Object.freeze({
    ok: input.ok === true,
    generatedAt: validIso(input.generatedAt),
    bridgeActiveDuringInspection: input.bridgeActiveDuringInspection === true,
    requestCount: nonNegativeInteger(input.requestCount),
    themeCount: nonNegativeInteger(input.themeCount),
    folderCount: nonNegativeInteger(input.folderCount),
    productCount: nonNegativeInteger(input.productCount),
    artworkCount: nonNegativeInteger(input.artworkCount),
    rejectedCount: nonNegativeInteger(input.rejectedCount),
    differenceCount: nonNegativeInteger(input.differenceCount),
    catalogVersion: nonNegativeInteger(input.catalogVersion),
    traversalComplete: input.traversalComplete === true,
    error: input.ok === true ? '' : publicCode(input.error, 'CATALOG_INSPECTION_FAILED')
  });
}

async function writePrivateReport(path, report) {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function normalizeHttpsOrigin(value, errorCode) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) {
    throw inspectionError(errorCode);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw inspectionError(errorCode);
  }
  return url.origin;
}

function publicCode(value, fallback) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function validIso(value) {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function inspectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  await runCatalogReadonlyInspection({
    stagingUrl: process.env.STAGING_URL,
    legacyBaseUrl: process.env.CATALOG_LEGACY_BASE_URL,
    token: process.env.SITE_V2_STAGING_API_TOKEN,
    reportPath: process.env.CATALOG_REPORT_FILE,
    maxRequests: process.env.CATALOG_INSPECTION_MAX_REQUESTS,
    maxFolders: process.env.CATALOG_INSPECTION_MAX_FOLDERS,
    maxArtworks: process.env.CATALOG_INSPECTION_MAX_ARTWORKS
  });
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    console.error(publicCode(error?.code || error?.message, 'CATALOG_INSPECTION_FAILED'));
    process.exitCode = 1;
  });
}
