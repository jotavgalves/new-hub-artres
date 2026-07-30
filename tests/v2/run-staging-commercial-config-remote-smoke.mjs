const base = normalizeOrigin(process.env.STAGING_URL);
const token = String(process.env.SITE_V2_STAGING_API_TOKEN || '').trim();
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || '1');

if (token.length < 32) throw smokeError('SITE_V2_STAGING_API_TOKEN_MISSING_OR_SHORT');

const publicResult = await fetchJson('COMMERCIAL_PUBLIC', `${base}/api/commercial-config`);
assert(publicResult.response.status === 200, 'COMMERCIAL_PUBLIC_STATUS_INVALID');
assert(publicResult.payload?.ok === true, 'COMMERCIAL_PUBLIC_PAYLOAD_INVALID');
const config = publicResult.payload.config;
assert(config?.schemaVersion === 1, 'COMMERCIAL_SCHEMA_VERSION_INVALID');
assert(Number.isInteger(config?.version) && config.version > 0, 'COMMERCIAL_VERSION_INVALID');
assert(config?.currency === 'BRL', 'COMMERCIAL_CURRENCY_INVALID');
assertPublicProduct(config?.products?.['50x50'], '50x50', 'cart-product-total');
assertPublicProduct(config?.products?.['painel-150'], 'painel-150', 'item');
assert(!JSON.stringify(config).includes('updatedBy'), 'COMMERCIAL_PUBLIC_ACTOR_EXPOSED');

const unauthorized = await fetchJson(
  'COMMERCIAL_ADMIN_UNAUTHORIZED',
  `${base}/internal/v2/admin/commercial-config`
);
assert(unauthorized.response.status === 401, 'COMMERCIAL_ADMIN_UNAUTHORIZED_STATUS_INVALID');
assert(unauthorized.payload?.error === 'STAGING_TOKEN_INVALID', 'COMMERCIAL_ADMIN_UNAUTHORIZED_ERROR_INVALID');

const adminResult = await fetchJson(
  'COMMERCIAL_ADMIN_READ',
  `${base}/internal/v2/admin/commercial-config?history=10`,
  { headers: { 'X-Staging-Token': token } }
);
assert(adminResult.response.status === 200, 'COMMERCIAL_ADMIN_STATUS_INVALID');
assert(adminResult.payload?.ok === true && adminResult.payload?.versioned === true, 'COMMERCIAL_ADMIN_PAYLOAD_INVALID');
assert(adminResult.payload?.config?.version === config.version, 'COMMERCIAL_PUBLIC_ADMIN_VERSION_MISMATCH');
assert(Array.isArray(adminResult.payload?.history) && adminResult.payload.history.length >= 1, 'COMMERCIAL_HISTORY_MISSING');

const pageResult = await fetchText('COMMERCIAL_ADMIN_PAGE', `${base}/admin/commercial`);
assert(pageResult.response.status === 200, 'COMMERCIAL_ADMIN_PAGE_STATUS_INVALID');
assert(pageResult.text.includes('Configuração comercial'), 'COMMERCIAL_ADMIN_PAGE_TITLE_MISSING');
assert(pageResult.text.includes('/admin/commercial/app.js'), 'COMMERCIAL_ADMIN_PAGE_SCRIPT_MISSING');
assert(!pageResult.text.includes(token), 'COMMERCIAL_ADMIN_PAGE_TOKEN_EXPOSED');

const scriptResult = await fetchText('COMMERCIAL_ASSET', `${base}/assets/v2-commercial-config.js`);
assert(scriptResult.response.status === 200, 'COMMERCIAL_ASSET_STATUS_INVALID');
assert(scriptResult.text.includes('site-v2-commercial-config-v1'), 'COMMERCIAL_ASSET_MARKER_MISSING');
assert(scriptResult.text.includes('/api/commercial-config'), 'COMMERCIAL_ASSET_ENDPOINT_MISSING');

const rootResult = await fetchText('COMMERCIAL_ROOT', `${base}/`);
assert(rootResult.response.status === 200, 'COMMERCIAL_ROOT_STATUS_INVALID');
assert(rootResult.text.includes('./assets/v2-commercial-config.js'), 'COMMERCIAL_ROOT_ASSET_MISSING');
assert(rootResult.text.includes('await SiteV2CommercialConfig.start'), 'COMMERCIAL_ROOT_STARTUP_MISSING');
assert(rootResult.text.indexOf('await SiteV2CommercialConfig.start') < rootResult.text.indexOf('SiteV2ProductWorkspaces.start'), 'COMMERCIAL_STARTUP_ORDER_INVALID');

console.log(JSON.stringify({
  ok: true,
  commercialConfigVersion: config.version,
  publicAndAdminAligned: true,
  products: ['50x50', 'painel-150'],
  adminPage: true,
  writePerformed: false,
  productionChanged: false
}));

function assertPublicProduct(product, key, scope) {
  assert(product?.key === key, `COMMERCIAL_PRODUCT_KEY_INVALID_${key}`);
  assert(product?.enabled === true || product?.enabled === false, `COMMERCIAL_PRODUCT_ENABLED_INVALID_${key}`);
  assert(Number.isFinite(product?.unitPrice) && product.unitPrice >= 0, `COMMERCIAL_PRODUCT_PRICE_INVALID_${key}`);
  assert(Number.isInteger(product?.quantity?.minimum) && product.quantity.minimum > 0, `COMMERCIAL_PRODUCT_MINIMUM_INVALID_${key}`);
  assert(Number.isInteger(product?.quantity?.step) && product.quantity.step > 0, `COMMERCIAL_PRODUCT_STEP_INVALID_${key}`);
  assert(Number.isInteger(product?.quantity?.initial) && product.quantity.initial >= product.quantity.minimum, `COMMERCIAL_PRODUCT_INITIAL_INVALID_${key}`);
  assert(product?.quantity?.scope === scope, `COMMERCIAL_PRODUCT_SCOPE_INVALID_${key}`);
}

async function fetchJson(label, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: requestHeaders(label, options.headers),
    cache: 'no-store',
    redirect: 'error'
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { throw smokeError(`${label}_JSON_INVALID`); }
  return { response, payload };
}

async function fetchText(label, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: requestHeaders(label, options.headers),
    cache: 'no-store',
    redirect: 'error'
  });
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) throw smokeError(`${label}_RESPONSE_TOO_LARGE`);
  return { response, text };
}

function requestHeaders(label, values = {}) {
  return {
    Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
    ...values,
    'X-Request-Id': `${label.toLowerCase()}-${runId}-${runAttempt}`
  };
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw smokeError('STAGING_URL_INVALID'); }
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
