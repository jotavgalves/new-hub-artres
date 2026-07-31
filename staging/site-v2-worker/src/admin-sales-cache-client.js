const CACHE_OBJECT_NAME = 'sales-dashboard-current';

export function adminSalesCacheStub(env = {}) {
  if (!env?.ADMIN_SALES_CACHE || typeof env.ADMIN_SALES_CACHE.getByName !== 'function') return null;
  return env.ADMIN_SALES_CACHE.getByName(CACHE_OBJECT_NAME);
}

export function adminSalesCacheStatus(env = {}) {
  return Object.freeze({
    enabled: Boolean(adminSalesCacheStub(env)),
    mode: 'versioned-snapshot-live-events',
    reconcileAfterMs: 30_000
  });
}

export function scheduleAdminSalesCacheRefresh({ ctx, env = {}, result = {}, logger = console } = {}) {
  if (String(result.action || '').toUpperCase() !== 'CREATED' || result.replayed === true) {
    return { scheduled: false, state: 'replay' };
  }

  const stub = adminSalesCacheStub(env);
  if (!stub) return { scheduled: false, state: 'not-configured' };

  const task = stub.orderCommitted({
    action: result.action,
    orderNumber: result.orderNumber || result.order?.orderNumber,
    createdAt: result.order?.createdAt,
    updatedAt: result.order?.updatedAt
  }).catch(error => {
    emitLog(logger, 'error', {
      event: 'admin-sales-cache-refresh-failed',
      code: publicCacheErrorCode(error),
      orderNumber: safeOrderNumber(result.orderNumber || result.order?.orderNumber)
    });
    return { updated: false, code: publicCacheErrorCode(error) };
  });

  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  else void task;
  return { scheduled: true, state: 'scheduled' };
}

function safeOrderNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^PED\d{7}[A-Z]$/.test(text) ? text : '';
}

function emitLog(logger, method, payload) {
  const target = logger && typeof logger[method] === 'function' ? logger[method].bind(logger) : null;
  if (target) target(JSON.stringify(payload));
}

function publicCacheErrorCode(error) {
  const code = String(error?.code || error?.message || '').trim().toUpperCase();
  return /^ADMIN_SALES_CACHE_[A-Z0-9_]{1,80}$/.test(code) || code === 'ORDER_LEDGER_NOT_CONFIGURED'
    ? code
    : 'ADMIN_SALES_CACHE_REFRESH_FAILED';
}
