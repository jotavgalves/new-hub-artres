import { pathToFileURL } from 'node:url';

export async function verifyCatalogBridgeDisabled(options = {}) {
  const stagingUrl = normalizeHttpsOrigin(options.stagingUrl);
  const token = String(options.token || '').trim();
  const fetchImpl = options.fetch || globalThis.fetch;
  if (token.length < 32) throw verifyError('STAGING_API_TOKEN_MISSING_OR_SHORT');
  if (typeof fetchImpl !== 'function') throw verifyError('FETCH_REQUIRED');

  const health = await requestJson(new URL('/health', stagingUrl), {
    fetchImpl,
    headers: {},
    expectedStatuses: [200]
  });
  const bridge = health?.catalogReadonlyBridge;
  if (!health?.ok || bridge?.enabled !== false || bridge?.configured !== false) {
    throw verifyError('CATALOG_BRIDGE_NOT_DISABLED');
  }

  const previewUrl = new URL('/internal/v2/catalog/preview?mode=themes', stagingUrl);
  const preview = await requestJson(previewUrl, {
    fetchImpl,
    headers: { 'x-staging-token': token },
    expectedStatuses: [503]
  });
  if (preview?.error !== 'CATALOG_READONLY_BRIDGE_DISABLED' || preview?.readOnly !== true) {
    throw verifyError('CATALOG_DISABLED_ROUTE_RESPONSE_INVALID');
  }

  const result = Object.freeze({
    ok: true,
    bridgeEnabled: false,
    bridgeConfigured: false,
    previewBlocked: true
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

async function requestJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await Reflect.apply(options.fetchImpl, globalThis, [url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.headers || {}) }
    }]);
    const text = await response.text();
    if (!options.expectedStatuses.includes(response.status)) {
      throw verifyError(`CATALOG_VERIFY_HTTP_${response.status}`);
    }
    try { return JSON.parse(text); } catch (_) {
      throw verifyError('CATALOG_VERIFY_RESPONSE_NOT_JSON');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw verifyError('CATALOG_VERIFY_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHttpsOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) {
    throw verifyError('STAGING_URL_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw verifyError('STAGING_URL_INVALID');
  }
  return url.origin;
}

function verifyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  await verifyCatalogBridgeDisabled({
    stagingUrl: process.env.STAGING_URL,
    token: process.env.SITE_V2_STAGING_API_TOKEN
  });
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    const code = String(error?.code || 'CATALOG_DISABLED_VERIFY_FAILED')
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 100) || 'CATALOG_DISABLED_VERIFY_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
