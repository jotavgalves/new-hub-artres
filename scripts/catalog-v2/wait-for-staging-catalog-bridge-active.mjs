import { pathToFileURL } from 'node:url';

export async function waitForCatalogBridgeActive(options = {}) {
  const stagingUrl = normalizeHttpsOrigin(options.stagingUrl);
  const fetchImpl = options.fetch || globalThis.fetch;
  const sleepImpl = options.sleep || sleep;
  const maxAttempts = boundedInteger(options.maxAttempts, 1, 120, 90);
  const intervalMs = boundedInteger(options.intervalMs, 100, 5000, 1000);
  const timeoutMs = boundedInteger(options.timeoutMs, 500, 15000, 5000);

  if (typeof fetchImpl !== 'function') throw activationError('FETCH_REQUIRED');
  if (typeof sleepImpl !== 'function') throw activationError('SLEEP_REQUIRED');

  let lastState = 'unavailable';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const health = await requestHealth(new URL('/health', stagingUrl), {
        fetchImpl,
        timeoutMs
      });
      const bridge = health?.catalogReadonlyBridge;
      if (health?.ok === true && bridge?.enabled === true && bridge?.configured === true) {
        const result = Object.freeze({
          ok: true,
          active: true,
          configured: true,
          attempts: attempt
        });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result;
      }
      lastState = bridge?.enabled === false
        ? 'disabled'
        : bridge?.configured === false
          ? 'not_configured'
          : 'not_ready';
    } catch (error) {
      lastState = publicState(error?.code || error?.message);
    }

    if (attempt < maxAttempts) await sleepImpl(intervalMs);
  }

  const error = activationError('CATALOG_BRIDGE_ACTIVATION_TIMEOUT');
  error.lastState = lastState;
  error.attempts = maxAttempts;
  throw error;
}

async function requestHealth(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await Reflect.apply(options.fetchImpl, globalThis, [url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    }]);
    if (!response.ok) throw activationError(`CATALOG_HEALTH_HTTP_${response.status}`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw activationError('CATALOG_HEALTH_NOT_JSON');
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw activationError('CATALOG_HEALTH_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeHttpsOrigin(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (_) {
    throw activationError('STAGING_URL_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw activationError('STAGING_URL_INVALID');
  }
  return url.origin;
}

function publicState(value) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : 'unavailable';
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function activationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  await waitForCatalogBridgeActive({
    stagingUrl: process.env.STAGING_URL,
    maxAttempts: process.env.CATALOG_ACTIVATION_MAX_ATTEMPTS,
    intervalMs: process.env.CATALOG_ACTIVATION_INTERVAL_MS,
    timeoutMs: process.env.CATALOG_ACTIVATION_HEALTH_TIMEOUT_MS
  });
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    const code = String(error?.code || 'CATALOG_BRIDGE_ACTIVATION_FAILED')
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 100) || 'CATALOG_BRIDGE_ACTIVATION_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
