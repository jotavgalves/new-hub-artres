import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  createGoogleDriveClient,
  exchangeServiceAccountToken,
  parseServiceAccountCredentials
} from './service-account-google-drive.mjs';
import {
  DEFAULT_CATALOG_ROOTS,
  scanPrivateDriveCatalog
} from './private-drive-catalog-indexer.mjs';

const DEFAULT_BATCH_BYTES = 1_500_000;

export async function publishPrivateDriveCatalogV2(options = {}) {
  const credentials = parseServiceAccountCredentials(options.serviceAccountJson);
  const supabaseUrl = normalizeHttpsOrigin(options.supabaseUrl, 'SUPABASE_V2_URL_INVALID');
  const serviceRoleKey = String(options.serviceRoleKey || '').trim();
  const reportPath = String(options.reportPath || '').trim();
  const fetchImpl = options.fetch || globalThis.fetch;
  if (serviceRoleKey.length < 32) throw catalogError('SUPABASE_V2_SERVICE_ROLE_KEY_MISSING_OR_SHORT');
  if (!reportPath) throw catalogError('CATALOG_REPORT_FILE_REQUIRED');
  if (typeof fetchImpl !== 'function') throw catalogError('FETCH_REQUIRED');

  const limits = {
    timeoutMs: boundedInteger(options.timeoutMs, 1000, 60000, 15000),
    maxFolders: boundedInteger(options.maxFolders, 10, 50000, 10000),
    maxFiles: boundedInteger(options.maxFiles, 10, 500000, 250000),
    maxDepth: boundedInteger(options.maxDepth, 1, 100, 30),
    batchBytes: boundedInteger(options.batchBytes, 100_000, 4_000_000, DEFAULT_BATCH_BYTES)
  };

  const state = {
    ok: false,
    configured: true,
    generatedAt: new Date().toISOString(),
    source: 'google-drive-service-account',
    action: '',
    accepted: false,
    changed: false,
    catalogVersion: 0,
    fingerprint: '',
    routeCount: 0,
    folderCount: 0,
    artworkCount: 0,
    traversalComplete: false,
    issueCount: 0,
    issueSummary: [],
    roots: [],
    error: ''
  };

  try {
    const statusBefore = await supabaseRpc('armazem_v2_catalog_status_v1', {}, {
      supabaseUrl,
      serviceRoleKey,
      fetchImpl,
      timeoutMs: limits.timeoutMs
    });
    const token = await exchangeServiceAccountToken(credentials, {
      fetch: fetchImpl,
      timeoutMs: limits.timeoutMs
    });
    const counters = {};
    const drive = createGoogleDriveClient({
      fetch: fetchImpl,
      accessToken: token.accessToken,
      timeoutMs: limits.timeoutMs,
      counters
    });
    const catalog = await scanPrivateDriveCatalog({
      drive,
      roots: options.roots || DEFAULT_CATALOG_ROOTS,
      maxFolders: limits.maxFolders,
      maxFiles: limits.maxFiles,
      maxDepth: limits.maxDepth
    });

    state.fingerprint = catalog.fingerprint;
    state.routeCount = catalog.routes.length;
    state.folderCount = catalog.folders.length;
    state.artworkCount = catalog.items.length;
    state.traversalComplete = catalog.traversalComplete === true;
    state.issueCount = catalog.report.issueCount;
    state.issueSummary = catalog.report.issueSummary;
    state.roots = catalog.report.roots.map(root => ({
      rootDriveId: root.rootDriveId,
      productKey: root.productKey,
      themesFound: root.themesFound,
      themesPublished: root.themesPublished,
      foldersPublished: root.foldersPublished,
      artworksPublished: root.artworksPublished
    }));

    if (
      options.force !== true &&
      options.force !== 'true' &&
      statusBefore?.configured === true &&
      safeFingerprint(statusBefore.fingerprint) === catalog.fingerprint
    ) {
      state.ok = true;
      state.accepted = true;
      state.changed = false;
      state.action = 'UNCHANGED';
      state.catalogVersion = positiveInteger(statusBefore.catalogVersion) || 0;
      const report = sanitizeReport(state);
      await writeReports(reportPath, report, catalog.report);
      await writeGithubOutput(report);
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return report;
    }

    const previousVersion = positiveInteger(statusBefore?.catalogVersion) || 0;
    const requestedVersion = positiveInteger(options.catalogVersion);
    const catalogVersion = requestedVersion && requestedVersion > previousVersion
      ? requestedVersion
      : previousVersion + 1;
    state.catalogVersion = catalogVersion;

    const manifest = {
      contractVersion: 1,
      catalogVersion,
      fingerprint: catalog.fingerprint,
      routeCount: catalog.routes.length,
      folderCount: catalog.folders.length,
      itemCount: catalog.items.length
    };
    const begin = await supabaseRpc('armazem_v2_catalog_begin_v1', { p_manifest: manifest }, {
      supabaseUrl,
      serviceRoleKey,
      fetchImpl,
      timeoutMs: limits.timeoutMs
    });

    if (begin?.action !== 'REPLAY') {
      await uploadRows('routes', catalog.routes, catalogVersion, { supabaseUrl, serviceRoleKey, fetchImpl, limits });
      await uploadRows('folders', catalog.folders, catalogVersion, { supabaseUrl, serviceRoleKey, fetchImpl, limits });
      await uploadRows('items', catalog.items, catalogVersion, { supabaseUrl, serviceRoleKey, fetchImpl, limits });
      await supabaseRpc('armazem_v2_catalog_accept_v1', {
        p_manifest: {
          catalogVersion,
          fingerprint: catalog.fingerprint,
          rejectionCount: 0,
          differenceCount: 0,
          traversalComplete: true
        }
      }, {
        supabaseUrl,
        serviceRoleKey,
        fetchImpl,
        timeoutMs: limits.timeoutMs
      });
    }

    const statusAfter = await supabaseRpc('armazem_v2_catalog_status_v1', {}, {
      supabaseUrl,
      serviceRoleKey,
      fetchImpl,
      timeoutMs: limits.timeoutMs
    });
    verifyAcceptedStatus(statusAfter, manifest);

    state.ok = true;
    state.accepted = true;
    state.changed = begin?.action !== 'REPLAY';
    state.action = begin?.action === 'REPLAY' ? 'REPLAY' : 'ACCEPTED';
    const report = sanitizeReport(state);
    await writeReports(reportPath, report, catalog.report);
    await writeGithubOutput(report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
  } catch (error) {
    state.error = publicCode(error?.code || error?.message, 'AUTHENTICATED_CATALOG_PUBLISH_FAILED');
    const report = sanitizeReport(state);
    await writePrivateReport(reportPath, report).catch(() => {});
    await writeGithubOutput(report).catch(() => {});
    throw catalogError(report.error);
  }
}

export async function runConfiguredPrivateDriveSync(options = {}) {
  const rawCredentials = String(options.serviceAccountJson || '').trim();
  const reportPath = String(options.reportPath || '').trim();
  if (rawCredentials) return publishPrivateDriveCatalogV2(options);
  const report = sanitizeReport({
    ok: true,
    configured: false,
    generatedAt: new Date().toISOString(),
    source: 'google-drive-service-account',
    action: 'NOT_CONFIGURED',
    accepted: false,
    changed: false,
    catalogVersion: 0,
    fingerprint: '',
    routeCount: 0,
    folderCount: 0,
    artworkCount: 0,
    traversalComplete: false,
    issueCount: 0,
    issueSummary: [],
    roots: [],
    error: ''
  });
  if (reportPath) await writePrivateReport(reportPath, report);
  await writeGithubOutput(report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report;
}

async function uploadRows(kind, rows, catalogVersion, options) {
  for (const batch of chunkRows(rows, 100, options.limits.batchBytes)) {
    await supabaseRpc('armazem_v2_catalog_load_batch_v1', {
      p_catalog_version: catalogVersion,
      p_kind: kind,
      p_rows: batch
    }, {
      supabaseUrl: options.supabaseUrl,
      serviceRoleKey: options.serviceRoleKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.limits.timeoutMs
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
    const text = await readLimitedText(response, 512 * 1024);
    if (!response.ok) throw catalogError(publicCode(parseErrorCode(text), `SUPABASE_RPC_${response.status}`));
    try { return text ? JSON.parse(text) : {}; } catch (_) { throw catalogError('SUPABASE_RPC_JSON_INVALID'); }
  } catch (error) {
    if (error?.name === 'AbortError') throw catalogError('SUPABASE_RPC_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function verifyAcceptedStatus(status, manifest) {
  if (
    status?.configured !== true ||
    positiveInteger(status.catalogVersion) !== manifest.catalogVersion ||
    safeFingerprint(status.fingerprint) !== manifest.fingerprint ||
    nonNegativeInteger(status.routeCount) !== manifest.routeCount ||
    nonNegativeInteger(status.folderCount) !== manifest.folderCount ||
    nonNegativeInteger(status.itemCount) !== manifest.itemCount ||
    status.traversalComplete !== true ||
    nonNegativeInteger(status.rejectionCount) !== 0 ||
    nonNegativeInteger(status.differenceCount) !== 0
  ) {
    throw catalogError('AUTHENTICATED_CATALOG_ACCEPTANCE_VERIFICATION_FAILED');
  }
}

function sanitizeReport(input) {
  return Object.freeze({
    ok: input.ok === true,
    configured: input.configured === true,
    generatedAt: validIso(input.generatedAt),
    source: input.source === 'google-drive-service-account' ? input.source : 'unknown',
    action: ['ACCEPTED', 'REPLAY', 'UNCHANGED', 'NOT_CONFIGURED'].includes(input.action) ? input.action : '',
    accepted: input.accepted === true,
    changed: input.changed === true,
    catalogVersion: nonNegativeInteger(input.catalogVersion),
    fingerprint: safeFingerprint(input.fingerprint),
    routeCount: nonNegativeInteger(input.routeCount),
    folderCount: nonNegativeInteger(input.folderCount),
    artworkCount: nonNegativeInteger(input.artworkCount),
    traversalComplete: input.traversalComplete === true,
    issueCount: nonNegativeInteger(input.issueCount),
    issueSummary: sanitizeIssueSummary(input.issueSummary),
    roots: sanitizeRoots(input.roots),
    error: input.ok === true ? '' : publicCode(input.error, 'AUTHENTICATED_CATALOG_PUBLISH_FAILED')
  });
}

function sanitizeIssueSummary(value) {
  return (Array.isArray(value) ? value : []).slice(0, 50).map(item => ({
    code: publicCode(item?.code, 'CATALOG_SCAN_ISSUE'),
    count: nonNegativeInteger(item?.count)
  })).filter(item => item.count > 0);
}

function sanitizeRoots(value) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map(root => ({
    rootDriveId: safeIdentity(root?.rootDriveId),
    productKey: safeToken(root?.productKey, 160),
    themesFound: nonNegativeInteger(root?.themesFound),
    themesPublished: nonNegativeInteger(root?.themesPublished),
    foldersPublished: nonNegativeInteger(root?.foldersPublished),
    artworksPublished: nonNegativeInteger(root?.artworksPublished)
  }));
}

async function writeReports(reportPath, report, scanReport) {
  await writePrivateReport(reportPath, report);
  const detailPath = `${reportPath}.details.json`;
  await writeFile(detailPath, `${JSON.stringify(scanReport, null, 2)}\n`, { mode: 0o600 });
}

async function writePrivateReport(path, report) {
  if (!path) return;
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function writeGithubOutput(report) {
  const path = String(process.env.GITHUB_OUTPUT || '').trim();
  if (!path) return;
  await appendFile(path, [
    `configured=${report.configured ? 'true' : 'false'}`,
    `catalog_version=${report.catalogVersion}`,
    `changed=${report.changed ? 'true' : 'false'}`,
    `accepted=${report.accepted ? 'true' : 'false'}`,
    `action=${report.action || 'FAILED'}`
  ].join('\n') + '\n');
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

function parseErrorCode(text) {
  try {
    const payload = JSON.parse(text);
    const message = String(payload?.message || '').trim();
    return /^[A-Z0-9_]{3,100}$/.test(message) ? message : '';
  } catch (_) {
    return '';
  }
}

function normalizeHttpsOrigin(value, errorCode) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw catalogError(errorCode); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw catalogError(errorCode);
  }
  return url.origin;
}

function safeFingerprint(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : '';
}

function safeIdentity(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_-]{5,500}$/.test(text) ? text : '';
}

function safeToken(value, max) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._-]{1,500}$/.test(text) ? text.slice(0, max) : '';
}

function publicCode(value, fallback) {
  const text = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
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
  await runConfiguredPrivateDriveSync({
    serviceAccountJson: process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
    supabaseUrl: process.env.SUPABASE_V2_URL,
    serviceRoleKey: process.env.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY,
    reportPath: process.env.CATALOG_REPORT_FILE,
    maxFolders: process.env.CATALOG_INSPECTION_MAX_FOLDERS,
    maxFiles: process.env.CATALOG_INSPECTION_MAX_ARTWORKS,
    maxDepth: process.env.CATALOG_INSPECTION_MAX_DEPTH,
    force: process.env.CATALOG_FORCE_ACCEPT
  });
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    console.error(publicCode(error?.code || error?.message, 'AUTHENTICATED_CATALOG_PUBLISH_FAILED'));
    process.exitCode = 1;
  });
}
