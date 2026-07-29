const DEFAULT_ATTEMPTS = 90;
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_STABLE_RESPONSES = 3;

export async function waitForStagingCheckoutProtection(options = {}) {
  const request = options.request;
  if (typeof request !== 'function') {
    throw waitError('PUBLIC_CHECKOUT_PROTECTION_REQUEST_REQUIRED');
  }

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
  let lastCode = 'PUBLIC_CHECKOUT_PROTECTION_EDGE_NOT_READY';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let result;
    try {
      result = await request({ attempt });
    } catch (error) {
      stable = 0;
      lastCode = publicCode(
        error?.code || error?.message,
        'PUBLIC_CHECKOUT_PROTECTION_REQUEST_FAILED'
      );
      if (attempt < attempts) await sleep(intervalMs);
      continue;
    }

    const validation = validateStagingCheckoutProtection(result);
    if (validation.ok) {
      stable += 1;
      if (stable >= stableResponses) return result.payload;
    } else {
      stable = 0;
      lastCode = validation.code;
      if (validation.terminal) throw waitError(lastCode);
    }

    if (attempt < attempts) await sleep(intervalMs);
  }

  throw waitError(lastCode);
}

export function validateStagingCheckoutProtection(result) {
  const status = Number(result?.status || 0);
  const payload = result?.payload;

  if (status === 401 || status === 403) {
    return {
      ok: false,
      terminal: true,
      code: 'PUBLIC_CHECKOUT_PROTECTION_HEALTH_AUTH_FAILED'
    };
  }

  if (status !== 200) {
    return {
      ok: false,
      terminal: status >= 400 && status < 500 && status !== 404,
      code: status === 404 || status >= 500
        ? 'PUBLIC_CHECKOUT_PROTECTION_EDGE_NOT_READY'
        : 'PUBLIC_CHECKOUT_PROTECTION_HEALTH_HTTP_INVALID'
    };
  }

  if (payload?.ok !== true) {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_PROTECTION_HEALTH_NOT_READY'
    };
  }

  const checkout = payload?.publicCheckout;
  if (!checkout || typeof checkout !== 'object') {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_PROTECTION_CONTRACT_NOT_READY'
    };
  }

  if (
    checkout.enabled !== true ||
    checkout.implemented !== true ||
    checkout.acceptsRealOrders !== true
  ) {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_PROTECTION_ACTIVE_STATE_NOT_READY'
    };
  }

  const protection = checkout.protection;
  if (!protection || typeof protection !== 'object') {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_PROTECTION_CONTRACT_NOT_READY'
    };
  }

  if (protection.requiresOrigin !== true) {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_ORIGIN_GUARD_NOT_READY'
    };
  }

  if (Number(protection.allowedOriginCount) < 1) {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_ORIGIN_CONFIG_NOT_READY'
    };
  }

  if (protection.rateLimiterConfigured !== true) {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_RATE_LIMIT_BINDING_NOT_READY'
    };
  }

  if (protection.configured !== true) {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_PROTECTION_CONFIG_NOT_READY'
    };
  }

  if (protection.keyStrategy !== 'route-and-idempotency-sha256') {
    return {
      ok: false,
      terminal: false,
      code: 'PUBLIC_CHECKOUT_RATE_LIMIT_KEY_STRATEGY_NOT_READY'
    };
  }

  return {
    ok: true,
    terminal: false,
    code: 'PUBLIC_CHECKOUT_PROTECTION_READY'
  };
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
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
