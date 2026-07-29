const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const MAX_FOLDERS = 80;

async function main() {
  const [health, html, bridge] = await Promise.all([
    getJson('/health'),
    getText('/index.html'),
    getText('/assets/v2-checkout-bridge.js')
  ]);

  if (
    health?.ok !== true ||
    health?.publicCheckout?.enabled !== true ||
    health?.publicCheckout?.implemented !== true ||
    health?.publicCheckout?.acceptsRealOrders !== true ||
    health?.publicCheckout?.protection?.configured !== true
  ) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_HEALTH_INVALID');
  }
  if ((html.match(/v2-checkout-bridge\.js/g) || []).length !== 1) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_BRIDGE_TAG_INVALID');
  }
  if (
    !bridge.includes('site-v2-visual-checkout-bridge-v1') ||
    !bridge.includes("const ROUTE = '/api/orders/v2'") ||
    bridge.includes('STAGING_API_TOKEN') ||
    bridge.includes('SUPABASE_V2_SERVICE_ROLE_KEY')
  ) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_BRIDGE_SOURCE_INVALID');
  }

  const artwork = await firstFiftyArtwork();
  const driveFileId = identity(artwork);
  const sizeKey = String(artwork?.sizeKey || artwork?.size || '50x50').trim();
  if (!driveFileId) throw smokeError('PUBLIC_VISUAL_CHECKOUT_ARTWORK_INVALID');

  const body = {
    submissionCreatedAt: new Date().toISOString(),
    seller: { id: 'visual-staging', label: 'Vendedora Sintética Visual' },
    customer: { name: 'Cliente Sintético Visual', whatsapp: '81999999999' },
    items: [{
      driveFileId,
      productKey: '50x50',
      variantKey: 'default',
      sizeKey,
      quantity: 6,
      details: {
        measurements: { diameterCm: 50 },
        observations: 'Smoke visual sintético'
      }
    }]
  };
  const idempotencyKey = `visual-public-${crypto.randomUUID()}`;

  const missingOrigin = await post(body, idempotencyKey, '');
  if (missingOrigin.status !== 403 || missingOrigin.payload?.error !== 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED') {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_MISSING_ORIGIN_NOT_BLOCKED');
  }

  const crossOrigin = await post(body, idempotencyKey, 'https://example.invalid');
  if (crossOrigin.status !== 403 || crossOrigin.payload?.error !== 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED') {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_CROSS_ORIGIN_NOT_BLOCKED');
  }

  const created = await waitForPublicSubmit(body, idempotencyKey);
  if (
    created.status !== 201 ||
    created.payload?.ok !== true ||
    created.payload?.action !== 'CREATED' ||
    created.payload?.replayed !== false ||
    !/^PED[0-9]{7}[A-Z]$/.test(String(created.payload?.orderNumber || '')) ||
    Number(created.payload?.quantity) !== 6 ||
    Number(created.payload?.pricing?.total) !== 58.5 ||
    created.payload?.customerPreserved !== true ||
    created.payload?.sellerPreserved !== true ||
    created.payload?.canonicalDetailsPreserved !== true
  ) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_CREATE_INVALID');
  }

  const replay = await waitForPublicReplay(body, idempotencyKey, created.payload.orderNumber);
  if (
    replay.status !== 200 ||
    replay.payload?.ok !== true ||
    replay.payload?.action !== 'REPLAY' ||
    replay.payload?.replayed !== true ||
    replay.payload?.orderNumber !== created.payload.orderNumber ||
    Number(replay.payload?.pricing?.total) !== 58.5
  ) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_REPLAY_INVALID');
  }

  for (const payload of [created.payload, replay.payload]) {
    const serialized = JSON.stringify(payload);
    for (const privateValue of [
      driveFileId,
      body.customer.name,
      body.customer.whatsapp,
      body.items[0].details.observations,
      idempotencyKey
    ]) {
      if (serialized.includes(privateValue)) {
        throw smokeError('PUBLIC_VISUAL_CHECKOUT_RESPONSE_EXPOSED_PRIVATE_DATA');
      }
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    bridgeInjected: true,
    publicCheckoutEnabled: true,
    originProtection: true,
    created: true,
    replayed: true,
    orderNumber: created.payload.orderNumber,
    authoritativeTotal: created.payload.pricing.total,
    productionChanged: false
  })}\n`);
}

async function waitForPublicSubmit(body, key) {
  let last = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    last = await post(body, key, STAGING_URL);
    if (last.status === 201 && last.payload?.action === 'CREATED') return last;
    if (last.status !== 404 && last.status !== 503 && last.status < 500) return last;
    if (attempt < 60) await sleep(1000);
  }
  return last;
}

async function waitForPublicReplay(body, key, number) {
  let last = null;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    last = await post(body, key, STAGING_URL);
    if (
      last.status === 200 &&
      last.payload?.action === 'REPLAY' &&
      last.payload?.orderNumber === number
    ) return last;
    if (last.status !== 404 && last.status !== 503 && last.status < 500) return last;
    if (attempt < 60) await sleep(1000);
  }
  return last;
}

async function post(body, key, origin) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
    'X-Request-Id': `visual-smoke-${crypto.randomUUID()}`
  };
  if (origin) headers.Origin = origin;
  const response = await fetch(new URL('/api/orders/v2', STAGING_URL), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'error'
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_RESPONSE_JSON_INVALID');
  }
  return { status: response.status, payload };
}

async function firstFiftyArtwork() {
  const themes = await catalogRequest('themes');
  const queue = uniqueFolders(themes);
  const visited = new Set();

  while (queue.length && visited.size < MAX_FOLDERS) {
    const folder = queue.shift();
    const folderId = identity(folder);
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);
    const products = await catalogRequest('products', { folderId });

    for (const child of uniqueFolders(products)) {
      const id = identity(child);
      if (!id) continue;
      const productKey = String(child?.productKey || child?.product || '').trim();
      if (child?.kind === 'product' || child?.directItems === true || id.startsWith('catalog-index-product:')) {
        if (productKey !== '50x50') continue;
        const payload = await catalogRequest('items', { folderId: id, product: '50x50' });
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (items.length) return items[0];
      } else if (!visited.has(id)) queue.push(child);
    }
  }
  throw smokeError('PUBLIC_VISUAL_CHECKOUT_50X50_NOT_REACHABLE');
}

async function catalogRequest(mode, query = {}) {
  const url = new URL('/api/drive', STAGING_URL);
  url.searchParams.set('mode', mode);
  for (const [key, value] of Object.entries(query)) {
    const text = String(value || '').trim();
    if (text) url.searchParams.set(key, text);
  }
  const payload = await getJson(url);
  if (payload?.ok !== true) throw smokeError('PUBLIC_VISUAL_CHECKOUT_CATALOG_REQUEST_FAILED');
  return payload;
}

async function getJson(pathOrUrl) {
  const response = await fetch(pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, STAGING_URL), {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    redirect: 'error'
  });
  const text = await response.text();
  if (!response.ok) throw smokeError(`PUBLIC_VISUAL_CHECKOUT_DEPENDENCY_HTTP_${response.status}`);
  try { return JSON.parse(text); } catch (_) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_DEPENDENCY_JSON_INVALID');
  }
}

async function getText(path) {
  const response = await fetch(new URL(path, STAGING_URL), {
    headers: { Accept: 'text/html,application/javascript', 'Cache-Control': 'no-store' },
    redirect: 'error'
  });
  if (!response.ok) throw smokeError(`PUBLIC_VISUAL_CHECKOUT_ASSET_HTTP_${response.status}`);
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
    throw smokeError('PUBLIC_VISUAL_CHECKOUT_ASSET_TOO_LARGE');
  }
  return text;
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
  return String(value?.driveFileId || value?.id || value?.driveId || value?.drive_id || '').trim();
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) {
    throw smokeError('STAGING_URL_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw smokeError('STAGING_URL_INVALID');
  }
  return url.origin;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function smokeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

main().catch(error => {
  const code = String(error?.code || error?.message || 'PUBLIC_VISUAL_CHECKOUT_SMOKE_FAILED');
  console.error(/^[A-Z0-9_]{3,100}$/.test(code) ? code : 'PUBLIC_VISUAL_CHECKOUT_SMOKE_FAILED');
  process.exitCode = 1;
});
