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

async function fetchJson(label, url, options = {}, retry = {}) {
  const maxAttempts = Number(retry.maxAttempts || 1);
  const delayMs = Number(retry.delayMs || 2000);
  const transientErrors = new Set(retry.transientErrors || []);
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Cache-Control': 'no-cache',
        'X-Request-Id': `${label.toLowerCase()}-${runId}-${runAttempt}-${attempt}`
      }
    });
    const payload = await readJson(response);
    last = { response, payload, attempt };

    const transient = response.status === 503 && transientErrors.has(payload?.error);
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
      result.payload?.catalogVersion === 9001;

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
    catalogVersion: last?.payload?.catalogVersion
  })}`);
}

const health = await waitForStableActiveDeployment();

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
assert(first?.warnings?.includes('CLIENT_ITEM_PRICE_IGNORED:staging-artwork-2657'), 'CLIENT_PRICE_WARNING_MISSING', first?.warnings);
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

const orderResult = await fetchJson(
  'ORDER_INSPECTION',
  `${base}/internal/v2/ledger/order?number=${encodeURIComponent(first.orderNumber)}&createdAt=${encodeURIComponent(submissionCreatedAt)}`,
  { headers: { Accept: 'application/json', 'X-Staging-Token': token } }
);
assert(orderResult.response.status === 200, statusError('ORDER_INSPECTION', orderResult), orderResult.payload);
assert(orderResult.payload?.order?.customer?.redacted === true, 'CUSTOMER_MUST_BE_REDACTED', orderResult.payload);
assert(orderResult.payload?.order?.pricing?.total === 58.5, 'ORDER_TOTAL_INVALID', orderResult.payload?.order?.pricing);
assert(orderResult.payload?.order?.items?.[0]?.driveFileId === 'staging-artwork-2657', 'SYNTHETIC_ARTWORK_INVALID', orderResult.payload?.order?.items);

const outboxResult = await fetchJson(
  'OUTBOX_INSPECTION',
  `${base}/internal/v2/ledger/outbox?createdAt=${encodeURIComponent(submissionCreatedAt)}`,
  { headers: { Accept: 'application/json', 'X-Staging-Token': token } }
);
assert(outboxResult.response.status === 200, statusError('OUTBOX', outboxResult), outboxResult.payload);
const event = outboxResult.payload?.events?.find(entry => entry.aggregateId === first.orderNumber);
assert(event?.eventType === 'order.created.v2', 'OUTBOX_EVENT_NOT_FOUND', outboxResult.payload);
assert(event?.payload?.order?.customer?.redacted === true, 'OUTBOX_CUSTOMER_MUST_BE_REDACTED', event);

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
  orderNumber: first.orderNumber,
  action: first.action,
  replayAction: replay.action,
  total: first.pricing.total,
  customerRedacted: orderResult.payload.order.customer.redacted,
  outboxEventType: event.eventType,
  lowLevelLedgerError: lowLevelResult.payload.error
}, null, 2));
