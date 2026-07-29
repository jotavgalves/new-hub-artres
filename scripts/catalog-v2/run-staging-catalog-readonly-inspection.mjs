import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

export async function runCatalogReadonlyInspection(options = {}) {
  const stagingUrl = normalizeHttpsOrigin(options.stagingUrl);
  const token = String(options.token || '').trim();
  const reportPath = String(options.reportPath || '').trim();
  const fetchImpl = options.fetch || globalThis.fetch;
  if (token.length < 32) throw inspectionError('STAGING_API_TOKEN_MISSING_OR_SHORT');
  if (!reportPath) throw inspectionError('CATALOG_REPORT_FILE_REQUIRED');
  if (typeof fetchImpl !== 'function') throw inspectionError('FETCH_REQUIRED');

  const limits = {
    requests: boundedInteger(options.maxRequests, 10, 2000, 800),
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
    const health = await requestJson(new URL('/health', stagingUrl), {
      fetchImpl,
      timeoutMs: limits.timeoutMs,
      maxResponseBytes: 256 * 1024
    });
    const bridge = health?.catalogReadonlyBridge;
    if (!health?.ok || bridge?.enabled !== true || bridge?.configured !== true) {
      throw inspectionError('CATALOG_BRIDGE_NOT_ACTIVE_AND_CONFIGURED');
    }

    const requestPreview = async (mode, query = {}) => {
      state.requestCount += 1;
      if (state.requestCount > limits.requests) throw inspectionError('CATALOG_REQUEST_LIMIT_REACHED');
      const url = new URL('/internal/v2/catalog/preview', stagingUrl);
      url.searchParams.set('mode', mode);
      for (const [key, value] of Object.entries(query)) {
        const text = String(value || '').trim();
        if (text) url.searchParams.set(key, text);
      }
      const payload = await requestJson(url, {
        fetchImpl,
        timeoutMs: limits.timeoutMs,
        maxResponseBytes: limits.responseBytes,
        headers: { 'x-staging-token': token }
      });
      if (!payload?.ok) throw inspectionError(publicCode(payload?.error, 'CATALOG_PREVIEW_FAILED'));
      if (payload?.readOnly !== true || payload?.source !== 'legacy-public-api') {
        throw inspectionError('CATALOG_PREVIEW_NOT_READ_ONLY');
      }
      const rejected = Number(payload?.v2?.rejectedCount || 0);
      const differences = Number(payload?.comparison?.totalDifferences || 0);
      state.rejectedCount += Number.isFinite(rejected) ? rejected : 0;
      state.differenceCount += Number.isFinite(differences) ? differences : 0;
      if (rejected > 0) throw inspectionError('CATALOG_ROWS_REJECTED');
      if (differences > 0 || payload?.comparison?.equivalent !== true) {
        throw inspectionError('CATALOG_SHADOW_DIFFERENCE_FOUND');
      }
      const version = Number(payload?.catalogVersion || payload?.v2?.catalogVersion || 0);
      if (Number.isInteger(version) && version > 0) {
        if (state.catalogVersion && state.catalogVersion !== version) {
          throw inspectionError('CATALOG_VERSION_CHANGED_DURING_INSPECTION');
        }
        state.catalogVersion = version;
      }
      return payload;
    };

    const themes = await requestPreview('themes');
    const themeFolders = uniqueFolders(themes?.v2?.folders);
    state.themeCount = themeFolders.length;
    if (!state.themeCount) throw inspectionError('CATALOG_THEMES_EMPTY');

    const queue = themeFolders.map(folder => folder.id);
    const visitedFolders = new Set();
    const visitedProducts = new Set();
    const artworkIds = new Set();

    while (queue.length) {
      const folderId = String(queue.shift() || '').trim();
      if (!folderId || visitedFolders.has(folderId)) continue;
      visitedFolders.add(folderId);
      if (visitedFolders.size > limits.folders) throw inspectionError('CATALOG_FOLDER_LIMIT_REACHED');

      const products = await requestPreview('products', { folderId });
      for (const folder of uniqueFolders(products?.v2?.folders)) {
        const id = String(folder.id || '').trim();
        if (!id) continue;
        if (id.startsWith('catalog-index-product:')) {
          if (visitedProducts.has(id)) continue;
          visitedProducts.add(id);
          const items = await requestPreview('items', { folderId: id, product: '50x50' });
          for (const artwork of Array.isArray(items?.v2?.artworks) ? items.v2.artworks : []) {
            const artworkId = String(artwork?.id || artwork?.driveFileId || '').trim();
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

function uniqueFolders(value) {
  const map = new Map();
  for (const folder of Array.isArray(value) ? value : []) {
    const id = String(folder?.id || '').trim();
    if (id && !map.has(id)) map.set(id, folder);
  }
  return [...map.values()];
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

function normalizeHttpsOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) {
    throw inspectionError('STAGING_URL_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw inspectionError('STAGING_URL_INVALID');
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
