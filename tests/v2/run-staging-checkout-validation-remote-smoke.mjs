import { waitForStagingCheckoutPricing } from './wait-for-staging-checkout-pricing.mjs';

const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const STAGING_API_TOKEN = String(process.env.SITE_V2_STAGING_API_TOKEN || '').trim();
const MAX_FOLDERS = 40;

async function main() {
  if (STAGING_API_TOKEN.length < 32) {
    throw smokeError('SITE_V2_STAGING_API_TOKEN_MISSING_OR_SHORT');
  }

  const [health, metadata] = await Promise.all([
    getJson('/health'),
    getJson('/api/catalog-meta')
  ]);

  if (
    health?.ok !== true ||
    health?.acceptedCatalog?.enabled !== true ||
    health?.acceptedCatalog?.configured !== true
  ) {
    throw smokeError('CHECKOUT_VALIDATION_ACCEPTED_CATALOG_NOT_READY');
  }
  if (
    health?.publicCheckout?.enabled !== false ||
    health?.publicCheckout?.acceptsRealOrders !== false
  ) {
    throw smokeError('PUBLIC_CHECKOUT_MUST_REMAIN_DISABLED');
  }
  if (!Number.isInteger(Number(metadata?.catalogVersion)) || Number(metadata.catalogVersion) < 1) {
    throw smokeError('CHECKOUT_VALIDATION_CATALOG_VERSION_INVALID');
  }

  const artwork = await firstReachableArtwork();
  const driveFileId = identity(artwork);
  const productKey = String(artwork?.productKey || artwork?.product || '50x50').trim();
  const sizeKey = String(artwork?.sizeKey || artwork?.size || 'default').trim();
  if (!driveFileId || !productKey || !sizeKey) {
    throw smokeError('CHECKOUT_VALIDATION_ARTWORK_CONTRACT_INVALID');
  }

  const privateCustomerName = 'Cliente Sintético do Rascunho';
  const privateObservation = 'Observação Sintética Privada';
  const privatePersonalization = 'Helena Sintética';
  const baseItem = {
    driveFileId,
    productKey,
    variantKey: 'default',
    sizeKey,
    quantity: 6,
    unitPrice: 0.01,
    lineSubtotal: 0.06,
    medidas: { larguraCm: 50, alturaCm: 50 },
    observacoes: privateObservation,
    personalizacao: { nome: privatePersonalization, idade: 6 }
  };
  const validRequest = {
    seller: { id: 'staging-seller-preview', label: 'Vendedora Sintética' },
    customer: {
      name: privateCustomerName,
      whatsapp: '(81) 99999-9999',
      phone: '(81) 98888-7777'
    },
    subtotal: 0.01,
    total: 0.01,
    clientTotals: { total: 0.01 },
    items: [baseItem]
  };

  const valid = await waitForStagingCheckoutPricing({
    expectedCatalogVersion: Number(metadata.catalogVersion),
    request: async () => postValidation(validRequest)
  });

  if (
    Number(valid.payload?.itemCount) !== 1 ||
    !Array.isArray(valid.payload?.productKeys) ||
    valid.payload.productKeys.length !== 1 ||
    valid.payload?.canonicalDraftReady !== true ||
    valid.payload?.orderDraft?.sellerPresent !== true ||
    valid.payload?.orderDraft?.customerNamePresent !== true ||
    valid.payload?.orderDraft?.customerWhatsappPresent !== true ||
    Number(valid.payload?.orderDraft?.measurementsItemCount) !== 1 ||
    Number(valid.payload?.orderDraft?.observationsItemCount) !== 1 ||
    Number(valid.payload?.orderDraft?.personalizationItemCount) !== 1
  ) {
    throw smokeError('CHECKOUT_CANONICAL_DRAFT_SUMMARY_FAILED');
  }

  await expectValidationError(
    { ...baseItem, productKey: productKey === 'painel-150' ? '50x50' : 'painel-150' },
    'ARTWORK_PRODUCT_MISMATCH'
  );
  await expectValidationError(
    { ...baseItem, variantKey: 'variante-invalida' },
    'VARIANT_NOT_ALLOWED'
  );
  await expectValidationError(
    { ...baseItem, sizeKey: sizeKey === '150x150' ? '50x50' : '150x150' },
    'ARTWORK_SIZE_MISMATCH'
  );
  await expectPricingError(
    { ...baseItem, quantity: 4 },
    'ORDER_QUANTITY_RULES_INVALID'
  );
  await expectPricingError(
    { ...baseItem, quantity: 7 },
    'ORDER_QUANTITY_RULES_INVALID'
  );

  const submissionCreatedAt = new Date().toISOString();
  const idempotencyKey = `checkout-staging-${crypto.randomUUID()}`;
  const submitBody = {
    ...validRequest,
    submissionCreatedAt
  };
  const created = await waitForCheckoutSubmit(submitBody, idempotencyKey);
  if (
    ![200, 201].includes(created.status) ||
    created.payload?.ok !== true ||
    !['CREATED', 'REPLAY'].includes(created.payload?.action) ||
    !/^PED[0-9]{7}[A-Z]$/.test(String(created.payload?.orderNumber || '')) ||
    Number(created.payload?.schemaVersion) !== 2 ||
    Number(created.payload?.itemCount) !== 1 ||
    Number(created.payload?.quantity) !== 6 ||
    Number(created.payload?.pricing?.total) !== 58.5 ||
    Number(created.payload?.catalogVersion) !== Number(metadata.catalogVersion) ||
    created.payload?.canonicalDetailsPreserved !== true ||
    created.payload?.customerPreserved !== true ||
    created.payload?.sellerPreserved !== true
  ) {
    throw smokeError('CHECKOUT_IDEMPOTENT_CREATE_FAILED');
  }

  const replay = await postSubmit(submitBody, idempotencyKey);
  const replayFailure = checkoutReplayFailureCode(replay, created.payload?.orderNumber);
  if (replayFailure) throw smokeError(replayFailure);

  const conflict = await postSubmit({
    ...submitBody,
    items: [{ ...baseItem, quantity: 8 }]
  }, idempotencyKey);
  if (
    conflict.status !== 409 ||
    conflict.payload?.ok !== false ||
    conflict.payload?.error !== 'IDEMPOTENCY_KEY_CONFLICT'
  ) {
    throw smokeError('CHECKOUT_IDEMPOTENCY_CONFLICT_NOT_REJECTED');
  }

  const publicCheckout = await requestJson('/api/orders/v2', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'remote-checkout-disabled-validation-0001'
    },
    body: JSON.stringify({ items: [baseItem] })
  });
  if (
    publicCheckout.status !== 503 ||
    publicCheckout.payload?.error !== 'PUBLIC_CHECKOUT_DISABLED'
  ) {
    throw smokeError('PUBLIC_CHECKOUT_DISABLED_BARRIER_FAILED');
  }

  for (const responsePayload of [valid.payload, created.payload, replay.payload, conflict.payload]) {
    const serialized = JSON.stringify(responsePayload);
    for (const privateValue of [
      driveFileId,
      privateCustomerName,
      '81999999999',
      privateObservation,
      privatePersonalization,
      idempotencyKey
    ]) {
      if (serialized.includes(privateValue)) {
        throw smokeError('CHECKOUT_VALIDATION_RESPONSE_EXPOSED_PRIVATE_DATA');
      }
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    catalogVersion: Number(metadata.catalogVersion),
    validItemAccepted: true,
    authoritativePriceApplied: true,
    clientPriceIgnored: true,
    clientTotalIgnored: true,
    customerPreserved: true,
    sellerPreserved: true,
    measurementsPreserved: true,
    observationsPreserved: true,
    personalizationPreserved: true,
    canonicalDraftReady: true,
    idempotentCreateAccepted: true,
    idempotentReplayAccepted: true,
    idempotencyConflictRejected: true,
    minimumRejected: true,
    invalidStepRejected: true,
    productMismatchRejected: true,
    invalidVariantRejected: true,
    sizeMismatchRejected: true,
    publicCheckoutDisabled: true,
    syntheticStagingOrderCreated: true,
    realOrderCreated: false,
    productionChanged: false
  })}\n`);
}

async function waitForCheckoutSubmit(body, idempotencyKey) {
  let lastCode = 'CHECKOUT_SUBMIT_EDGE_NOT_READY';
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const result = await postSubmit(body, idempotencyKey);
    if (
      [200, 201].includes(result.status) &&
      result.payload?.ok === true &&
      ['CREATED', 'REPLAY'].includes(result.payload?.action)
    ) {
      return result;
    }
    if (result.status === 401 || result.status === 403) {
      throw smokeError('CHECKOUT_SUBMIT_AUTH_FAILED');
    }
    if (result.status !== 404 && result.status < 500) {
      lastCode = publicCode(result.payload?.error, 'CHECKOUT_SUBMIT_RESPONSE_INVALID');
      throw smokeError(lastCode);
    }
    lastCode = publicCode(result.payload?.error, 'CHECKOUT_SUBMIT_EDGE_NOT_READY');
    if (attempt < 90) await sleep(1000);
  }
  throw smokeError(lastCode);
}

function checkoutReplayFailureCode(result, expectedOrderNumber) {
  const status = Number(result?.status || 0);
  const payload = result?.payload;
  if (status !== 200) {
    return Number.isInteger(status) && status >= 100 && status <= 599
      ? `CHECKOUT_REPLAY_HTTP_${status}`
      : 'CHECKOUT_REPLAY_HTTP_INVALID';
  }
  if (payload?.ok !== true) {
    return payload?.error === 'IDEMPOTENCY_KEY_CONFLICT'
      ? 'CHECKOUT_REPLAY_UNEXPECTED_CONFLICT'
      : 'CHECKOUT_REPLAY_OK_FALSE';
  }
  if (payload?.action !== 'REPLAY') {
    return payload?.action === 'CREATED'
      ? 'CHECKOUT_REPLAY_ACTION_CREATED'
      : 'CHECKOUT_REPLAY_ACTION_INVALID';
  }
  if (payload?.replayed !== true) return 'CHECKOUT_REPLAY_FLAG_FALSE';
  if (payload?.orderNumber !== expectedOrderNumber) return 'CHECKOUT_REPLAY_ORDER_MISMATCH';
  if (Number(payload?.pricing?.total) !== 58.5) return 'CHECKOUT_REPLAY_PRICE_MISMATCH';
  return '';
}

async function expectValidationError(item, expectedCode) {
  const result = await postValidation({ items: [item] });
  if (
    result.status !== 422 ||
    result.payload?.ok !== false ||
    result.payload?.error !== expectedCode ||
    Number(result.payload?.itemIndex) !== 0
  ) {
    throw smokeError(`CHECKOUT_VALIDATION_${expectedCode}_NOT_REJECTED`);
  }
}

async function expectPricingError(item, expectedCode) {
  const result = await postValidation({ items: [item] });
  if (
    result.status !== 422 ||
    result.payload?.ok !== false ||
    result.payload?.error !== expectedCode ||
    result.payload?.itemIndex !== undefined
  ) {
    throw smokeError(`CHECKOUT_PRICING_${expectedCode}_NOT_REJECTED`);
  }
}

async function postValidation(body) {
  return requestJson('/internal/v2/checkout/validate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-staging-token': STAGING_API_TOKEN
    },
    body: JSON.stringify(body)
  });
}

async function postSubmit(body, idempotencyKey) {
  return requestJson('/internal/v2/checkout/submit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'x-staging-token': STAGING_API_TOKEN
    },
    body: JSON.stringify(body)
  });
}

async function firstReachableArtwork() {
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
      if (child?.kind === 'product' || child?.directItems === true || id.startsWith('catalog-index-product:')) {
        const payload = await catalogRequest('items', {
          folderId: id,
          product: String(child?.product || child?.productKey || '50x50')
        });
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (items.length) return items[0];
      } else if (!visited.has(id)) {
        queue.push(child);
      }
    }
  }

  throw smokeError('CHECKOUT_VALIDATION_ARTWORK_NOT_REACHABLE');
}

async function catalogRequest(mode, query = {}) {
  const url = new URL('/api/drive', STAGING_URL);
  url.searchParams.set('mode', mode);
  for (const [key, value] of Object.entries(query)) {
    const text = String(value || '').trim();
    if (text) url.searchParams.set(key, text);
  }
  const result = await requestJson(url);
  if (result.status !== 200 || result.payload?.ok !== true) {
    throw smokeError('CHECKOUT_VALIDATION_CATALOG_REQUEST_FAILED');
  }
  return result.payload;
}

async function getJson(path) {
  const result = await requestJson(path);
  if (result.status !== 200 || !result.payload) {
    throw smokeError('CHECKOUT_VALIDATION_DEPENDENCY_FAILED');
  }
  return result.payload;
}

async function requestJson(pathOrUrl, options = {}) {
  const url = pathOrUrl instanceof URL ? pathOrUrl : new URL(pathOrUrl, STAGING_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const headers = new Headers({
      Accept: 'application/json',
      'Cache-Control': 'no-store'
    });
    for (const [key, value] of Object.entries(options.headers || {})) {
      headers.set(key, String(value));
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers,
      ...(options.body !== undefined ? { body: options.body } : {})
    });
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
      throw smokeError('CHECKOUT_VALIDATION_RESPONSE_TOO_LARGE');
    }

    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) {
      throw smokeError('CHECKOUT_VALIDATION_RESPONSE_JSON_INVALID');
    }
    return { status: response.status, payload };
  } catch (error) {
    if (error?.name === 'AbortError') throw smokeError('CHECKOUT_VALIDATION_REQUEST_TIMEOUT');
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
  return String(value?.driveFileId || value?.id || value?.driveId || value?.drive_id || '').trim();
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) {
    throw smokeError('STAGING_URL_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    throw smokeError('STAGING_URL_INVALID');
  }
  return url.origin;
}

function publicCode(value, fallback) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
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
  console.error(publicCode(
    error?.code || error?.message,
    'STAGING_CHECKOUT_VALIDATION_SMOKE_FAILED'
  ));
  process.exitCode = 1;
});
