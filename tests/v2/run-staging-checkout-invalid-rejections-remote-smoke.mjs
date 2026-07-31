import { waitForStagingCheckoutProtection } from './wait-for-staging-checkout-protection.mjs';

const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const STAGING_API_TOKEN = String(process.env.SITE_V2_STAGING_API_TOKEN || '').trim();
const MAX_FOLDERS = 40;
const MAX_TRANSIENT_ATTEMPTS = 3;
const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

async function main() {
  if (STAGING_API_TOKEN.length < 32) {
    throw smokeError('SITE_V2_STAGING_API_TOKEN_MISSING_OR_SHORT');
  }

  const health = await waitForStagingCheckoutProtection({
    request: async () => requestJson('/health')
  });
  const metadata = await getJson('/api/catalog-meta');

  if (
    health?.ok !== true ||
    health?.acceptedCatalog?.enabled !== true ||
    health?.acceptedCatalog?.configured !== true ||
    !Number.isInteger(Number(metadata?.catalogVersion)) ||
    Number(metadata.catalogVersion) < 1
  ) {
    throw smokeError('CHECKOUT_REJECTIONS_DEPENDENCIES_NOT_READY');
  }
  if (
    health?.publicCheckout?.enabled !== true ||
    health?.publicCheckout?.implemented !== true ||
    health?.publicCheckout?.acceptsRealOrders !== true ||
    health?.publicCheckout?.protection?.configured !== true
  ) {
    throw smokeError('PUBLIC_CHECKOUT_MUST_BE_ACTIVE_AND_PROTECTED');
  }

  const artwork = await firstReachableArtwork();
  const driveFileId = identity(artwork);
  const productKey = String(artwork?.productKey || artwork?.product || '50x50').trim();
  const sizeKey = String(artwork?.sizeKey || artwork?.size || 'default').trim();
  if (!driveFileId || !productKey || !sizeKey) {
    throw smokeError('CHECKOUT_REJECTIONS_ARTWORK_CONTRACT_INVALID');
  }

  const missingArtworkId = `missing-${crypto.randomUUID()}`;
  const privateCustomerName = 'Cliente Sintético de Rejeição';
  const privateObservation = 'Não pode chegar ao ledger';
  const baseItem = {
    driveFileId,
    productKey,
    variantKey: 'default',
    sizeKey,
    quantity: 6,
    observacoes: privateObservation
  };
  const requestBody = {
    submissionCreatedAt: new Date().toISOString(),
    seller: { id: 'staging-rejection-seller', label: 'Vendedora Sintética' },
    customer: {
      name: privateCustomerName,
      whatsapp: '(81) 99999-9999'
    },
    items: [baseItem]
  };

  const cases = [
    {
      name: 'MISSING_ARTWORK',
      item: { ...baseItem, driveFileId: missingArtworkId },
      expectedCode: 'ARTWORK_NOT_FOUND',
      expectsItemIndex: false
    },
    {
      name: 'PRODUCT_MISMATCH',
      item: {
        ...baseItem,
        productKey: productKey === 'painel-150' ? '50x50' : 'painel-150'
      },
      expectedCode: 'ARTWORK_PRODUCT_MISMATCH',
      expectsItemIndex: true
    },
    {
      name: 'INVALID_VARIANT',
      item: { ...baseItem, variantKey: 'variante-invalida' },
      expectedCode: 'VARIANT_NOT_ALLOWED',
      expectsItemIndex: true
    },
    {
      name: 'INVALID_QUANTITY',
      item: { ...baseItem, quantity: 4 },
      expectedCode: 'ORDER_QUANTITY_RULES_INVALID',
      expectsItemIndex: false
    }
  ];

  const responses = [];
  const transientRetries = [];
  for (const testCase of cases) {
    const previewResult = await requestExpectedRejection(
      () => postValidation({ items: [testCase.item] }),
      testCase,
      'PREVIEW'
    );
    responses.push(previewResult.result.payload);
    transientRetries.push(previewResult.transientRetries);

    const idempotencyKey = `checkout-rejection-${crypto.randomUUID()}`;
    const submissionResult = await requestExpectedRejection(
      () => postSubmit({
        ...requestBody,
        items: [testCase.item]
      }, idempotencyKey),
      testCase,
      'SUBMIT'
    );
    responses.push(submissionResult.result.payload);
    transientRetries.push(submissionResult.transientRetries);

    assertPrivateValuesAbsent(submissionResult.result.payload, [
      driveFileId,
      missingArtworkId,
      privateCustomerName,
      '81999999999',
      privateObservation,
      idempotencyKey
    ]);
  }

  for (const responsePayload of responses) {
    assertPrivateValuesAbsent(responsePayload, [
      driveFileId,
      missingArtworkId,
      privateCustomerName,
      '81999999999',
      privateObservation
    ]);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    catalogVersion: Number(metadata.catalogVersion),
    missingArtworkRejectedInPreview: true,
    missingArtworkRejectedInSubmit: true,
    productMismatchRejectedInPreview: true,
    productMismatchRejectedInSubmit: true,
    invalidVariantRejectedInPreview: true,
    invalidVariantRejectedInSubmit: true,
    invalidQuantityRejectedInPreview: true,
    invalidQuantityRejectedInSubmit: true,
    transientRetries: transientRetries.reduce((sum, value) => sum + value, 0),
    invalidRequestsReachedLedger: false,
    publicCheckoutEnabled: true,
    publicCheckoutProtected: true,
    privateDataExposed: false,
    productionChanged: false
  })}\n`);
}

async function requestExpectedRejection(operation, testCase, surface) {
  let result;
  let transientRetries = 0;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    result = await operation();
    if (!isTransientResult(result) || attempt === MAX_TRANSIENT_ATTEMPTS) break;
    transientRetries += 1;
    await delay(attempt * 750);
  }

  assertRejected(result, testCase, surface);
  return { result, transientRetries };
}

function isTransientResult(result) {
  if (TRANSIENT_HTTP_STATUSES.has(Number(result?.status))) return true;
  const code = String(result?.payload?.error || '').trim();
  return /(?:TIMEOUT|RPC_FAILED|RPC_5\d\d|NOT_CONFIGURED|WRITES_DISABLED|SERVICE_UNAVAILABLE|TEMPORARILY_UNAVAILABLE)/.test(code);
}

function assertRejected(result, testCase, surface) {
  const status = Number(result?.status || 0);
  const actualCode = publicCode(result?.payload?.error, 'UNKNOWN_ERROR');
  const prefix = `CHECKOUT_${surface}_${testCase.name}`;

  if (status >= 200 && status < 300) {
    throw smokeError(`${prefix}_NOT_REJECTED`);
  }
  if (status !== 422) {
    throw smokeError(`${prefix}_HTTP_${status || 0}`);
  }
  if (result.payload?.ok !== false) {
    throw smokeError(`${prefix}_PAYLOAD_INVALID`);
  }
  if (actualCode !== testCase.expectedCode) {
    throw smokeError(`${prefix}_${actualCode}`.slice(0, 100));
  }

  if (testCase.expectsItemIndex) {
    if (Number(result.payload?.itemIndex) !== 0) {
      throw smokeError(`${prefix}_INDEX_INVALID`);
    }
  } else if (result.payload?.itemIndex !== undefined) {
    throw smokeError(`${prefix}_INDEX_EXPOSED`);
  }
}

function assertPrivateValuesAbsent(payload, values) {
  const serialized = JSON.stringify(payload);
  for (const value of values) {
    const text = String(value || '');
    if (text && serialized.includes(text)) {
      throw smokeError('CHECKOUT_REJECTIONS_RESPONSE_EXPOSED_PRIVATE_DATA');
    }
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

  throw smokeError('CHECKOUT_REJECTIONS_ARTWORK_NOT_REACHABLE');
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
    throw smokeError('CHECKOUT_REJECTIONS_CATALOG_REQUEST_FAILED');
  }
  return result.payload;
}

async function getJson(path) {
  const result = await requestJson(path);
  if (result.status !== 200 || !result.payload) {
    throw smokeError('CHECKOUT_REJECTIONS_DEPENDENCY_FAILED');
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
      throw smokeError('CHECKOUT_REJECTIONS_RESPONSE_TOO_LARGE');
    }

    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) {
      throw smokeError('CHECKOUT_REJECTIONS_RESPONSE_JSON_INVALID');
    }
    return { status: response.status, payload };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 504, payload: { ok: false, error: 'CHECKOUT_REJECTIONS_REQUEST_TIMEOUT' } };
    }
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

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
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
    'STAGING_CHECKOUT_REJECTIONS_SMOKE_FAILED'
  ));
  process.exitCode = 1;
});
