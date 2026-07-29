const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const MAX_FOLDERS = 40;

async function main() {
  const home = await fetchText(new URL('/', STAGING_URL), 2 * 1024 * 1024);
  if (!home.response.ok || !/<title>Escolha suas Artes \| Armazém Festa e Eventos<\/title>/i.test(home.text)) {
    throw smokeError('STAGING_CURRENT_DESIGN_NOT_SERVED');
  }

  const health = await fetchJson(new URL('/health', STAGING_URL));
  if (
    health?.ok !== true ||
    health?.acceptedCatalog?.enabled !== true ||
    health?.acceptedCatalog?.configured !== true ||
    health?.catalogReadonlyBridge?.enabled !== false
  ) {
    throw smokeError('STAGING_ACCEPTED_CATALOG_HEALTH_INVALID');
  }

  const metadata = await fetchJson(new URL('/api/catalog-meta', STAGING_URL));
  if (
    metadata?.ok !== true ||
    !Number.isInteger(Number(metadata.catalogVersion)) ||
    Number(metadata.catalogVersion) < 1 ||
    Number(metadata.folderCount) < 1 ||
    Number(metadata.itemCount) < 1
  ) {
    throw smokeError('STAGING_ACCEPTED_CATALOG_METADATA_INVALID');
  }

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
    catalogVersion: Number(metadata.catalogVersion),
    themeCount: uniqueFolders(themes).length,
    visitedFolderCount: visited.size,
    productCount,
    reachableItemCount: itemCount,
    currentDesignServed: true,
    productionChanged: false
  })}\n`);
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
  const { response, text } = await fetchText(url, 8 * 1024 * 1024);
  if (!response.ok) throw smokeError(`STAGING_HTTP_${response.status}`);
  try {
    return JSON.parse(text);
  } catch (_) {
    throw smokeError('STAGING_RESPONSE_JSON_INVALID');
  }
}

async function fetchText(url, maxBytes) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
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

function smokeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

main().catch(error => {
  const code = String(error?.code || 'STAGING_ACCEPTED_CATALOG_SMOKE_FAILED')
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 100) || 'STAGING_ACCEPTED_CATALOG_SMOKE_FAILED';
  console.error(code);
  process.exitCode = 1;
});
