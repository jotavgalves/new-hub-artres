const base = String(process.env.STAGING_URL || '').replace(/\/$/, '');
const token = String(process.env.SITE_V2_STAGING_API_TOKEN || '');
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || '1');
const idempotencyKey = `synthetic-deploy-${runId}-${runAttempt}`;
const submissionCreatedAt = new Date().toISOString();

if (!base.startsWith('https://')) throw new Error('STAGING_URL_INVALID');
if (token.length < 32) throw new Error('SITE_V2_STAGING_API_TOKEN_MISSING_OR_SHORT');

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function assert(condition, code, details = null) {
  if (condition) return;
  const suffix = details ? `:${JSON.stringify(details)}` : '';
  throw new Error(`${code}${suffix}`);
}

function safeCode(value) {
  return String(value || 'NONE').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 100) || 'NONE';
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`INVALID_JSON_RESPONSE_${response.status}`);
  }
}

function requestHeaders(label, options, attempt) {
  return {
    ...(options.headers || {}),
    'Cache-Control': 'no-cache',
    'X-Request-Id': `${label.toLowerCase()}-${runId}-${runAttempt}-${attempt}`
  };
}

async function fetchJson(label, url, options = {}, retry = {}) {
  const maxAttempts = Number(retry.maxAttempts || 1);
  const delayMs = Number(retry.delayMs || 2000);
  const transientErrors = new Set(retry.transientErrors || []);
  const transientStatuses = new Set(retry.transientStatuses || []);
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: requestHeaders(label, options, attempt)
    });
    const payload = await readJson(response);
    last = { response, payload, attempt };

    const transient =
      transientStatuses.has(response.status) ||
      (response.status === 503 && transientErrors.has(payload?.error));
    if (!transient || attempt === maxAttempts) return last;

    console.log(JSON.stringify({
      level: 'info',
      event: 'staging-rollout-transient-retry',
      label,
      attempt,
      status: response.status,
      error: payload?.error,
      requestId: payload?.requestId || ''
    }));
    await sleep(delayMs);
  }

  return last;
}

async function fetchText(label, url, options = {}, retry = {}) {
  const maxAttempts = Number(retry.maxAttempts || 1);
  const delayMs = Number(retry.delayMs || 2000);
  const transientStatuses = new Set(retry.transientStatuses || []);
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: requestHeaders(label, options, attempt)
    });
    const text = await response.text();
    last = { response, text, attempt };

    if (!transientStatuses.has(response.status) || attempt === maxAttempts) return last;

    console.log(JSON.stringify({
      level: 'info',
      event: 'staging-rollout-static-retry',
      label,
      attempt,
      status: response.status
    }));
    await sleep(delayMs);
  }

  return last;
}

function statusError(label, result) {
  return `${label}_STATUS_${result.response.status}_ERROR_${safeCode(result.payload?.error)}`;
}

async function waitForStableActiveDeployment() {
  let consecutive = 0;
  let last = null;

  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const result = await fetchJson(
      'HEALTH',
      `${base}/health?rolloutProbe=${encodeURIComponent(`${runId}-${runAttempt}-${attempt}`)}`,
      { headers: { Accept: 'application/json' } }
    );
    last = result;

    const active =
      result.response.status === 200 &&
      result.payload?.ok === true &&
      result.payload?.writesEnabled === true &&
      result.payload?.lowLevelLedgerEnabled === false &&
      result.payload?.catalog === 'synthetic-staging-only' &&
      result.payload?.catalogVersion === 9001 &&
      result.payload?.commercialConfig?.enabled === true;

    consecutive = active ? consecutive + 1 : 0;
    if (consecutive >= 3) return result.payload;
    await sleep(2000);
  }

  throw new Error(`SYNTHETIC_HEALTH_NOT_STABLE:${JSON.stringify({
    status: last?.response?.status,
    error: last?.payload?.error,
    writesEnabled: last?.payload?.writesEnabled,
    lowLevelLedgerEnabled: last?.payload?.lowLevelLedgerEnabled,
    catalog: last?.payload?.catalog,
    catalogVersion: last?.payload?.catalogVersion,
    commercialConfig: last?.payload?.commercialConfig?.enabled
  })}`);
}

const rolloutRetry = {
  maxAttempts: 30,
  delayMs: 2000,
  transientStatuses: [404]
};

const health = await waitForStableActiveDeployment();

