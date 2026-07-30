const workerBase = String(process.env.STAGING_URL || '').replace(/\/$/, '');
const workerToken = String(process.env.SITE_V2_STAGING_API_TOKEN || '');
const supabaseBase = String(process.env.SUPABASE_V2_URL || '').replace(/\/$/, '');
const serviceRoleKey = String(process.env.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY || '');
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || '1');
const idempotencyKey = `synthetic-shadow-${runId}-${runAttempt}`;
const submissionCreatedAt = new Date().toISOString();
const MAX_RESPONSE_BYTES = 64 * 1024;
const ORDER_LIST_LIMIT = 20;

if (!workerBase.startsWith('https://')) throw new Error('STAGING_URL_INVALID');
if (workerToken.length < 32) throw new Error('SITE_V2_STAGING_API_TOKEN_MISSING_OR_SHORT');
if (supabaseBase !== 'https://kueklnkznwpbobqwugns.supabase.co') {
  throw new Error('SUPABASE_V2_URL_INVALID');
}
if (serviceRoleKey.length < 32) {
  throw new Error('SUPABASE_V2_STAGING_SERVICE_ROLE_KEY_MISSING_OR_SHORT');
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function assert(condition, code, details = null) {
  if (condition) return;
  const suffix = details ? `:${JSON.stringify(details)}` : '';
  throw new Error(`${code}${suffix}`);
}

function safeCode(value) {
  return String(value || 'NONE').replace(/[^A-Za-z0-9_:-]/g, '').slice(0, 100) || 'NONE';
}

async function readLimitedJson(response) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`REMOTE_RESPONSE_TOO_LARGE_${response.status}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`INVALID_JSON_RESPONSE_${response.status}`);
  }
}

async function workerJson(label, url, options = {}, retry = {}) {
  const maxAttempts = Number(retry.maxAttempts || 1);
  const delayMs = Number(retry.delayMs || 1500);
  const transientErrors = new Set(retry.transientErrors || []);
  const transientStatuses = new Set(retry.transientStatuses || []);
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
    const payload = await readLimitedJson(response);
    last = { response, payload, attempt };

    const transient =
      transientStatuses.has(response.status) ||
      (response.status === 503 && transientErrors.has(payload?.error));
    if (!transient || attempt === maxAttempts) return last;
    await sleep(delayMs);
  }

  return last;
}

async function supabaseRpc(functionName, body = {}) {
  const response = await fetch(
    `${supabaseBase}/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'public',
        Accept: 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(body)
    }
  );
  const payload = await readLimitedJson(response);
  if (!response.ok) {
    throw new Error(
      `SUPABASE_RPC_${safeCode(functionName)}_STATUS_${response.status}_CODE_${safeCode(payload?.code)}`
    );
  }
  return Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
}

async function waitForShadowDeployment() {
  let last = null;
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const result = await workerJson(
      'SHADOW_HEALTH',
      `${workerBase}/health?shadowProbe=${encodeURIComponent(`${runId}-${runAttempt}-${attempt}`)}`,
      { headers: { Accept: 'application/json' } }
    );
    last = result;
    const ready =
      result.response.status === 200 &&
      result.payload?.ok === true &&
      result.payload?.writesEnabled === true &&
      result.payload?.lowLevelLedgerEnabled === false &&
      result.payload?.supabaseShadow?.enabled === true &&
      result.payload?.supabaseShadow?.configured === true &&
      result.payload?.supabaseShadow?.mode === 'best-effort';
    if (ready) return result.payload;
    await sleep(2000);
  }

  throw new Error(`SUPABASE_SHADOW_HEALTH_NOT_READY:${JSON.stringify({
    status: last?.response?.status,
    error: last?.payload?.error,
    shadow: last?.payload?.supabaseShadow
  })}`);
}

async function waitForProjectedOrder(orderNumber) {
  let lastPayload = null;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const payload = await supabaseRpc('armazem_v2_list_orders_redacted_v1', {
      p_limit: ORDER_LIST_LIMIT
    });
    lastPayload = payload;
    const matches = Array.isArray(payload?.orders)
      ? payload.orders.filter(order => order?.orderNumber === orderNumber)
      : [];
    if (matches.length === 1) return { payload, order: matches[0] };
    if (matches.length > 1) throw new Error('SUPABASE_SHADOW_DUPLICATE_ORDER');
    await sleep(1500);
  }
  throw new Error(`SUPABASE_SHADOW_ORDER_NOT_PROJECTED:${JSON.stringify({
    orderNumber,
    ok: lastPayload?.ok,
    orderCount: Array.isArray(lastPayload?.orders) ? lastPayload.orders.length : null
  })}`);
}

const workerHealth = await waitForShadowDeployment();
const healthBefore = await supabaseRpc('armazem_v2_projection_health_v1');
assert(healthBefore?.ok === true, 'SUPABASE_HEALTH_BEFORE_INVALID', healthBefore);
const ordersBefore = Number(healthBefore?.orders);
assert(Number.isInteger(ordersBefore) && ordersBefore >= 0, 'SUPABASE_ORDER_COUNT_BEFORE_INVALID');

