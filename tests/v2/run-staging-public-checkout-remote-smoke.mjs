const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const RUN_ID = String(process.env.GITHUB_RUN_ID || Date.now());
const RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '1');
const PRODUCT_KEY = '50x50';
const MAX_FOLDERS = 80;

async function main() {
  const health = await getJson('/health', 'public-checkout-health');
  assert(health?.ok === true, 'PUBLIC_CHECKOUT_HEALTH_INVALID');
  assert(health?.acceptedCatalog?.enabled === true, 'PUBLIC_CHECKOUT_ACCEPTED_CATALOG_DISABLED');
  assert(health?.publicCheckout?.enabled === true, 'PUBLIC_CHECKOUT_DISABLED');
  assert(health?.commercialConfig?.enabled === true, 'PUBLIC_CHECKOUT_COMMERCIAL_CONFIG_DISABLED');

  const commercialEnvelope = await getJson('/api/commercial-config', 'public-checkout-commercial-config');
  const commercial = validateCommercialConfig(commercialEnvelope?.config);
  const product = commercial.products[PRODUCT_KEY];
  assert(product.enabled === true, 'PUBLIC_CHECKOUT_BOLINHAS_DISABLED');

  const artwork = await findFirstArtwork(PRODUCT_KEY);
  const quantity = product.quantity.initial;
  const expected = expectedPricing(product.unitPrice, quantity, commercial.effectiveDiscountPercent);
  const idempotencyKey = `public-checkout-${RUN_ID}-${RUN_ATTEMPT}`.slice(0, 128);
  const submissionCreatedAt = new Date().toISOString();
  const body = {
    submissionCreatedAt,
    seller: { id: 'ci-public-checkout', label: 'CI Public Checkout' },
    customer: { name: 'Cliente Sintético Público', whatsapp: '5581999999999' },
    items: [{
      driveFileId: artwork.driveFileId,
      code: artwork.code,
      productKey: PRODUCT_KEY,
      variantKey: artwork.variantKey,
      sizeKey: artwork.sizeKey,
      quantity,
      unitPrice: 0.01,
      lineSubtotal: 0.01
    }],
    totals: { subtotal: 0.01, total: 0.01 }
  };

  const missingOrigin = await postOrderWithOrigin(
    body,
    `${idempotencyKey}-no-origin`.slice(0, 128),
    'public-checkout-missing-origin',
    ''
  );
  assert(missingOrigin.status === 403, `PUBLIC_CHECKOUT_MISSING_ORIGIN_HTTP_${missingOrigin.status}`);
  assert(missingOrigin.payload?.error === 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED', 'PUBLIC_CHECKOUT_MISSING_ORIGIN_NOT_BLOCKED');

  const externalOrigin = await postOrderWithOrigin(
    body,
    `${idempotencyKey}-external-origin`.slice(0, 128),
    'public-checkout-external-origin',
    'https://example.invalid'
  );
  assert(externalOrigin.status === 403, `PUBLIC_CHECKOUT_EXTERNAL_ORIGIN_HTTP_${externalOrigin.status}`);
  assert(externalOrigin.payload?.error === 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED', 'PUBLIC_CHECKOUT_EXTERNAL_ORIGIN_NOT_BLOCKED');

  const created = await postOrder(body, idempotencyKey, 'public-checkout-created');
  assert(created.status === 201, `PUBLIC_CHECKOUT_CREATED_HTTP_${created.status}`);
  assert(created.payload?.ok === true, 'PUBLIC_CHECKOUT_CREATED_PAYLOAD_INVALID');
  assert(created.payload?.action === 'CREATED', 'PUBLIC_CHECKOUT_ACTION_INVALID');
  assert(created.payload?.replayed === false, 'PUBLIC_CHECKOUT_CREATED_REPLAYED');
  assert(/^PED\d{7}[A-Z]$/.test(String(created.payload?.orderNumber || '')), 'PUBLIC_CHECKOUT_ORDER_NUMBER_INVALID');
  assert(created.payload?.itemCount === 1, 'PUBLIC_CHECKOUT_ITEM_COUNT_INVALID');
  assert(created.payload?.quantity === quantity, 'PUBLIC_CHECKOUT_QUANTITY_INVALID');
  assert(created.payload?.pricing?.subtotal === expected.subtotal, 'PUBLIC_CHECKOUT_SUBTOTAL_INVALID');
  assert(created.payload?.pricing?.discountPercent === commercial.effectiveDiscountPercent, 'PUBLIC_CHECKOUT_DISCOUNT_INVALID');
  assert(created.payload?.pricing?.discountAmount === expected.discountAmount, 'PUBLIC_CHECKOUT_DISCOUNT_AMOUNT_INVALID');
  assert(created.payload?.pricing?.total === expected.total, 'PUBLIC_CHECKOUT_TOTAL_INVALID');
  assert(created.payload?.configVersion === commercial.version, 'PUBLIC_CHECKOUT_CONFIG_VERSION_INVALID');
  assert(created.payload?.catalogVersion >= 1, 'PUBLIC_CHECKOUT_CATALOG_VERSION_INVALID');
  assert(created.payload?.canonicalDetailsPreserved === true, 'PUBLIC_CHECKOUT_DETAILS_NOT_PRESERVED');
  assert(created.payload?.customerPreserved === true, 'PUBLIC_CHECKOUT_CUSTOMER_NOT_PRESERVED');
  assert(created.payload?.sellerPreserved === true, 'PUBLIC_CHECKOUT_SELLER_NOT_PRESERVED');
  assert(Array.isArray(created.payload?.warnings), 'PUBLIC_CHECKOUT_WARNINGS_INVALID');
  assert(created.payload.warnings.includes('CLIENT_ITEM_PRICE_IGNORED'), 'PUBLIC_CHECKOUT_CLIENT_PRICE_NOT_IGNORED');
  assert(created.payload.warnings.includes('CLIENT_ORDER_TOTALS_IGNORED'), 'PUBLIC_CHECKOUT_CLIENT_TOTAL_NOT_IGNORED');

  const replay = await postOrder(body, idempotencyKey, 'public-checkout-replay');
  assert(replay.status === 200, `PUBLIC_CHECKOUT_REPLAY_HTTP_${replay.status}`);
  assert(replay.payload?.ok === true, 'PUBLIC_CHECKOUT_REPLAY_PAYLOAD_INVALID');
  assert(replay.payload?.action === 'REPLAY', 'PUBLIC_CHECKOUT_REPLAY_ACTION_INVALID');
  assert(replay.payload?.replayed === true, 'PUBLIC_CHECKOUT_REPLAY_FLAG_INVALID');
  assert(replay.payload?.orderNumber === created.payload.orderNumber, 'PUBLIC_CHECKOUT_REPLAY_ORDER_CHANGED');
  assert(replay.payload?.pricing?.total === expected.total, 'PUBLIC_CHECKOUT_REPLAY_TOTAL_CHANGED');
  assert(replay.payload?.configVersion === commercial.version, 'PUBLIC_CHECKOUT_REPLAY_CONFIG_CHANGED');

  const conflictBody = structuredClone(body);
  conflictBody.customer.name = 'Cliente Sintético Conflitante';
  const conflict = await postOrder(conflictBody, idempotencyKey, 'public-checkout-conflict');
  assert(conflict.status === 409, `PUBLIC_CHECKOUT_CONFLICT_HTTP_${conflict.status}`);
  assert(conflict.payload?.error === 'IDEMPOTENCY_KEY_CONFLICT', 'PUBLIC_CHECKOUT_CONFLICT_ERROR_INVALID');

  const bridge = await getText('/assets/v2-checkout-bridge.js', 'public-checkout-bridge');
  assert(bridge.includes('site-v2-visual-checkout-bridge-v1'), 'PUBLIC_CHECKOUT_BRIDGE_MARKER_MISSING');
  assert(bridge.includes('/api/orders/v2'), 'PUBLIC_CHECKOUT_BRIDGE_ROUTE_MISSING');
  assert(!bridge.includes('/internal/v2/orders/submit'), 'PUBLIC_CHECKOUT_BRIDGE_INTERNAL_ROUTE_EXPOSED');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    orderNumber: created.payload.orderNumber,
    action: created.payload.action,
    replayAction: replay.payload.action,
    originProtection: true,
    commercialConfigVersion: commercial.version,
    productKey: PRODUCT_KEY,
    quantity,
    unitPrice: product.unitPrice,
    discountPercent: commercial.effectiveDiscountPercent,
    total: expected.total,
    catalogVersion: created.payload.catalogVersion,
    productionChanged: false
  })}\n`);
}

async function findFirstArtwork(productKey) {
  const themes = await catalogRequest('themes', { product: productKey });
  const queue = uniqueFolders(themes);
  const visited = new Set();

  while (queue.length && visited.size < MAX_FOLDERS) {
    const folder = queue.shift();
    const folderId = identity(folder);
    if (!folderId || visited.has(folderId)) continue;
    visited.add(folderId);

    const products = await catalogRequest('products', { folderId, product: productKey });
    for (const child of uniqueFolders(products)) {
      const childId = identity(child);
      if (!childId) continue;
      if (child?.kind === 'product' || child?.directItems === true || childId.startsWith('catalog-index-product:')) {
        const payload = await catalogRequest('items', { folderId: childId, product: productKey });
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const selected = items.find(item => normalizeProductKey(item) === productKey) || items[0];
        if (selected) return normalizeArtwork(selected, productKey);
      } else if (!visited.has(childId)) {
        queue.push(child);
      }
    }
  }

  throw smokeError('PUBLIC_CHECKOUT_REAL_ARTWORK_NOT_FOUND');
}

function normalizeArtwork(item, productKey) {
  const driveFileId = clean(item?.driveFileId || item?.drive_file_id || item?.id);
  const code = clean(item?.code || item?.codigo);
  const variantKey = identityValue(item?.variantKey || item?.variant || 'default') || 'default';
  const sizeKey = identityValue(item?.sizeKey || item?.size || item?.dimension || 'default') || 'default';
  assert(driveFileId, 'PUBLIC_CHECKOUT_ARTWORK_DRIVE_ID_MISSING');
  assert(code, 'PUBLIC_CHECKOUT_ARTWORK_CODE_MISSING');
  assert(normalizeProductKey(item) === productKey || !normalizeProductKey(item), 'PUBLIC_CHECKOUT_ARTWORK_PRODUCT_MISMATCH');
  return Object.freeze({ driveFileId, code, variantKey, sizeKey });
}

function validateCommercialConfig(input = {}) {
  const source = record(input);
  const version = positiveInteger(source.version);
  const discount = finiteNumber(source.effectiveDiscountPercent);
  const products = record(source.products);
  assert(source.schemaVersion === 1, 'PUBLIC_CHECKOUT_COMMERCIAL_SCHEMA_INVALID');
  assert(version, 'PUBLIC_CHECKOUT_COMMERCIAL_VERSION_INVALID');
  assert(source.currency === 'BRL', 'PUBLIC_CHECKOUT_COMMERCIAL_CURRENCY_INVALID');
  assert(discount !== null && discount >= 0 && discount <= 100, 'PUBLIC_CHECKOUT_COMMERCIAL_DISCOUNT_INVALID');

  const product = record(products[PRODUCT_KEY]);
  const quantity = record(product.quantity);
  const unitPrice = finiteNumber(product.unitPrice);
  const minimum = positiveInteger(quantity.minimum);
  const step = positiveInteger(quantity.step);
  const initial = positiveInteger(quantity.initial);
  assert(clean(product.key) === PRODUCT_KEY, 'PUBLIC_CHECKOUT_COMMERCIAL_PRODUCT_KEY_INVALID');
  assert(unitPrice !== null && unitPrice >= 0, 'PUBLIC_CHECKOUT_COMMERCIAL_PRICE_INVALID');
  assert(minimum && step && initial, 'PUBLIC_CHECKOUT_COMMERCIAL_QUANTITY_INVALID');
  assert(initial >= minimum && (initial - minimum) % step === 0, 'PUBLIC_CHECKOUT_COMMERCIAL_INITIAL_INVALID');

  return Object.freeze({
    version,
    effectiveDiscountPercent: discount,
    products: Object.freeze({
      [PRODUCT_KEY]: Object.freeze({
        enabled: product.enabled === true,
        unitPrice,
        quantity: Object.freeze({ minimum, step, initial, scope: clean(quantity.scope) })
      })
    })
  });
}

function expectedPricing(unitPrice, quantity, discountPercent) {
  const subtotal = money(unitPrice * quantity);
  const discountAmount = money(subtotal * discountPercent / 100);
  return Object.freeze({ subtotal, discountAmount, total: money(subtotal - discountAmount) });
}

async function postOrder(body, idempotencyKey, label) {
  return postOrderWithOrigin(body, idempotencyKey, label, STAGING_URL);
}

async function postOrderWithOrigin(body, idempotencyKey, label, origin) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Idempotency-Key': idempotencyKey,
    'X-Request-Id': `${label}-${RUN_ID}-${RUN_ATTEMPT}`
  };
  if (origin) headers.Origin = origin;

  const response = await fetch(new URL('/api/orders/v2', STAGING_URL), {
    method: 'POST',
    redirect: 'error',
    headers,
    body: JSON.stringify(body)
  });
  return { status: response.status, payload: await responseJson(response, label) };
}

async function catalogRequest(mode, query = {}) {
  const url = new URL('/api/drive', STAGING_URL);
  url.searchParams.set('mode', mode);
  for (const [key, value] of Object.entries(query)) {
    const text = clean(value);
    if (text) url.searchParams.set(key, text);
  }
  const payload = await getJson(url.pathname + url.search, `public-checkout-catalog-${mode}`);
  assert(payload?.ok === true, `PUBLIC_CHECKOUT_CATALOG_${mode.toUpperCase()}_FAILED`);
  return payload;
}

async function getJson(pathname, label) {
  const response = await fetch(new URL(pathname, STAGING_URL), {
    method: 'GET',
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'X-Request-Id': `${label}-${RUN_ID}-${RUN_ATTEMPT}`
    }
  });
  assert(response.ok, `${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_HTTP_${response.status}`);
  return responseJson(response, label);
}

async function getText(pathname, label) {
  const response = await fetch(new URL(pathname, STAGING_URL), {
    method: 'GET',
    redirect: 'error',
    headers: {
      Accept: 'application/javascript,text/javascript;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-store',
      'X-Request-Id': `${label}-${RUN_ID}-${RUN_ATTEMPT}`
    }
  });
  assert(response.ok, `${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_HTTP_${response.status}`);
  const text = await response.text();
  assert(new TextEncoder().encode(text).byteLength <= 1024 * 1024, 'PUBLIC_CHECKOUT_TEXT_RESPONSE_TOO_LARGE');
  return text;
}

async function responseJson(response, label) {
  const text = await response.text();
  assert(new TextEncoder().encode(text).byteLength <= 1024 * 1024, 'PUBLIC_CHECKOUT_JSON_RESPONSE_TOO_LARGE');
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    throw smokeError(`${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_JSON_INVALID`);
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

function normalizeProductKey(value) {
  return clean(value?.productKey || value?.product || value?.product_key).toLowerCase();
}

function identity(value) {
  return clean(value?.id || value?.driveId || value?.drive_id);
}

function identityValue(value) {
  return clean(value).replace(/[:\s]+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '');
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function finiteNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(clean(value)); } catch (_) { throw smokeError('STAGING_URL_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw smokeError('STAGING_URL_INVALID');
  }
  return url.origin;
}

function assert(condition, code) {
  if (!condition) throw smokeError(code);
}

function smokeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

main().catch(error => {
  const code = String(error?.code || error?.message || 'PUBLIC_CHECKOUT_REMOTE_SMOKE_FAILED');
  console.error(/^[A-Z0-9_]{3,160}$/.test(code) ? code : 'PUBLIC_CHECKOUT_REMOTE_SMOKE_FAILED');
  process.exitCode = 1;
});
