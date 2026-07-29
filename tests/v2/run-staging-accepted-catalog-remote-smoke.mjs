const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const MAX_FOLDERS = 40;
const PROPAGATION_MAX_ATTEMPTS = 180;
const PROPAGATION_INTERVAL_MS = 1000;
const REQUIRED_STABLE_RESPONSES = 3;
const HOME_MAX_REDIRECTS = 3;
const TRANSIENT_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

async function main() {
  const stable = await waitForAcceptedCatalogDeployment();
  const metadata = stable.metadata;

  const themes = await catalogRequest('themes');
  const queue = uniqueFolders(themes);
  if (!queue.length) throw smokeError('STAGING_ACCEPTED_CATALOG_THEMES_EMPTY');

  let productCount = 0;
  let itemCount = 0;
  const visited = new Set();

  while (queue.length && visited.size < MAX_FOLDERS && !itemCount) {
    const folder = queue.shift();
    const folderId = identity(folder);
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);

    const products = await catalogRequest('products', { folderId });
    for (const child of uniqueFolders(products)) {
      const id = identity(child);
      if (!id) continue;
      if (child?.kind === 'product' || child?.directItems === true || id.startsWith('catalog-index-product:')) {
        productCount += 1;
        const payload = await catalogRequest('items', {
          folderId: id,
          product: String(child?.product || '50x50')
        });
        const items = Array.isArray(payload?.items) ? payload.items : [];
        itemCount += items.length;
        if (items.length) break;
      } else if (!visited.has(id)) {
        queue.push(child);
      }
    }
  }

  if (!productCount || !itemCount) throw smokeError('STAGING_ACCEPTED_CATALOG_ITEMS_NOT_REACHABLE');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    propagationAttempts: stable.attempts,
    stableResponses: stable.consecutive,
    homeRedirects: stable.homeRedirects,
    catalogVersion: Number(metadata.catalogVersion),
    themeCount: uniqueFolders(themes).length,
    visitedFolderCount: visited.size,
    productCount,
    reachableItemCount: itemCount,
    currentDesignServed: true,
    productionChanged: false
  })}\n`);
}

async function waitForAcceptedCatalogDeployment() {
  let consecutive = 0;
  let lastCode = 'STAGING_ACCEPTED_CATALOG_PROPAGATION_PENDING';
  let homeRedirects = 0;

  for (let attempt = 1; attempt <= PROPAGATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const home = await fetchHomeText(new URL('/', STAGING_URL), 2 * 1024 * 1024);
      homeRedirects = home.redirects;
      if (!home.response.ok || !/<title>Escolha suas Artes \| Armazém Festa e Eventos<\/title>/i.test(home.text)) {
        lastCode = home.response.ok
          ? 'STAGING_CURRENT_DESIGN_NOT_SERVED'
          : `STAGING_HOME_HTTP_${home.response.status}`;
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }

      const healthResult = await fetchJsonResult(new URL('/health', STAGING_URL));
      if (!healthResult.ok) {
        lastCode = healthResult.code;
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }
      const health = healthResult.payload;
      if (
        health?.ok !== true ||
        health?.acceptedCatalog?.enabled !== true ||
        health?.acceptedCatalog?.configured !== true ||
        health?.catalogReadonlyBridge?.enabled !== false
      ) {
        lastCode = 'STAGING_ACCEPTED_CATALOG_HEALTH_PENDING';
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }

      const metadataResult = await fetchJsonResult(new URL('/api/catalog-meta', STAGING_URL));
      if (!metadataResult.ok) {
        lastCode = metadataResult.code;
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }
      const metadata = metadataResult.payload;
      if (!validAcceptedMetadata(metadata)) {
        lastCode = 'STAGING_ACCEPTED_CATALOG_METADATA_PENDING';
        consecutive = 0;
        await waitBeforeRetry(attempt, lastCode);
        continue;
      }

      consecutive += 1;
      process.stdout.write(`${JSON.stringify({
        event: 'staging-accepted-catalog-stable-probe',
        attempt,
        consecutive,
        homeRedirects,
        catalogVersion: Number(metadata.catalogVersion)
      })}\n`);

      if (consecutive >= REQUIRED_STABLE_RESPONSES) {
        return Object.freeze({
          attempts: attempt,
          consecutive,
          homeRedirects,
          metadata
        });
      }
    } catch (error) {
      lastCode = publicCode(error?.code || error?.message, 'STAGING_ACCEPTED_CATALOG_PROPAGATION_RETRY');
      consecutive = 0;
      await waitBeforeRetry(attempt, lastCode);
    }
  }

  throw smokeError(lastCode === 'STAGING_ACCEPTED_CATALOG_PROPAGATION_PENDING'
    ? 'STAGING_ACCEPTED_CATALOG_PROPAGATION_TIMEOUT'
    : lastCode);
}

function validAcceptedMetadata(metadata) {
  return metadata?.ok === true &&
    Number.isInteger(Number(metadata.catalogVersion)) &&
    Number(metadata.catalogVersion) >= 1 &&
    Number(metadata.routeCount) >= 1 &&
    Number(metadata.folderCount) >= 1 &&
    Number(metadata.itemCount) >= 1;
}

async function waitBeforeRetry(attempt, code) {
  process.stdout.write(`${JSON.stringify({
    event: 'staging-accepted-catalog-propagation-retry',
    attempt,
    code: publicCode(code, 'STAGING_ACCEPTED_CATALOG_PROPAGATION_RETRY')
  })}\n`);
  if (attempt < PROPAGATION_MAX_ATTEMPTS) await delay(PROPAGATION_INTERVAL_MS);
}

async function catalogRequest(mode, query = {}) {
  const url = new URL('/api/drive', STAGING_URL);
  url.searchParams.set('mode', mode);
  for (const [key, value] of Object.entries(query)) {
    const text = String(value || '').trim();
    if (text) url.searchParams.set(key, text);
  }
  const payload = await fetchJson(url);
  if (payload?.ok !== true) throw smokeError('STAGING_ACCEPTED_CATALOG_REQUEST_FAILED');
  return payload;
}

async function fetchJson(url) {
  const result = await fetchJsonResult(url);
  if (!result.ok) throw smokeError(result.code);
  return result.payload;
}

async function fetchJsonResult(url) {
  const { response, text } = await fetchText(url, 8 * 1024 * 1024);
  if (!response.ok) {
    return {
      ok: false,
      code: TRANSIENT_STATUSES.has(response.status)
        ? `STAGING_TRANSIENT_HTTP_${response.status}`
        : `STAGING_HTTP_${response.status}`
    };
  }
  try {
    return { ok: true, payload: JSON.parse(text) };
  } catch (_) {
    return { ok: false, code: 'STAGING_RESPONSE_JSON_INVALID' };
  }
}

async function fetchHomeText(url, maxBytes) {
  let current = new URL(url);

  for (let redirects = 0; redirects <= HOME_MAX_REDIRECTS; redirects += 1) {
    const result = await fetchText(current, maxBytes, { redirect: 'manual' });
    const status = result.response.status;
    if (status < 300 || status >= 400) return { ...result, redirects };

    if (redirects >= HOME_MAX_REDIRECTS) throw smokeError('STAGING_HOME_REDIRECT_LIMIT');
    const location = String(result.response.headers.get('location') || '').trim();
    if (!location) throw smokeError('STAGING_HOME_REDIRECT_LOCATION_MISSING');

    const next = new URL(location, current);
    if (next.origin !== STAGING_URL || next.username || next.password) {
      throw smokeError('STAGING_HOME_REDIRECT_EXTERNAL');
    }
    if (next.pathname.startsWith('/api/') || next.pathname.startsWith('/internal/')) {
      throw smokeError('STAGING_HOME_REDIRECT_INVALID_PATH');
    }
    next.hash = '';
    current = next;
  }

  throw smokeError('STAGING_HOME_REDIRECT_LIMIT');
}

async function fetchText(url, maxBytes, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: options.redirect || 'error',
      signal: controller.signal,
      headers: { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8', 'Cache-Control': 'no-store' }
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw smokeError('STAGING_RESPONSE_TOO_LARGE');
    return { response, text };
  } catch (error) {
    if (error?.name === 'AbortError') throw smokeError('STAGING_REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueFolders(payload) {
  const rows = [payload?.folders, payload?.results, payload?.themes, payload?.products].find(Array.isArray) || [];
  const map = new Map();
  for (const row of rows) {
    const id = identity(row);
    if (id && !map.has(id)) map.set(id, row);
  }
  return [...map.values()];
}

function identity(value) {
  return String(value?.id || value?.driveId || value?.drive_id || '').trim();
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw smokeError('STAGING_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw smokeError('STAGING_URL_INVALID');
  }
  return url.origin;
}

function publicCode(value, fallback) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function smokeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

main().catch(error => {
  const code = publicCode(
    error?.code || error?.message,
    'STAGING_ACCEPTED_CATALOG_SMOKE_FAILED'
  );
  console.error(code);
  process.exitCode = 1;
});