const customer = {
  name: 'Cliente Sintético da Sombra',
  whatsapp: '5581888888888'
};
const body = {
  submissionCreatedAt,
  seller: { id: 'ci-shadow', label: 'CI Shadow' },
  customer,
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
  'X-Staging-Token': workerToken,
  'Idempotency-Key': idempotencyKey
};
const writeRetry = {
  maxAttempts: 30,
  delayMs: 2000,
  transientErrors: ['STAGING_WRITES_DISABLED'],
  transientStatuses: [404]
};

const firstResult = await workerJson(
  'SHADOW_FIRST',
  `${workerBase}/internal/v2/orders/submit`,
  { method: 'POST', headers: writeHeaders, body: JSON.stringify(body) },
  writeRetry
);
const first = firstResult.payload;
assert(firstResult.response.status === 201, `SHADOW_FIRST_STATUS_${firstResult.response.status}`, first);
assert(first?.ok === true && first?.action === 'CREATED', 'SHADOW_FIRST_INVALID', first);
assert(/^PED\d{7}[A-Z]$/.test(String(first?.orderNumber || '')), 'SHADOW_ORDER_NUMBER_INVALID');
assert(Number(first?.pricing?.total) === 58.5, 'SHADOW_SERVER_TOTAL_INVALID', first?.pricing);

const replayResult = await workerJson(
  'SHADOW_REPLAY',
  `${workerBase}/internal/v2/orders/submit`,
  { method: 'POST', headers: writeHeaders, body: JSON.stringify(body) },
  writeRetry
);
const replay = replayResult.payload;
assert(replayResult.response.status === 200, `SHADOW_REPLAY_STATUS_${replayResult.response.status}`, replay);
assert(replay?.ok === true && replay?.action === 'REPLAY', 'SHADOW_REPLAY_INVALID', replay);
assert(replay?.orderNumber === first.orderNumber, 'SHADOW_REPLAY_ORDER_CHANGED');

const projected = await waitForProjectedOrder(first.orderNumber);
const order = projected.order;
assert(projected.payload?.ok === true, 'SUPABASE_REDACTED_LIST_INVALID', projected.payload);
assert(projected.payload?.readOnly === true, 'SUPABASE_REDACTED_LIST_NOT_READONLY');
assert(projected.payload?.customerData === 'redacted', 'SUPABASE_CUSTOMER_DATA_MODE_INVALID');
assert(order?.customer?.redacted === true, 'SUPABASE_CUSTOMER_NOT_REDACTED', order?.customer);
assert(Number(order?.pricing?.total) === 58.5, 'SUPABASE_ORDER_TOTAL_INVALID', order?.pricing);
assert(order?.items?.[0]?.driveFileId === 'staging-artwork-2657', 'SUPABASE_ORDER_ITEM_INVALID', order?.items);

const serialized = JSON.stringify(projected.payload);
assert(!serialized.includes(customer.name), 'SUPABASE_CUSTOMER_NAME_EXPOSED');
assert(!serialized.includes(customer.whatsapp), 'SUPABASE_CUSTOMER_PHONE_EXPOSED');
assert(!serialized.includes(serviceRoleKey), 'SUPABASE_SERVICE_KEY_EXPOSED');

await sleep(2000);
const replayCheck = await supabaseRpc('armazem_v2_list_orders_redacted_v1', {
  p_limit: ORDER_LIST_LIMIT
});
const duplicateCount = Array.isArray(replayCheck?.orders)
  ? replayCheck.orders.filter(entry => entry?.orderNumber === first.orderNumber).length
  : 0;
assert(duplicateCount === 1, 'SUPABASE_REPLAY_CREATED_DUPLICATE', { duplicateCount });

const healthAfter = await supabaseRpc('armazem_v2_projection_health_v1');
assert(healthAfter?.ok === true, 'SUPABASE_HEALTH_AFTER_INVALID', healthAfter);
const ordersAfter = Number(healthAfter?.orders);
assert(
  ordersAfter === ordersBefore + 1,
  'SUPABASE_SHADOW_ORDER_COUNT_INCREMENT_INVALID',
  { ordersBefore, ordersAfter }
);
assert(Number(healthAfter?.items) >= 1, 'SUPABASE_ITEM_COUNT_INVALID');

console.log(JSON.stringify({
  ok: true,
  shadowEnabled: workerHealth.supabaseShadow.enabled,
  shadowConfigured: workerHealth.supabaseShadow.configured,
  orderNumber: first.orderNumber,
  firstAction: first.action,
  replayAction: replay.action,
  projectedExactlyOnce: duplicateCount === 1,
  customerRedacted: order.customer.redacted,
  total: Number(order.pricing.total),
  ordersBefore,
  ordersAfter,
  supabaseItems: Number(healthAfter.items)
}, null, 2));
