export const MAX_ADMIN_SALES_ORDERS = 100;

export function buildAdminSalesSnapshot({
  orders = [],
  ledgerHealth = {},
  meta = {},
  generatedAt = new Date().toISOString(),
  verifiedAt = generatedAt,
  year = new Date(generatedAt).getUTCFullYear()
} = {}) {
  const normalizedOrders = (Array.isArray(orders) ? orders : [])
    .slice(0, MAX_ADMIN_SALES_ORDERS)
    .map(adminOrderInspectionView);
  const normalizedMeta = normalizeAdminSalesMeta(meta);
  const orderCount = nonNegativeInteger(ledgerHealth.orderCount);
  const revision = normalizedMeta.revision || orderCount;
  const updatedAt = validIsoDate(normalizedMeta.updatedAt) ||
    validIsoDate(normalizedOrders[0]?.updatedAt) ||
    validIsoDate(normalizedOrders[0]?.createdAt) ||
    validIsoDate(generatedAt) ||
    new Date().toISOString();

  return Object.freeze({
    schemaVersion: 1,
    revision,
    updatedAt,
    generatedAt: validIsoDate(generatedAt) || new Date().toISOString(),
    verifiedAt: validIsoDate(verifiedAt) || validIsoDate(generatedAt) || new Date().toISOString(),
    year: positiveInteger(year) || new Date().getUTCFullYear(),
    ledgerHealth: Object.freeze({
      orderCount,
      pendingOutbox: nonNegativeInteger(ledgerHealth.pendingOutbox)
    }),
    orders: Object.freeze(normalizedOrders)
  });
}

export function sliceAdminSalesSnapshot(snapshot = {}, limit = 50, cacheState = 'hit') {
  const capped = boundedAdminLimit(limit);
  const orders = (Array.isArray(snapshot.orders) ? snapshot.orders : []).slice(0, capped);
  return Object.freeze({
    schemaVersion: 1,
    revision: nonNegativeInteger(snapshot.revision),
    updatedAt: validIsoDate(snapshot.updatedAt),
    generatedAt: validIsoDate(snapshot.generatedAt),
    verifiedAt: validIsoDate(snapshot.verifiedAt),
    year: positiveInteger(snapshot.year) || new Date().getUTCFullYear(),
    cacheState: cleanCacheState(cacheState),
    summary: Object.freeze(adminSummary(orders, snapshot.ledgerHealth)),
    orders: Object.freeze(orders)
  });
}

export function adminOrderInspectionView(order = {}) {
  return Object.freeze({
    schemaVersion: order.schemaVersion,
    orderNumber: order.orderNumber,
    orderCode: order.orderCode,
    displayId: order.displayId,
    status: order.status,
    seller: order.seller,
    customer: Object.freeze({ redacted: true }),
    items: Array.isArray(order.items) ? order.items : [],
    qty: finiteNumber(order.qty),
    pricing: order.pricing,
    integrity: order.integrity,
    source: order.source,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt
  });
}

export function adminSummary(orders = [], ledgerHealth = {}) {
  const rows = Array.isArray(orders) ? orders : [];
  return {
    orderCount: nonNegativeInteger(ledgerHealth.orderCount),
    returned: rows.length,
    totalValue: roundMoney(rows.reduce((sum, order) => sum + finiteNumber(order.pricing?.total), 0)),
    itemQuantity: rows.reduce((sum, order) => sum + finiteNumber(order.qty), 0),
    pendingOutbox: nonNegativeInteger(ledgerHealth.pendingOutbox)
  };
}

export function normalizeAdminSalesMeta(value = {}) {
  return Object.freeze({
    revision: nonNegativeInteger(value.revision),
    updatedAt: validIsoDate(value.updatedAt),
    orderNumber: safeOrderNumber(value.orderNumber)
  });
}

export function adminSalesEtag(revision, limit) {
  return `"admin-sales-v1-${nonNegativeInteger(revision)}-${boundedAdminLimit(limit)}"`;
}

export function boundedAdminLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.min(Math.max(fallback, 1), MAX_ADMIN_SALES_ORDERS);
  return Math.min(parsed, MAX_ADMIN_SALES_ORDERS);
}

function cleanCacheState(value) {
  return ['hit', 'revalidated', 'rebuilt', 'fallback'].includes(value) ? value : 'hit';
}

function safeOrderNumber(value) {
  const text = String(value || '').trim().toUpperCase();
  return /^PED\d{7}[A-Z]$/.test(text) ? text : '';
}

function validIsoDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
