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

  const serialized = JSON.stringify(valid.payload);
  for (const privateValue of [
    driveFileId,
    privateCustomerName,
    '81999999999',
    privateObservation,
    privatePersonalization
  ]) {
    if (serialized.includes(privateValue)) {
      throw smokeError('CHECKOUT_VALIDATION_RESPONSE_EXPOSED_PRIVATE_DATA');
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
    minimumRejected: true,
    invalidStepRejected: true,
    productMismatchRejected: true,
    invalidVariantRejected: true,
    sizeMismatchRejected: true,
    publicCheckoutDisabled: true,
    writesPerformed: false,
    productionChanged: false
  })}\n`);
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
