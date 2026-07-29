import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { legacyPayloadToRows } from '../../src/v2/catalog/legacy-readonly-bridge.mjs';
import { buildCatalogResponseV2, createCatalogContext } from '../../src/v2/catalog/schema.mjs';
import { compareCatalogShadow } from '../../src/v2/catalog/shadow-compare.mjs';

const DEFAULT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024;
const DEFAULT_BATCH_BYTES = 1_500_000;

export async function publishAcceptedCatalogV2(options = {}) {
  const legacyBaseUrl = normalizeHttpsOrigin(options.legacyBaseUrl, 'CATALOG_LEGACY_BASE_URL_INVALID');
  const supabaseUrl = normalizeHttpsOrigin(options.supabaseUrl, 'SUPABASE_V2_URL_INVALID');
  const rootDriveId = cleanIdentity(options.rootDriveId);
  const serviceRoleKey = String(options.serviceRoleKey || '').trim();
  const reportPath = String(options.reportPath || '').trim();
  const fetchImpl = options.fetch || globalThis.fetch;
  const force = options.force === true || options.force === 'true';

  if (!rootDriveId) throw catalogError('CATALOG_V2_ROOT_DRIVE_ID_INVALID');
  if (serviceRoleKey.length < 32) throw catalogError('SUPABASE_V2_SERVICE_ROLE_KEY_MISSING_OR_SHORT');
  if (!reportPath) throw catalogError('CATALOG_REPORT_FILE_REQUIRED');
  if (typeof fetchImpl !== 'function') throw catalogError('FETCH_REQUIRED');

  const limits = {
    requests: boundedInteger(options.maxRequests, 10, 4000, 2000),
    folders: boundedInteger(options.maxFolders, 10, 4000, 2000),
    artworks: boundedInteger(options.maxArtworks, 100, 250000, 100000),
    responseBytes: boundedInteger(options.maxResponseBytes, 1024, 8 * 1024 * 1024, DEFAULT_MAX_RESPONSE_BYTES),
    timeoutMs: boundedInteger(options.timeoutMs, 1000, 30000, 15000),
    batchBytes: boundedInteger(options.batchBytes, 100_000, 4_000_000, DEFAULT_BATCH_BYTES)
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
    routeCount: 0,
    fingerprint: '',
    action: '',
    rejectionCodes: new Map(),
    differenceFields: new Map()
  };

  try {
    const acceptedBefore = await supabaseRpc('armazem_v2_catalog_status_v1', {}, {
      supabaseUrl,
      serviceRoleKey,
      fetchImpl,
      timeoutMs: limits.timeoutMs,
      maxResponseBytes: 256 * 1024
    });

    const metadata = await requestLegacyJson('/api/catalog-meta', {}, {
      legacyBaseUrl,
      fetchImpl,
      limits,
      state,
      maxResponseBytes: 128 * 1024
    });
    if (!metadata?.ok) throw catalogError('LEGACY_CATALOG_METADATA_INVALID');

    const catalogVersion = positiveInteger(metadata.catalogVersion);
    if (!catalogVersion) throw catalogError('CATALOG_VERSION_REQUIRED');
    state.catalogVersion = catalogVersion;

    if (!force && acceptedBefore?.configured === true && Number(acceptedBefore.catalogVersion) === catalogVersion) {
      state.action = 'UNCHANGED';
      state.traversalComplete = true;
      state.routeCount = nonNegativeInteger(acceptedBefore.routeCount);
      state.folderCount = nonNegativeInteger(acceptedBefore.folderCount);
      state.artworkCount = nonNegativeInteger(acceptedBefore.itemCount);
      state.fingerprint = safeFingerprint(acceptedBefore.fingerprint);
      const report = sanitizeReport({
        ok: true,
        generatedAt: new Date().toISOString(),
        executionMode: 'github-actions-auto-accept',
        accepted: true,
        changed: false,
        ...state
      });
      await writePrivateReport(reportPath, report);
      await writeGithubOutput(report);
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return report;
    }

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

    const routes = new Map();
    const folders = new Map();
    const items = new Map();

    const inspect = async (mode, query = {}) => {
      const legacy = await requestLegacyJson('/api/drive', { mode, ...query }, {
        legacyBaseUrl,
        fetchImpl,
        limits,
        state
      });
      if (!legacy?.ok) throw catalogError(publicCode(legacy?.error, 'LEGACY_CATALOG_RESPONSE_INVALID'));

      const rows = legacyPayloadToRows(legacy, {
        mode,
        query,
        rootDriveId,
        productKey,
        productName
      });
      const v2 = buildCatalogResponseV2({ context, rootDriveId, rows, strict: false });
      const comparison = compareCatalogShadow({
        legacy: rowsToLegacyComparable(rows, catalogVersion),
        v2,
        maxDetails: 50
      });

      state.rejectedCount += nonNegativeInteger(v2.rejectedCount);
      state.differenceCount += nonNegativeInteger(comparison.totalDifferences);
      aggregateRejections(state.rejectionCodes, v2.rejected);
      aggregateDifferences(state.differenceFields, comparison.summary);

      if (v2.rejectedCount > 0) throw catalogError('CATALOG_ROWS_REJECTED');
      if (!comparison.equivalent || comparison.totalDifferences > 0) {
        throw catalogError('CATALOG_SHADOW_DIFFERENCE_FOUND');
      }

      const rawFolders = uniqueRawFolders(legacy);
      const rawItems = uniqueRawArtworks(legacy);
      if (rawFolders.length !== v2.folders.length || rawItems.length !== v2.artworks.length) {
        throw catalogError('CATALOG_NORMALIZED_COUNT_MISMATCH');
      }

      if (['themes', 'products', 'items'].includes(mode)) {
        const key = catalogRouteKey(mode, query);
        const text = JSON.stringify(legacy);
        routes.set(key, {
          routeKey: key,
          mode,
          folderId: String(query.folderId || ''),
          productKey: String(query.product || ''),
          payload: legacy,
          payloadBytes: new TextEncoder().encode(text).byteLength
        });
      }

      return { legacy, folders: rawFolders, items: rawItems };
    };

    const themes = await inspect('themes');
    state.themeCount = themes.folders.length;
    if (!state.themeCount) throw catalogError('CATALOG_THEMES_EMPTY');
    for (const folder of themes.folders) addSearchFolder(folders, folder, 1);

    const queue = themes.folders.map(folder => rawIdentity(folder));
    const visitedFolders = new Set();
    const visitedProducts = new Set();

    while (queue.length) {
      const folderId = String(queue.shift() || '').trim();
      if (!folderId || visitedFolders.has(folderId)) continue;
      visitedFolders.add(folderId);
      if (visitedFolders.size > limits.folders) throw catalogError('CATALOG_FOLDER_LIMIT_REACHED');

      const products = await inspect('products', { folderId });
      for (const folder of products.folders) {
        const id = rawIdentity(folder);
        if (!id) continue;

        if (isRawProductFolder(folder, id)) {
          if (visitedProducts.has(id)) continue;
          visitedProducts.add(id);
          const itemProductKey = cleanProductKey(folder?.product || productKey);
          const itemResponse = await inspect('items', { folderId: id, product: itemProductKey });
          for (const artwork of itemResponse.items) {
            addSearchItem(items, artwork, id, itemProductKey);
            if (items.size > limits.artworks) throw catalogError('CATALOG_ARTWORK_LIMIT_REACHED');
          }
          continue;
        }

        addSearchFolder(folders, folder, inferFolderDepth(folder));
        if (!visitedFolders.has(id)) queue.push(id);
      }
    }

    state.folderCount = folders.size;
    state.productCount = visitedProducts.size;
    state.artworkCount = items.size;
    state.routeCount = routes.size;
    state.traversalComplete = queue.length === 0;

    if (!state.productCount) throw catalogError('CATALOG_PRODUCTS_EMPTY');
    if (!state.artworkCount) throw catalogError('CATALOG_ARTWORKS_EMPTY');
    if (!state.traversalComplete) throw catalogError('CATALOG_TRAVERSAL_INCOMPLETE');
    if (state.rejectedCount !== 0 || state.differenceCount !== 0) {
      throw catalogError('CATALOG_VALIDATION_NOT_CLEAN');
    }

    state.fingerprint = catalogFingerprint(catalogVersion, routes);

    if (
      acceptedBefore?.configured === true &&
      Number(acceptedBefore.catalogVersion) === catalogVersion &&
      safeFingerprint(acceptedBefore.fingerprint) !== state.fingerprint
    ) {
      throw catalogError('CATALOG_VERSION_MUTATED_WITHOUT_INCREMENT');
    }

    const manifest = {
      contractVersion: 1,
      catalogVersion,
      fingerprint: state.fingerprint,
      routeCount: routes.size,
      folderCount: folders.size,
      itemCount: items.size
    };

    const begin = await supabaseRpc('armazem_v2_catalog_begin_v1', { p_manifest: manifest }, {
      supabaseUrl,
      serviceRoleKey,
      fetchImpl,
      timeoutMs: limits.timeoutMs,
      maxResponseBytes: 256 * 1024
    });

    if (begin?.action !== 'REPLAY') {
      await uploadRows('routes', [...routes.values()], catalogVersion, {
        supabaseUrl,
        serviceRoleKey,
        fetchImpl,
        limits
      });
      await uploadRows('folders', [...folders.values()], catalogVersion, {
        supabaseUrl,
        serviceRoleKey,
        fetchImpl,
        limits
      });
      await uploadRows('items', [...items.values()], catalogVersion, {
        supabaseUrl,
        serviceRoleKey,
        fetchImpl,
        limits
      });

      await supabaseRpc('armazem_v2_catalog_accept_v1', {
        p_manifest: {
          catalogVersion,
          fingerprint: state.fingerprint,
          rejectionCount: state.rejectedCount,
          differenceCount: state.differenceCount,
          traversalComplete: state.traversalComplete
        }
      }, {
        supabaseUrl,
        serviceRoleKey,
        fetchImpl,
        timeoutMs: limits.timeoutMs,
        maxResponseBytes: 256 * 1024
      });
    }

    const acceptedAfter = await supabaseRpc('armazem_v2_catalog_status_v1', {}, {
      supabaseUrl,
      serviceRoleKey,
      fetchImpl,
      timeoutMs: limits.timeoutMs,
      maxResponseBytes: 256 * 1024
    });

    if (
      acceptedAfter?.configured !== true ||
      Number(acceptedAfter.catalogVersion) !== catalogVersion ||
      safeFingerprint(acceptedAfter.fingerprint) !== state.fingerprint ||
      nonNegativeInteger(acceptedAfter.routeCount) !== routes.size ||
      nonNegativeInteger(acceptedAfter.folderCount) !== folders.size ||
      nonNegativeInteger(acceptedAfter.itemCount) !== items.size ||
      acceptedAfter.traversalComplete !== true ||
      nonNegativeInteger(acceptedAfter.rejectionCount) !== 0 ||
      nonNegativeInteger(acceptedAfter.differenceCount) !== 0
    ) {
      throw catalogError('CATALOG_ACCEPTANCE_VERIFICATION_FAILED');
    }

    state.action = begin?.action === 'REPLAY' ? 'REPLAY' : 'ACCEPTED';
    const report = sanitizeReport({
      ok: true,
      generatedAt: new Date().toISOString(),
      executionMode: 'github-actions-auto-accept',
      accepted: true,
      changed: state.action === 'ACCEPTED',
      ...state
    });
    await writePrivateReport(reportPath, report);
    await writeGithubOutput(report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  } catch (error) {
    const report = sanitizeReport({
      ok: false,
      generatedAt: new Date().toISOString(),
      executionMode: 'github-actions-auto-accept',
      accepted: false,
      changed: false,
      error: publicCode(error?.code || error?.message, 'CATALOG_AUTO_ACCEPT_FAILED'),
      ...state
    });
    await writePrivateReport(reportPath, report).catch(() => {});
    await writeGithubOutput(report).catch(() => {});
    throw catalogError(report.error);
  }
}

async function uploadRows(kind, rows, catalogVersion, options) {
  const batches = chunkRows(rows, 100, options.limits.batchBytes);
  for (const batch of batches) {
    await supabaseRpc('armazem_v2_catalog_load_batch_v1', {
      p_catalog_version: catalogVersion,
      p_kind: kind,
      p_rows: batch
    }, {
      supabaseUrl: options.supabaseUrl,
      serviceRoleKey: options.serviceRoleKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.limits.timeoutMs,
      maxResponseBytes: 256 * 1024
    });
  }
}

export function chunkRows(rows, maxCount = 100, maxBytes = DEFAULT_BATCH_BYTES) {
  const output = [];
  let batch = [];
  let bytes = 2;
  for (const row of Array.isArray(rows) ? rows : []) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
    if (rowBytes > maxBytes) throw catalogError('CATALOG_BATCH_ROW_TOO_LARGE');
    if (batch.length && (batch.length >= maxCount || bytes + rowBytes > maxBytes)) {
      output.push(batch);
      batch = [];
      bytes = 2;
    }
    batch.push(row);
    bytes += rowBytes;
  }
  if (batch.length) output.push(batch);
  return output;
}

