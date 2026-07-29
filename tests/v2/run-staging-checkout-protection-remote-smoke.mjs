import { waitForStagingCheckoutProtection } from './wait-for-staging-checkout-protection.mjs';

const STAGING_URL = normalizeOrigin(process.env.STAGING_URL);
const STAGING_API_TOKEN = String(process.env.SITE_V2_STAGING_API_TOKEN || '').trim();
const PROTECTION_ROUTE = '/internal/v2/checkout/protection';

async function main() {
  if (STAGING_API_TOKEN.length < 32) {
    throw smokeError('SITE_V2_STAGING_API_TOKEN_MISSING_OR_SHORT');
  }

  const health = await waitForStagingCheckoutProtection({
    request: async () => requestJson('/health')
  });
  const protection = health.publicCheckout.protection;

  const privateKey = `protection-private-${crypto.randomUUID()}`;
  const privateBody = 'conteudo-privado-nao-lido';
  const valid = await postProbe({
    origin: STAGING_URL,
    fetchSite: 'same-origin',
    idempotencyKey: privateKey,
    body: privateBody
  });
  if (
    valid.status !== 200 ||
    valid.payload?.ok !== true ||
    valid.payload?.dryRun !== true ||
    valid.payload?.writesPerformed !== false ||
    valid.payload?.originAllowed !== true ||
    valid.payload?.rateLimitApplied !== true ||
    protection.configured !== true
  ) {
    throw smokeError('PUBLIC_CHECKOUT_PROTECTION_VALID_REQUEST_FAILED');
  }

  const missingToken = await requestJson(PROTECTION_ROUTE, {
    method: 'POST',
    headers: validHeaders({
      origin: STAGING_URL,
      idempotencyKey: `missing-token-${crypto.randomUUID()}`,
      includeToken: false
    })
  });
  assertError(missingToken, 401, 'STAGING_TOKEN_INVALID', 'PUBLIC_CHECKOUT_PROTECTION_TOKEN_NOT_REQUIRED');

  const missingOrigin = await postProbe({
    origin: '',
    idempotencyKey: `missing-origin-${crypto.randomUUID()}`
  });
  assertError(
    missingOrigin,
    403,
    'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED',
    'PUBLIC_CHECKOUT_PROTECTION_MISSING_ORIGIN_NOT_REJECTED'
  );

  const crossOriginValue = 'https://origem-invalida.example';
  const crossOrigin = await postProbe({
    origin: crossOriginValue,
    fetchSite: 'cross-site',
    idempotencyKey: `cross-origin-${crypto.randomUUID()}`
  });
  assertError(
    crossOrigin,
    403,
    'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED',
    'PUBLIC_CHECKOUT_PROTECTION_CROSS_ORIGIN_NOT_REJECTED'
  );

  const invalidContent = await requestJson(PROTECTION_ROUTE, {
    method: 'POST',
    headers: validHeaders({
      origin: STAGING_URL,
      contentType: 'text/plain',
      idempotencyKey: `invalid-content-${crypto.randomUUID()}`
    })
  });
  assertError(
    invalidContent,
    415,
    'CONTENT_TYPE_NOT_JSON',
    'PUBLIC_CHECKOUT_PROTECTION_CONTENT_TYPE_NOT_REJECTED'
  );

  const invalidKey = await postProbe({
    origin: STAGING_URL,
    idempotencyKey: 'curta'
  });
  assertError(
    invalidKey,
    422,
    'IDEMPOTENCY_KEY_INVALID',
    'PUBLIC_CHECKOUT_PROTECTION_IDEMPOTENCY_NOT_REJECTED'
  );

  const publicMissingOrigin = await requestJson('/api/orders/v2', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `public-missing-origin-${crypto.randomUUID()}`
    },
    body: JSON.stringify({ private: privateBody })
  });
  assertError(
    publicMissingOrigin,
    403,
    'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED',
    'PUBLIC_CHECKOUT_PROTECTION_PUBLIC_ORIGIN_NOT_REJECTED'
  );

  for (const response of [
    valid,
    missingToken,
    missingOrigin,
    crossOrigin,
    invalidContent,
    invalidKey,
    publicMissingOrigin
  ]) {
    const serialized = JSON.stringify(response.payload);
    for (const privateValue of [privateKey, privateBody, crossOriginValue, STAGING_API_TOKEN]) {
      if (serialized.includes(privateValue)) {
        throw smokeError('PUBLIC_CHECKOUT_PROTECTION_RESPONSE_EXPOSED_PRIVATE_DATA');
      }
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    protectionConfigured: true,
    stableHealthResponses: 3,
    tokenRequired: true,
    allowedOriginAccepted: true,
    missingOriginRejected: true,
    crossOriginRejected: true,
    contentTypeRejected: true,
    invalidIdempotencyRejected: true,
    rateLimitBindingApplied: true,
    publicCheckoutEnabled: true,
    publicRouteMissingOriginRejected: true,
    writesPerformed: false,
    privateDataExposed: false,
    productionChanged: false
  })}\n`);
}

async function postProbe(options = {}) {
  return requestJson(PROTECTION_ROUTE, {
    method: 'POST',
    headers: validHeaders(options),
    ...(options.body !== undefined ? { body: String(options.body) } : {})
  });
}

function validHeaders(options = {}) {
  const headers = {
    'content-type': options.contentType || 'application/json',
    'idempotency-key': options.idempotencyKey || `protection-${crypto.randomUUID()}`,
    'sec-fetch-site': options.fetchSite || 'same-origin'
  };
  if (options.origin) headers.origin = options.origin;
  if (options.includeToken !== false) headers['x-staging-token'] = STAGING_API_TOKEN;
  return headers;
}

function assertError(result, status, code, failureCode) {
  if (
    result.status !== status ||
    result.payload?.ok !== false ||
    result.payload?.error !== code
  ) {
    throw smokeError(failureCode);
  }
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
    if (new TextEncoder().encode(text).byteLength > 1024 * 1024) {
      throw smokeError('PUBLIC_CHECKOUT_PROTECTION_RESPONSE_TOO_LARGE');
    }

    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) {
      throw smokeError('PUBLIC_CHECKOUT_PROTECTION_RESPONSE_JSON_INVALID');
    }
    return { status: response.status, payload };
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw smokeError('PUBLIC_CHECKOUT_PROTECTION_REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
    'STAGING_CHECKOUT_PROTECTION_SMOKE_FAILED'
  ));
  process.exitCode = 1;
});
