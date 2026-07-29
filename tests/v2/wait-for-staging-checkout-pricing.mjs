const DEFAULT_ATTEMPTS = 90;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_STABLE_RESPONSES = 3;

export async function waitForStagingCheckoutPricing(options = {}) {
  const request = options.request;
  if (typeof request !== 'function') throw waitError('CHECKOUT_PRICING_REQUEST_REQUIRED');

  const expectedCatalogVersion = positiveInteger(options.expectedCatalogVersion);
  if (!expectedCatalogVersion) throw waitError('CHECKOUT_PRICING_EXPECTED_VERSION_INVALID');

  const attempts = boundedInteger(options.attempts, 1, 300, DEFAULT_ATTEMPTS);
  const intervalMs = boundedInteger(options.intervalMs, 0, 10000, DEFAULT_INTERVAL_MS);
  const stableResponses = boundedInteger(
    options.stableResponses,
    1,
    10,
    DEFAULT_STABLE_RESPONSES
  );
  const sleep = options.sleep || defaultSleep;

  let stable = 0;
  let lastCode = 'CHECKOUT_PRICING_NOT_PROPAGATED';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let result;
    try {
      result = await request({ attempt });
    } catch (error) {
      stable = 0;
      lastCode = publicCode(error?.code || error?.message, 'CHECKOUT_PRICING_REQUEST_FAILED');
      if (attempt < attempts) await sleep(intervalMs);
      continue;
    }

    const validation = validateStagingCheckoutPricing(result, expectedCatalogVersion);
    if (validation.ok) {
      stable += 1;
      if (stable >= stableResponses) return result;
    } else {
      stable = 0;
      lastCode = validation.code;
      if (validation.terminal) throw waitError(lastCode);
    }

    if (attempt < attempts) await sleep(intervalMs);
  }

  const error = waitError('CHECKOUT_PRICING_PROPAGATION_TIMEOUT');
  error.lastCode = lastCode;
  throw error;
}

export function validateStagingCheckoutPricing(result, expectedCatalogVersion) {
  const status = Number(result?.status || 0);
  const payload = result?.payload;

  if (status === 401 || status === 403) {
    return { ok: false, terminal: true, code: 'CHECKOUT_PRICING_AUTH_FAILED' };
  }
  if (status !== 200) {
    return {
      ok: false,
      terminal: false,
      code: status >= 500 || status === 404
        ? 'CHECKOUT_PRICING_EDGE_NOT_READY'
        : 'CHECKOUT_PRICING_HTTP_INVALID'
    };
  }

  if (
    payload?.ok !== true ||
    payload?.dryRun !== true ||
    payload?.writesPerformed !== false ||
    payload?.authoritativePricing !== true
  ) {
    return { ok: false, terminal: false, code: 'CHECKOUT_PRICING_CONTRACT_NOT_READY' };
  }

  if (
    Number(payload.catalogVersion) !== expectedCatalogVersion ||
    Number(payload?.pricing?.catalogVersion) !== expectedCatalogVersion
  ) {
    return { ok: false, terminal: false, code: 'CHECKOUT_PRICING_VERSION_NOT_READY' };
  }

  if (
    payload?.pricing?.currency !== 'BRL' ||
    Number(payload?.pricing?.itemCount) !== 1 ||
    Number(payload?.pricing?.quantity) !== 6 ||
    Number(payload?.pricing?.subtotal) !== 58.5 ||
    Number(payload?.pricing?.discountPercent) !== 0 ||
    Number(payload?.pricing?.discountAmount) !== 0 ||
    Number(payload?.pricing?.total) !== 58.5 ||
    payload?.pricing?.clientValuesIgnored !== true
  ) {
    return { ok: false, terminal: false, code: 'CHECKOUT_PRICING_VALUES_NOT_READY' };
  }

  if (
    !Array.isArray(payload.warnings) ||
    !payload.warnings.includes('CLIENT_ITEM_PRICE_IGNORED') ||
    !payload.warnings.includes('CLIENT_ORDER_TOTALS_IGNORED')
  ) {
    return { ok: false, terminal: false, code: 'CHECKOUT_PRICING_WARNINGS_NOT_READY' };
  }

  const draft = payload?.orderDraft;
  if (
    payload?.canonicalDraftReady !== true ||
    draft?.schemaVersion !== 2 ||
    draft?.status !== 'Novo' ||
    draft?.sellerPresent !== true ||
    draft?.customerNamePresent !== true ||
    draft?.customerWhatsappPresent !== true ||
    Number(draft?.itemCount) !== 1 ||
    Number(draft?.quantity) !== 6 ||
    Number(draft?.catalogVersion) !== expectedCatalogVersion ||
    Number(draft?.detailsItemCount) !== 1 ||
    Number(draft?.measurementsItemCount) !== 1 ||
    Number(draft?.observationsItemCount) !== 1 ||
    Number(draft?.personalizationItemCount) !== 1 ||
    draft?.canonicalFingerprintReady !== true ||
    draft?.idempotencyStorageKeyReady !== true
  ) {
    return { ok: false, terminal: false, code: 'CHECKOUT_CANONICAL_DRAFT_NOT_READY' };
  }

  return { ok: true, terminal: false, code: 'CHECKOUT_PRICING_READY' };
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function publicCode(value, fallback) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