export function catalogRouteKey(mode, query = {}) {
  if (mode === 'themes') return 'themes';
  if (mode === 'products') return `products:${String(query.folderId || '').trim()}`;
  if (mode === 'items') {
    return `items:${String(query.folderId || '').trim()}:${cleanProductKey(query.product || '50x50')}`;
  }
  throw catalogError('CATALOG_ROUTE_MODE_INVALID');
}

export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addSearchFolder(target, folder, depth) {
  const driveId = rawIdentity(folder);
  if (!driveId || isRawProductFolder(folder, driveId)) return;
  const payload = structuredClone(folder);
  target.set(driveId, {
    driveId,
    parentId: String(folder?.parentId || folder?.parent_drive_id || '').trim(),
    name: String(folder?.name || folder?.label || '').trim(),
    path: String(folder?.path || '').trim(),
    theme: String(folder?.theme || folder?.name || '').trim(),
    depth: nonNegativeInteger(folder?.depth) || nonNegativeInteger(depth),
    searchText: normalizeSearchText([
      folder?.name,
      folder?.label,
      folder?.path,
      folder?.theme,
      folder?.rawName
    ].filter(Boolean).join(' ')),
    payload
  });
}

function addSearchItem(target, artwork, parentFolderId, productKey) {
  const driveFileId = rawArtworkIdentity(artwork);
  if (!driveFileId) return;
  const code = String(artwork?.code || '').replace(/^#/, '').trim();
  const payload = structuredClone(artwork);
  target.set(driveFileId, {
    driveFileId,
    parentFolderId: String(artwork?.productFolderId || artwork?.themeId || parentFolderId || '').trim(),
    code,
    sortId: numericCode(code),
    theme: String(artwork?.theme || '').trim(),
    subtheme: String(artwork?.subtheme || '').trim(),
    productKey: cleanProductKey(artwork?.product || productKey),
    originalName: String(artwork?.originalName || artwork?.name || '').trim(),
    searchText: normalizeSearchText([
      code,
      artwork?.theme,
      artwork?.subtheme,
      artwork?.product,
      artwork?.productName,
      artwork?.originalName,
      artwork?.name,
      artwork?.path
    ].filter(Boolean).join(' ')),
    payload
  });
}

function catalogFingerprint(catalogVersion, routes) {
  const hash = createHash('sha256');
  hash.update(`catalog-v2:${catalogVersion}\n`);
  for (const [key, route] of [...routes.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(key);
    hash.update('\n');
    hash.update(JSON.stringify(route.payload));
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function supabaseRpc(name, body, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const url = new URL(`/rest/v1/rpc/${name}`, options.supabaseUrl);
    const response = await Reflect.apply(options.fetchImpl, globalThis, [url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        apikey: options.serviceRoleKey,
        Authorization: `Bearer ${options.serviceRoleKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(body || {})
    }]);
    const text = await readLimitedText(response, options.maxResponseBytes);
    if (!response.ok) throw catalogError(publicCode(parseErrorCode(text), `SUPABASE_RPC_${response.status}`));
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      throw catalogError('SUPABASE_RPC_JSON_INVALID');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw catalogError('SUPABASE_RPC_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseErrorCode(text) {
  try {
    const payload = JSON.parse(text);
    const message = String(payload?.message || '').trim();
    return /^[A-Z0-9_]{3,100}$/.test(message) ? message : '';
  } catch (_) {
    return '';
  }
}

async function requestLegacyJson(path, query, options) {
  options.state.requestCount += 1;
  if (options.state.requestCount > options.limits.requests) throw catalogError('CATALOG_REQUEST_LIMIT_REACHED');

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
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' }
    }]);
    if (!response.ok) throw catalogError(`LEGACY_CATALOG_HTTP_${response.status}`);
    const text = await readLimitedText(response, options.maxResponseBytes || options.limits.responseBytes);
    try {
      const payload = JSON.parse(text);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('NOT_OBJECT');
      return payload;
    } catch (_) {
      throw catalogError('LEGACY_CATALOG_JSON_INVALID');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw catalogError('LEGACY_CATALOG_TIMEOUT');
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
    } else if (row.type === 'artwork') {
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
  return folder?.kind === 'product' || folder?.directItems === true || id.startsWith('catalog-index-product:');
}

function inferFolderDepth(folder) {
  const direct = nonNegativeInteger(folder?.depth);
  if (direct > 0) return direct;
  const path = String(folder?.path || '').split('/').filter(Boolean);
  return Math.max(path.length, 2);
}

function cleanProductKey(value) {
  const text = String(value || '50x50').trim();
  return /^[A-Za-z0-9._-]{1,120}$/.test(text) ? text : '50x50';
}

function numericCode(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 18);
  const parsed = Number.parseInt(digits || '0', 10);
  return Number.isSafeInteger(parsed) ? parsed : 0;
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
    const code = cleanSummaryKey(key);
    if (count > 0 && code) target.set(code, (target.get(code) || 0) + count);
  }
}

function sanitizeReport(input) {
  return Object.freeze({
    ok: input.ok === true,
    generatedAt: validIso(input.generatedAt),
    executionMode: input.executionMode === 'github-actions-auto-accept' ? input.executionMode : 'unknown',
    accepted: input.accepted === true,
    changed: input.changed === true,
    action: ['ACCEPTED', 'REPLAY', 'UNCHANGED'].includes(input.action) ? input.action : '',
    requestCount: nonNegativeInteger(input.requestCount),
    themeCount: nonNegativeInteger(input.themeCount),
    folderCount: nonNegativeInteger(input.folderCount),
    productCount: nonNegativeInteger(input.productCount),
    artworkCount: nonNegativeInteger(input.artworkCount),
    routeCount: nonNegativeInteger(input.routeCount),
    rejectedCount: nonNegativeInteger(input.rejectedCount),
    differenceCount: nonNegativeInteger(input.differenceCount),
    catalogVersion: nonNegativeInteger(input.catalogVersion),
    traversalComplete: input.traversalComplete === true,
    fingerprint: safeFingerprint(input.fingerprint),
    rejectionSummary: mapSummary(input.rejectionCodes),
    differenceSummary: mapSummary(input.differenceFields),
    error: input.ok === true ? '' : publicCode(input.error, 'CATALOG_AUTO_ACCEPT_FAILED')
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
  if (Number.isFinite(declared) && declared > maxBytes) throw catalogError('CATALOG_RESPONSE_TOO_LARGE');
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
        throw catalogError('CATALOG_RESPONSE_TOO_LARGE');
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

async function writeGithubOutput(report) {
  const path = String(process.env.GITHUB_OUTPUT || '').trim();
  if (!path) return;
  await appendFile(path, [
    `catalog_version=${report.catalogVersion}`,
    `changed=${report.changed ? 'true' : 'false'}`,
    `accepted=${report.accepted ? 'true' : 'false'}`,
    `action=${report.action || 'FAILED'}`
  ].join('\n') + '\n');
}

function normalizeHttpsOrigin(value, errorCode) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw catalogError(errorCode); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw catalogError(errorCode);
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

function safeFingerprint(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : '';
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

function catalogError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  await publishAcceptedCatalogV2({
    legacyBaseUrl: process.env.CATALOG_LEGACY_BASE_URL,
    rootDriveId: process.env.CATALOG_V2_ROOT_DRIVE_ID,
    supabaseUrl: process.env.SUPABASE_V2_URL,
    serviceRoleKey: process.env.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY,
    reportPath: process.env.CATALOG_REPORT_FILE,
    maxRequests: process.env.CATALOG_INSPECTION_MAX_REQUESTS,
    maxFolders: process.env.CATALOG_INSPECTION_MAX_FOLDERS,
    maxArtworks: process.env.CATALOG_INSPECTION_MAX_ARTWORKS,
    force: process.env.CATALOG_FORCE_ACCEPT
  });
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    console.error(publicCode(error?.code || error?.message, 'CATALOG_AUTO_ACCEPT_FAILED'));
    process.exitCode = 1;
  });
}
