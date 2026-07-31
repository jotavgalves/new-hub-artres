const base = normalizeOrigin(process.env.STAGING_URL);
const token = String(process.env.SITE_V2_STAGING_API_TOKEN || '').trim();
const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || '1');

if (token.length < 32) throw smokeError('ADMIN_CACHE_TOKEN_MISSING_OR_SHORT');

const page = await fetchText('/admin', 'admin-cache-page');
assert(page.response.status === 200, 'ADMIN_CACHE_PAGE_STATUS_INVALID');
assert(page.text.includes('Última atualização'), 'ADMIN_CACHE_LAST_UPDATED_COPY_MISSING');
assert(page.text.includes('live-badge'), 'ADMIN_CACHE_LIVE_BADGE_MISSING');

const script = await fetchText('/admin/app.js', 'admin-cache-script');
assert(script.response.status === 200, 'ADMIN_CACHE_SCRIPT_STATUS_INVALID');
assert(script.text.includes('sessionStorage'), 'ADMIN_CACHE_SESSION_STORAGE_MISSING');
assert(script.text.includes('If-None-Match'), 'ADMIN_CACHE_ETAG_CLIENT_MISSING');
assert(script.text.includes('/internal/v2/admin/orders/stream'), 'ADMIN_CACHE_STREAM_CLIENT_MISSING');
assert(!script.text.includes('localStorage'), 'ADMIN_CACHE_LOCAL_STORAGE_PRESENT');

const initial = await fetchSnapshot('', 'admin-cache-initial');
assert(initial.response.status === 200, 'ADMIN_CACHE_INITIAL_STATUS_INVALID');
assert(initial.payload?.ok === true && initial.payload?.readOnly === true, 'ADMIN_CACHE_INITIAL_PAYLOAD_INVALID');
assert(Number.isInteger(initial.payload?.revision) && initial.payload.revision >= 0, 'ADMIN_CACHE_INITIAL_REVISION_INVALID');
const initialEtag = initial.response.headers.get('etag');
assert(initialEtag, 'ADMIN_CACHE_ETAG_MISSING');

const notModified = await fetchSnapshot(initialEtag, 'admin-cache-not-modified');
assert(notModified.response.status === 304, 'ADMIN_CACHE_304_NOT_RETURNED');

const abort = new AbortController();
const streamResponse = await fetch(new URL('/internal/v2/admin/orders/stream', base), {
  method: 'GET',
  headers: requestHeaders('admin-cache-stream', { Accept: 'text/event-stream' }),
  cache: 'no-store',
  credentials: 'omit',
  redirect: 'error',
  signal: abort.signal
});
assert(streamResponse.status === 200 && streamResponse.body, 'ADMIN_CACHE_STREAM_STATUS_INVALID');
const sse = createSseReader(streamResponse.body);
const ready = await sse.next(8000);
assert(ready.event === 'ready', 'ADMIN_CACHE_STREAM_READY_MISSING');

const submissionCreatedAt = new Date().toISOString();
const idempotencyKey = `admin-cache-${runId}-${runAttempt}-${Date.now()}`.slice(0, 128);
const created = await fetchJson('/internal/v2/orders/submit', 'admin-cache-create', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey
  },
  body: JSON.stringify({
    submissionCreatedAt,
    seller: { id: 'ci-admin-cache', label: 'CI Admin Cache' },
    customer: { name: 'Cliente Sintético Cache', whatsapp: '5581999999999' },
    items: [{
      driveFileId: 'staging-artwork-2657',
      productKey: '50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6
    }]
  })
});
assert(created.response.status === 201, `ADMIN_CACHE_CREATE_HTTP_${created.response.status}`);
assert(created.payload?.action === 'CREATED', 'ADMIN_CACHE_CREATE_ACTION_INVALID');

const revisionEvent = await sse.next(8000);
assert(revisionEvent.event === 'revision', 'ADMIN_CACHE_REVISION_EVENT_MISSING');
assert(Number(revisionEvent.data?.revision) > Number(initial.payload.revision), 'ADMIN_CACHE_REVISION_NOT_ADVANCED');
abort.abort();
await sse.close();

const updated = await fetchSnapshot(initialEtag, 'admin-cache-updated');
assert(updated.response.status === 200, 'ADMIN_CACHE_UPDATED_STATUS_INVALID');
assert(Number(updated.payload?.revision) >= Number(revisionEvent.data.revision), 'ADMIN_CACHE_UPDATED_REVISION_INVALID');
assert(updated.payload?.summary?.orderCount >= initial.payload.summary.orderCount + 1, 'ADMIN_CACHE_ORDER_COUNT_NOT_UPDATED');
const updatedEtag = updated.response.headers.get('etag');
assert(updatedEtag && updatedEtag !== initialEtag, 'ADMIN_CACHE_ETAG_NOT_CHANGED');

const updated304 = await fetchSnapshot(updatedEtag, 'admin-cache-updated-304');
assert(updated304.response.status === 304, 'ADMIN_CACHE_UPDATED_304_NOT_RETURNED');

console.log(JSON.stringify({
  ok: true,
  initialRevision: initial.payload.revision,
  updatedRevision: updated.payload.revision,
  etagChanged: true,
  notModifiedValidated: true,
  liveEventValidated: true,
  sessionCacheAssetValidated: true,
  productionChanged: false
}));

async function fetchSnapshot(etag, label) {
  const headers = {};
  if (etag) headers['If-None-Match'] = etag;
  return fetchJson('/internal/v2/admin/orders?limit=25', label, { headers }, true);
}

async function fetchJson(pathname, label, options = {}, allowEmpty = false) {
  const response = await fetch(new URL(pathname, base), {
    ...options,
    headers: requestHeaders(label, options.headers),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error'
  });
  const text = await response.text();
  if (!text && allowEmpty) return { response, payload: null };
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch (_) { throw smokeError(`${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_JSON_INVALID`); }
  return { response, payload };
}

async function fetchText(pathname, label) {
  const response = await fetch(new URL(pathname, base), {
    method: 'GET',
    headers: requestHeaders(label, { Accept: 'text/html,application/javascript;q=0.9,*/*;q=0.8' }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error'
  });
  const text = await response.text();
  assert(new TextEncoder().encode(text).byteLength <= 2 * 1024 * 1024, 'ADMIN_CACHE_TEXT_TOO_LARGE');
  return { response, text };
}

function requestHeaders(label, values = {}) {
  return {
    Accept: 'application/json',
    'X-Staging-Token': token,
    'X-Request-Id': `${label}-${runId}-${runAttempt}`.slice(0, 100),
    ...values
  };
}

function createSseReader(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async next(timeoutMs) {
      return withTimeout(readEvent(), timeoutMs, 'ADMIN_CACHE_STREAM_TIMEOUT');
    },
    async close() {
      try { await reader.cancel(); } catch (_) {}
      try { reader.releaseLock(); } catch (_) {}
    }
  };

  async function readEvent() {
    while (true) {
      let boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEvent(block);
        if (parsed) return parsed;
        continue;
      }
      const result = await reader.read();
      if (result.done) throw smokeError('ADMIN_CACHE_STREAM_ENDED');
      buffer += decoder.decode(result.value, { stream: true });
    }
  }
}

function parseEvent(block) {
  if (!block || block.startsWith(':')) return null;
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try { return { event, data: JSON.parse(data) }; }
  catch (_) { throw smokeError('ADMIN_CACHE_STREAM_JSON_INVALID'); }
}

async function withTimeout(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(smokeError(code)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch (_) { throw smokeError('STAGING_URL_INVALID'); }
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