const adminPageResult = await fetchText(
  'ADMIN_PAGE',
  `${base}/admin?rolloutProbe=${encodeURIComponent(`${runId}-${runAttempt}`)}`,
  { headers: { Accept: 'text/html' } },
  rolloutRetry
);
assert(adminPageResult.response.status === 200, `ADMIN_PAGE_STATUS_${adminPageResult.response.status}`);
assert(String(adminPageResult.response.headers.get('content-type') || '').includes('text/html'), 'ADMIN_PAGE_CONTENT_TYPE_INVALID');
assert(adminPageResult.text.includes('Pedidos sintéticos'), 'ADMIN_PAGE_TITLE_MISSING');
assert(adminPageResult.text.includes('SOMENTE LEITURA'), 'ADMIN_PAGE_READONLY_BADGE_MISSING');
assert(!adminPageResult.text.includes(token), 'ADMIN_PAGE_TOKEN_EXPOSED');

const body = {
  submissionCreatedAt,
  seller: { id: 'ci-staging', label: 'CI Staging' },
  customer: { name: 'Cliente Sintético do Deploy', whatsapp: '5581999999999' },
  items: [{
    driveFileId: 'staging-artwork-2657',
    productKey: '50x50',
    variantKey: 'default',
    sizeKey: '50x50',
    quantity: 6,
    unitPrice: 0.01,
    lineSubtotal: 0.06
  }],
  totals: { subtotal: 0.06, total: 0.06 }
};

const writeHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Staging-Token': token,
  'Idempotency-Key': idempotencyKey
};

const transientWriteRetry = {
  maxAttempts: 30,
  delayMs: 2000,
  transientErrors: ['STAGING_WRITES_DISABLED']
};

const firstResult = await fetchJson(
  'FIRST_SUBMISSION',
  `${base}/internal/v2/orders/submit`,
  { method: 'POST', headers: writeHeaders, body: JSON.stringify(body) },
  transientWriteRetry
);
const first = firstResult.payload;
assert(firstResult.response.status === 201, statusError('FIRST_SUBMISSION', firstResult), first);
assert(first?.ok === true && first?.action === 'CREATED' && first?.replayed === false, 'FIRST_SUBMISSION_INVALID', first);
assert(/^PED\d{7}[A-Z]$/.test(String(first?.orderNumber || '')), 'ORDER_NUMBER_INVALID', first);
assert(first?.pricing?.total === 58.5, 'SERVER_TOTAL_INVALID', first?.pricing);
assert(first?.itemCount === 1, 'ITEM_COUNT_INVALID', first);
assert(first?.warnings?.includes('CLIENT_ITEM_PRICE_IGNORED'), 'CLIENT_PRICE_WARNING_MISSING', first?.warnings);
assert(first?.warnings?.includes('CLIENT_ORDER_TOTALS_IGNORED'), 'CLIENT_TOTAL_WARNING_MISSING', first?.warnings);

const replayResult = await fetchJson(
  'REPLAY',
  `${base}/internal/v2/orders/submit`,
  { method: 'POST', headers: writeHeaders, body: JSON.stringify(body) },
  transientWriteRetry
);
const replay = replayResult.payload;
assert(replayResult.response.status === 200, statusError('REPLAY', replayResult), replay);
assert(replay?.ok === true && replay?.action === 'REPLAY' && replay?.replayed === true, 'REPLAY_INVALID', replay);
assert(replay?.orderNumber === first.orderNumber, 'REPLAY_ORDER_NUMBER_CHANGED', { first, replay });
assert(replay?.pricing?.total === first.pricing.total, 'REPLAY_TOTAL_CHANGED', { first, replay });

const orderResult = await fetchJson(
  'ORDER_INSPECTION',
  `${base}/internal/v2/ledger/order?number=${encodeURIComponent(first.orderNumber)}&createdAt=${encodeURIComponent(submissionCreatedAt)}`,
  { headers: { Accept: 'application/json', 'X-Staging-Token': token } }
);
assert(orderResult.response.status === 200, statusError('ORDER_INSPECTION', orderResult), orderResult.payload);
assert(orderResult.payload?.order?.customer?.redacted === true, 'CUSTOMER_MUST_BE_REDACTED', orderResult.payload);
assert(orderResult.payload?.order?.pricing?.total === 58.5, 'ORDER_TOTAL_INVALID', orderResult.payload?.order?.pricing);
const commercialConfigVersion = orderResult.payload?.order?.integrity?.configVersion;
assert(Number.isInteger(commercialConfigVersion) && commercialConfigVersion > 0, 'ORDER_CONFIG_VERSION_INVALID', orderResult.payload?.order?.integrity);
assert(orderResult.payload?.order?.items?.[0]?.driveFileId === 'staging-artwork-2657', 'SYNTHETIC_ARTWORK_INVALID', orderResult.payload?.order?.items);

