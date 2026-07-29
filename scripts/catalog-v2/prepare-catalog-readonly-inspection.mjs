import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function prepareCatalogReadonlyInspectionFiles(options = {}) {
  const sourcePath = requiredPath(options.sourcePath || 'wrangler.site-v2-staging.jsonc', 'SOURCE_CONFIG_FILE_REQUIRED');
  const activePath = requiredPath(options.activePath, 'ACTIVE_CONFIG_FILE_REQUIRED');
  const safePath = requiredPath(options.safePath, 'SAFE_CONFIG_FILE_REQUIRED');
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const rootDriveId = normalizeRootDriveId(options.rootDriveId);

  const sourceText = await readFile(sourcePath, 'utf8');
  const source = JSON.parse(sourceText);
  const vars = source?.vars;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) {
    throw inspectionConfigError('STAGING_VARS_REQUIRED');
  }
  if (vars.CATALOG_READONLY_BRIDGE_ENABLED !== 'false') {
    throw inspectionConfigError('CATALOG_BRIDGE_SOURCE_MUST_BE_DISABLED');
  }
  if (vars.STAGING_LOW_LEVEL_LEDGER_ENABLED !== 'false') {
    throw inspectionConfigError('LOW_LEVEL_LEDGER_MUST_REMAIN_DISABLED');
  }
  if (Object.hasOwn(vars, 'CATALOG_LEGACY_BASE_URL') || Object.hasOwn(vars, 'CATALOG_V2_ROOT_DRIVE_ID')) {
    throw inspectionConfigError('CATALOG_REAL_IDENTIFIERS_MUST_NOT_BE_VERSIONED');
  }

  const active = structuredClone(source);
  active.vars.CATALOG_READONLY_BRIDGE_ENABLED = 'true';
  active.vars.CATALOG_LEGACY_BASE_URL = baseUrl;
  active.vars.CATALOG_V2_ROOT_DRIVE_ID = rootDriveId;
  active.vars.CATALOG_V2_PRODUCT_KEY = '50x50';
  active.vars.CATALOG_V2_PRODUCT_NAME = 'Bolinhas 50x50';
  active.vars.CATALOG_V2_STRUCTURE = 'theme-or-subtheme-images';

  const safe = structuredClone(source);
  safe.vars.CATALOG_READONLY_BRIDGE_ENABLED = 'false';
  for (const key of [
    'CATALOG_LEGACY_BASE_URL',
    'CATALOG_V2_ROOT_DRIVE_ID',
    'CATALOG_V2_PRODUCT_KEY',
    'CATALOG_V2_PRODUCT_NAME',
    'CATALOG_V2_STRUCTURE'
  ]) {
    delete safe.vars[key];
  }

  await writePrivateJson(activePath, active);
  await writePrivateJson(safePath, safe);

  return Object.freeze({
    ok: true,
    activeBridgeEnabled: true,
    safeBridgeEnabled: false,
    activeConfigured: true,
    safeConfigured: false,
    targetHost: new URL(baseUrl).hostname,
    rootConfigured: true,
    sourceUnchanged: true
  });
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim();
  let url;
  try {
    url = new URL(text);
  } catch (_) {
    throw inspectionConfigError('CATALOG_LEGACY_BASE_URL_INVALID');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw inspectionConfigError('CATALOG_LEGACY_BASE_URL_INVALID');
  }

  return url.origin;
}

function normalizeRootDriveId(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(text)) {
    throw inspectionConfigError('CATALOG_V2_ROOT_DRIVE_ID_INVALID');
  }
  return text;
}

function requiredPath(value, code) {
  const text = String(value || '').trim();
  if (!text) throw inspectionConfigError(code);
  return text;
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function inspectionConfigError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  const result = await prepareCatalogReadonlyInspectionFiles({
    sourcePath: process.env.STAGING_CONFIG_FILE || 'wrangler.site-v2-staging.jsonc',
    activePath: process.env.CATALOG_ACTIVE_CONFIG_FILE,
    safePath: process.env.CATALOG_SAFE_CONFIG_FILE,
    baseUrl: process.env.CATALOG_LEGACY_BASE_URL,
    rootDriveId: process.env.CATALOG_V2_ROOT_DRIVE_ID
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    const code = String(error?.code || 'CATALOG_INSPECTION_CONFIG_FAILED')
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 100) || 'CATALOG_INSPECTION_CONFIG_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
