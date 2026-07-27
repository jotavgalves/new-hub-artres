import { adaptOrderForV2 } from '../orders/legacy-adapter.mjs';

export const PRODUCTION_PAYLOAD_VERSION = 2;

export function buildProductionPayloadV2(order, options = {}) {
  const adapted = adaptOrderForV2(order || {});
  const exposeCustomer = options.exposeCustomer !== false;
  const exposeTotals = options.exposeTotals === true;
  const timeZone = clean(options.timeZone || 'America/Recife');
  const items = aggregateByItemId(adapted.items);
  const warnings = unique([
    ...adapted.warnings,
    ...items.flatMap(item => item.warnings || [])
  ]);

  return deepFreeze({
    ok: true,
    schemaVersion: 2,
    payloadVersion: PRODUCTION_PAYLOAD_VERSION,
    compatibilityMode: adapted.compatibilityMode,
    order: {
      orderNumber: adapted.orderNumber,
      status: adapted.status,
      createdAt: adapted.createdAt,
      createdAtFormatted: formatDate(adapted.createdAt, timeZone),
      seller: {
        id: adapted.seller.id,
        name: adapted.seller.name
      },
      customer: exposeCustomer ? {
        name: adapted.customer.name
      } : undefined,
      pricing: exposeTotals ? compactPricing(adapted.pricing) : undefined,
      source: adapted.source
    },
    items: items.map(item => ({
      itemId: item.itemId,
      identityStatus: item.identityStatus,
      driveFileId: item.driveFileId,
      code: item.code,
      fileName: item.fileName,
      theme: item.theme,
      subtheme: item.subtheme,
      productKey: item.productKey,
      productName: item.productName,
      variantKey: item.variantKey,
      sizeKey: item.sizeKey,
      quantity: item.quantity,
      details: item.details,
      warnings: item.warnings
    })),
    warnings,
    integrity: {
      sourceSchemaVersion: adapted.schemaVersion,
      sourceItemCount: adapted.items.length,
      payloadItemCount: items.length,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      unresolvedItems: items.filter(item => item.identityStatus === 'unresolved-legacy').length
    }
  });
}

export function buildLegacyProductionPayloadView(payloadV2) {
  const payload = payloadV2 || {};
  const order = payload.order || {};

  return deepFreeze({
    ok: payload.ok === true,
    orderNumber: clean(order.orderNumber),
    customerName: clean(order.customer?.name),
    createdAt: clean(order.createdAt),
    createdAtFormatted: clean(order.createdAtFormatted),
    sellerName: clean(order.seller?.name),
    items: (Array.isArray(payload.items) ? payload.items : []).map(item => ({
      id: clean(item.code),
      name: clean(item.fileName),
      quantity: positiveInteger(item.quantity) || 1
    })),
    compatibility: {
      payloadVersion: payload.payloadVersion || PRODUCTION_PAYLOAD_VERSION,
      mode: payload.compatibilityMode || 'unknown',
      unresolvedItems: payload.integrity?.unresolvedItems || 0
    }
  });
}

export function validateProductionPayloadV2(payload) {
  const errors = [];

  if (!payload || payload.schemaVersion !== 2) errors.push('PAYLOAD_SCHEMA_VERSION_INVALID');
  if (payload?.payloadVersion !== PRODUCTION_PAYLOAD_VERSION) errors.push('PAYLOAD_VERSION_INVALID');
  if (!clean(payload?.order?.orderNumber)) errors.push('ORDER_NUMBER_REQUIRED');
  if (!Array.isArray(payload?.items) || !payload.items.length) errors.push('PRODUCTION_ITEMS_REQUIRED');

  const seen = new Set();
  for (const item of payload?.items || []) {
    if (!clean(item.itemId)) errors.push('ITEM_ID_REQUIRED');
    if (seen.has(item.itemId)) errors.push(`DUPLICATE_ITEM_ID:${item.itemId}`);
    seen.add(item.itemId);
    if (!clean(item.code)) errors.push(`ITEM_CODE_REQUIRED:${item.itemId || 'unknown'}`);
    if (!positiveInteger(item.quantity)) errors.push(`ITEM_QUANTITY_INVALID:${item.itemId || 'unknown'}`);
    if (item.identityStatus === 'verified' && !clean(item.driveFileId)) {
      errors.push(`VERIFIED_ITEM_WITHOUT_DRIVE_ID:${item.itemId || 'unknown'}`);
    }
  }

  const expectedQuantity = (payload?.items || []).reduce((sum, item) => sum + (positiveInteger(item.quantity) || 0), 0);
  if (payload?.integrity?.quantity !== expectedQuantity) errors.push('PAYLOAD_QUANTITY_INVALID');
  if (payload?.integrity?.payloadItemCount !== (payload?.items || []).length) errors.push('PAYLOAD_ITEM_COUNT_INVALID');

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

function aggregateByItemId(items) {
  const map = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const existing = map.get(item.itemId);
    if (!existing) {
      map.set(item.itemId, {
        ...item,
        warnings: [...(item.warnings || [])]
      });
      continue;
    }

    if (!sameProductionIdentity(existing, item)) {
      throw productionError('ITEM_ID_COLLISION', item.itemId);
    }

    existing.quantity += item.quantity;
    existing.warnings = unique([...(existing.warnings || []), ...(item.warnings || [])]);
  }

  return [...map.values()].map(deepFreeze);
}

function sameProductionIdentity(left, right) {
  return [
    'driveFileId',
    'code',
    'fileName',
    'theme',
    'subtheme',
    'productKey',
    'productName',
    'variantKey',
    'sizeKey',
    'identityStatus'
  ].every(field => clean(left[field]) === clean(right[field]));
}

function compactPricing(pricing = {}) {
  const output = {
    currency: clean(pricing.currency || 'BRL') || 'BRL'
  };

  for (const field of ['subtotal', 'discountPercent', 'discountAmount', 'total']) {
    if (Number.isFinite(Number(pricing[field]))) output[field] = Number(pricing[field]);
  }

  return output;
}

function formatDate(value, timeZone) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return clean(value);

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone
    }).format(date);
  } catch (_) {
    return date.toISOString();
  }
}

function productionError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
