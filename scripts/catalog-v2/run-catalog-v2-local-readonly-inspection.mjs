import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { legacyPayloadToRows } from '../../src/v2/catalog/legacy-readonly-bridge.mjs';
import { buildCatalogResponseV2, createCatalogContext } from '../../src/v2/catalog/schema.mjs';
import { compareCatalogShadow } from '../../src/v2/catalog/shadow-compare.mjs';

const DEFAULT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

export async function runCatalogV2LocalReadonlyInspection(options = {}) {
  const legacyBaseUrl = normalizeHttpsOrigin(options.legacyBaseUrl);
  const rootDriveId = cleanIdentity(options.rootDriveId);
  const reportPath = String(options.reportPath || '').trim();
  const fetchImpl = options.fetch || globalThis.fetch;

  if (!rootDriveId) throw inspectionError('CATALOG_V2_ROOT_DRIVE_ID_INVALID');
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
    traversalComplete: false,
    rejectionCodes: new Map(),
    differenceFields: new Map()
  };

  try {
    const metadata = await requestLegacyJson('/api/catalog-meta', {}, {
      legacyBaseUrl,
      fetchImpl,
      limits,
      state,
      maxResponseBytes: 128 * 1024
    });
    if (!metadata?.ok) throw inspectionError('LEGACY_CATALOG_METADATA_INVALID');

    const catalogVersion = positiveInteger(metadata.catalogVersion);
    if (!catalogVersion) throw inspectionError('CATALOG_VERSION_REQUIRED');
    state.catalogVersion = catalogVersion;

    const productKey = '50x50';
    const productName = 'Bolinhas 50x50';
    const context = createCatalogContext({
      catalogVersion,
      roots: [{
        rootDriveId,
        driveId: 'legacy-public-catalog',
        productKey,
        productName,
        structure: 'theme-or-subtheme-images',
        active: true
      }]
    });

    const inspect = async (mode, query = {}) => {
      const legacy = await requestLegacyJson('/api/drive', { mode, ...query }, {
        legacyBaseUrl,
        fetchImpl,
        limits,
        state
      });
      if (!legacy?.ok) throw inspectionError(publicCode(legacy?.error, 'LEGACY_CATALOG_RESPONSE_INVALID'));

      const rows = legacyPayloadToRows(legacy, {
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
      const comparable = rowsToLegacyComparable(rows, catalogVersion);
      const comparison = compareCatalogShadow({
        legacy: comparable,
        v2,
        maxDetails: 50
      });

      state.rejectedCount += v2.rejectedCount;
      state.differenceCount += comparison.totalDifferences;
      aggregateRejections(state.rejectionCodes, v2.rejected);
      aggregateDifferences(state.differenceFields, comparison.summary);

      if (v2.rejectedCount > 0) throw inspectionError('CATALOG_ROWS_REJECTED');
      if (!comparison.equivalent || comparison.totalDifferences > 0) {
        throw inspectionError('CATALOG_SHADOW_DIFFERENCE_FOUND');
      }

      const folders = uniqueRawFolders(legacy);
      const artworks = uniqueRawArtworks(legacy);
      if (folders.length !== v2.folders.length || artworks.length !== v2.artworks.length) {
        throw inspectionError('CATALOG_NORMALIZED_COUNT_MISMATCH');
      }

      return { legacy, folders, artworks };
    };

    const themes = await inspect('themes');
    state.themeCount = themes.folders.length;
    if (!state.themeCount) throw inspectionError('CATALOG_THEMES_EMPTY');

    const queue = themes.folders.map(folder => rawIdentity(folder));
    const visitedFolders = new Set();
    const visitedProducts = new Set();
    const artworkIds = new Set();

    while (queue.length) {
      const folderId = String(queue.shift() || '').trim();
      if (!folderId || visitedFolders.has(folderId)) continue;
      visitedFolders.add(folderId);
      if (visitedFolders.size > limits.folders) throw inspectionError('CATALOG_FOLDER_LIMIT_REACHED');

      const products = await inspect('products', { folderId });
      for (const folder of products.folders) {
        const id = rawIdentity(folder);
        if (!id) continue;

        if (isRawProductFolder(folder, id)) {
          if (visitedProducts.has(id)) continue;
          visitedProducts.add(id);
          const items = await inspect('items', { folderId: id, product: productKey });
          for (const artwork of items.artworks) {
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
      executionMode: 'github-actions-local-contract',
      ...state
    });
    await writePrivateReport(reportPath, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  } catch (error) {
    const report = sanitizeReport({
      ok: false,
      generatedAt: new Date().toISOString(),
      executionMode: 'github-actions-local-contract',
      error: publicCode(error?.code || error?.message, 'CATALOG_INSPECTION_FAILED'),
      ...state
    });
    await writePrivateReport(reportPath, report).catch(() => {});
    throw inspectionError(report.error);
  }
}

async function requestLegacyJson(path, query, options) {
  options.state.requestCount += 1;
  if (options.state.requestCount > options.limits.requests) {
    throw inspectionError('CATALOG_REQUEST_LIMIT_REACHED');
  }

  const url = new URL(path, options.legacyBaseUrl);
  for (const [key, value] of Object.entries(query || {})) {
    const text = String(value || '').trim();
    if (text) url.searchParams.set(key, text);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.limits.timeoutMs);
  try {
    const response = await Reflect.apply(options.fetchImpl, globalThis, [url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store'
      }
    }]);
    if (!response.ok) throw inspectionError(`LEGACY_CATALOG_HTTP_${response.status}`);
    const text = await readLimitedText(
      response,
      options.maxResponseBytes || options.limits.responseBytes
    );
    try {
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('NOT_OBJECT');
      }
      return payload;
    } catch (_) {
      throw inspectionError('LEGACY_CATALOG_JSON_INVALID');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw inspectionError('LEGACY_CATALOG_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
  return { catalogVersion, folders, items };
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

function aggregateRejections(target, rejected) {
  for (const item of Array.isArray(rejected) ? rejected : []) {
    const code = publicCode(item?.error, 'CATALOG_ROW_INVALID');
    target.set(code, (target.get(code) || 0) + 1);
  }
}

function aggregateDifferences(target, summary) {
  for (const [key, value] of Object.entries(summary || {})) {
    if (['legacyFolders', 'v2Folders', 'legacyArtworks', 'v2Artworks', 'detailLimit'].includes(key)) continue;
    const count = nonNegativeInteger(value);
    if (count > 0) target.set(cleanSummaryKey(key), (target.get(cleanSummaryKey(key)) || 0) + count);
  }
}

function sanitizeReport(input) {
  return Object.freeze({
    ok: input.ok === true,
    generatedAt: validIso(input.generatedAt),
    executionMode: input.executionMode === 'github-actions-local-contract'
      ? 'github-actions-local-contract'
      : 'unknown',
    requestCount: nonNegativeInteger(input.requestCount),
    themeCount: nonNegativeInteger(input.themeCount),
    folderCount: nonNegativeInteger(input.folderCount),
    productCount: nonNegativeInteger(input.productCount),
    artworkCount: nonNegativeInteger(input.artworkCount),
    rejectedCount: nonNegativeInteger(input.rejectedCount),
    differenceCount: nonNegativeInteger(input.differenceCount),
    catalogVersion: nonNegativeInteger(input.catalogVersion),
    traversalComplete: input.traversalComplete === true,
    rejectionSummary: mapSummary(input.rejectionCodes),
    differenceSummary: mapSummary(input.differenceFields),
    error: input.ok === true ? '' : publicCode(input.error, 'CATALOG_INSPECTION_FAILED')
  });
}

function mapSummary(value) {
  if (!(value instanceof Map)) return [];
  return [...value.entries()]
    .filter(([key, count]) => /^[A-Z0-9_]{3,100}$/.test(key) && nonNegativeInteger(count) > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 20)
    .map(([code, count]) => ({ code, count: nonNegativeInteger(count) }));
}

async function readLimitedText(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw inspectionError('LEGACY_CATALOG_RESPONSE_TOO_LARGE');
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
        await reader.cancel('LEGACY_CATALOG_RESPONSE_TOO_LARGE').catch(() => {});
        throw inspectionError('LEGACY_CATALOG_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

async function writePrivateReport(path, report) {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

function normalizeHttpsOrigin(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (_) {
    throw inspectionError('CATALOG_LEGACY_BASE_URL_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw inspectionError('CATALOG_LEGACY_BASE_URL_INVALID');
  }
  return url.origin;
}

function cleanIdentity(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '');
}

function cleanSummaryKey(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
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

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
  await runCatalogV2LocalReadonlyInspection({
    legacyBaseUrl: process.env.CATALOG_LEGACY_BASE_URL,
    rootDriveId: process.env.CATALOG_V2_ROOT_DRIVE_ID,
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