const outboxResult = await fetchJson(
  'OUTBOX_INSPECTION',
  `${base}/internal/v2/ledger/outbox?createdAt=${encodeURIComponent(submissionCreatedAt)}&number=${encodeURIComponent(first.orderNumber)}`,
  { headers: { Accept: 'application/json', 'X-Staging-Token': token } }
);
assert(outboxResult.response.status === 200, statusError('OUTBOX', outboxResult), outboxResult.payload);
const event = outboxResult.payload?.events?.find(entry => entry.aggregateId === first.orderNumber);
assert(event?.eventType === 'order.created.v2', 'OUTBOX_EVENT_NOT_FOUND', outboxResult.payload);
assert(event?.payload?.order?.customer?.redacted === true, 'OUTBOX_CUSTOMER_MUST_BE_REDACTED', event);

const adminResult = await fetchJson(
  'ADMIN_ORDERS',
  `${base}/internal/v2/admin/orders?limit=100`,
  { headers: { Accept: 'application/json', 'X-Staging-Token': token } },
  rolloutRetry
);
assert(adminResult.response.status === 200, statusError('ADMIN_ORDERS', adminResult), adminResult.payload);
assert(adminResult.payload?.ok === true && adminResult.payload?.readOnly === true, 'ADMIN_READONLY_INVALID', adminResult.payload);
assert(adminResult.payload?.catalog === 'synthetic-staging-only', 'ADMIN_CATALOG_INVALID', adminResult.payload);
assert(adminResult.payload?.catalogVersion === 9001, 'ADMIN_CATALOG_VERSION_INVALID', adminResult.payload);
const adminOrder = adminResult.payload?.orders?.find(order => order.orderNumber === first.orderNumber);
assert(adminOrder?.customer?.redacted === true, 'ADMIN_CUSTOMER_MUST_BE_REDACTED', adminOrder);
assert(adminOrder?.pricing?.total === 58.5, 'ADMIN_ORDER_TOTAL_INVALID', adminOrder);
const serializedAdmin = JSON.stringify(adminResult.payload);
assert(!serializedAdmin.includes(body.customer.name), 'ADMIN_CUSTOMER_NAME_EXPOSED');
assert(!serializedAdmin.includes(body.customer.whatsapp), 'ADMIN_CUSTOMER_PHONE_EXPOSED');

const adminPostResult = await fetchJson(
  'ADMIN_POST_GUARD',
  `${base}/internal/v2/admin/orders`,
  {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Staging-Token': token
    },
    body: '{}'
  },
  rolloutRetry
);
assert(adminPostResult.response.status === 405, statusError('ADMIN_POST_GUARD', adminPostResult), adminPostResult.payload);
assert(adminPostResult.payload?.error === 'METHOD_NOT_ALLOWED', 'ADMIN_POST_NOT_BLOCKED', adminPostResult.payload);

const lowLevelResult = await fetchJson(
  'LOW_LEVEL_LEDGER',
  `${base}/internal/v2/ledger/submit`,
  {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Staging-Token': token
    },
    body: '{}'
  },
  transientWriteRetry
);
assert(lowLevelResult.response.status === 503, statusError('LOW_LEVEL', lowLevelResult), lowLevelResult.payload);
assert(lowLevelResult.payload?.error === 'LOW_LEVEL_LEDGER_DISABLED', 'LOW_LEVEL_LEDGER_NOT_BLOCKED', lowLevelResult.payload);

console.log(JSON.stringify({
  ok: true,
  rolloutStable: true,
  healthRequestId: health.requestId,
  adminPage: true,
  adminReadOnly: adminResult.payload.readOnly,
  commercialConfigVersion,
  orderNumber: first.orderNumber,
  action: first.action,
  replayAction: replay.action,
  total: first.pricing.total,
  customerRedacted: orderResult.payload.order.customer.redacted,
  adminCustomerRedacted: adminOrder.customer.redacted,
  outboxEventType: event.eventType,
  lowLevelLedgerError: lowLevelResult.payload.error
}, null, 2));
