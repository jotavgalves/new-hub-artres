import { buildItemId, requireProductDefinition } from '../products/registry.mjs';

export const ORDER_SCHEMA_VERSION = 2;
export const ORDER_CALCULATION_VERSION = 1;

export function createCanonicalOrderV2(input = {}) {
  const orderNumber = clean(input.orderNumber);
  if (!orderNumber) throw orderError('ORDER_NUMBER_REQUIRED');

  const createdAt = validIsoDate(input.createdAt) || new Date().toISOString();
  const updatedAt = validIsoDate(input.updatedAt) || createdAt;
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) throw orderError('ORDER_ITEMS_REQUIRED');
  if (rawItems.length > 200) throw orderError('ORDER_ITEMS_LIMIT_EXCEEDED');

  const items = rawItems.map(createCanonicalItemV2);
  assertUniqueItemIds(items);

  const quantityValidation = validateQuantityRules(items, input.quantityRules || {});
  if (!quantityValidation.ok) {
    const error = orderError('ORDER_QUANTITY_RULES_INVALID');
    error.details = quantityValidation.errors;
    throw error;
  }

  const discountPercent = percentage(input.discountPercent);
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineSubtotal, 0));
  const discountAmount = roundMoney(subtotal * (discountPercent / 100));
  const total = roundMoney(Math.max(0, subtotal - discountAmount));

  const order = {
    schemaVersion: ORDER_SCHEMA_VERSION,
    orderNumber,
    orderCode: orderNumber,
    displayId: orderNumber,
    createdAt,
    updatedAt,
    status: clean(input.status || 'Novo'),
    seller: sanitizeSeller(input.seller),
    customer: sanitizeCustomer(input.customer),
    items,
    qty: items.reduce((sum, item) => sum + item.quantity, 0),
    pricing: {
      currency: 'BRL',
      subtotal,
      discountPercent,
      discountAmount,
      total,
      calculationVersion: ORDER_CALCULATION_VERSION
    },
    integrity: {
      catalogVersion: positiveInteger(input.catalogVersion),
      configVersion: positiveInteger(input.configVersion),
      productRegistryVersion: positiveInteger(input.productRegistryVersion) || 1,
      requestItemCount: positiveInteger(input.requestItemCount) || rawItems.length,
      canonicalItemCount: items.length
    },
    source: clean(input.source || 'catalog-v2')
  };

  const validation = validateOrderV2(order);
  if (!validation.ok) {
    const error = orderError('ORDER_V2_INVALID');
    error.details = validation.errors;
    throw error;
  }

  return deepFreeze(order);
}

export function createCanonicalItemV2(input = {}) {
  const driveFileId = identityPart(input.driveFileId);
  const productKey = clean(input.productKey);
  const product = requireProductDefinition(productKey);
  const variantKey = identityPart(input.variantKey || 'default');
  const sizeKey = identityPart(input.sizeKey || input.size || 'default');
  const quantity = positiveInteger(input.quantity ?? input.qty);
  const unitPrice = moneyValue(input.unitPrice);

  if (!driveFileId) throw orderError('DRIVE_FILE_ID_REQUIRED');
  if (!quantity) throw orderError('ITEM_QUANTITY_INVALID');
  if (unitPrice === null) throw orderError('ITEM_UNIT_PRICE_INVALID');

  const itemId = buildItemId({
    driveFileId,
    productKey: product.key,
    variantKey,
    sizeKey
  });

  if (input.itemId && clean(input.itemId) !== itemId) {
    const error = orderError('ITEM_ID_MISMATCH');
    error.expected = itemId;
    error.received = clean(input.itemId);
    throw error;
  }

  return deepFreeze({
    itemId,
    driveFileId,
    code: cleanCode(input.code),
    originalName: clean(input.originalName || input.fileName || input.filename),
    theme: clean(input.theme),
    subtheme: clean(input.subtheme),
    productKey: product.key,
    productName: clean(input.productName || product.label),
    variantKey,
    sizeKey,
    quantity,
    unitPrice,
    lineSubtotal: roundMoney(unitPrice * quantity),
    details: sanitizeDetails(input.details)
  });
}

export function validateQuantityRules(items = [], rules = {}) {
  const errors = [];
  const productGroups = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    if (!productGroups.has(item.productKey)) productGroups.set(item.productKey, []);
    productGroups.get(item.productKey).push(item);
  }

  for (const [productKey, productItems] of productGroups.entries()) {
    const rule = rules[productKey];
    if (!rule) continue;

    const minimum = positiveInteger(rule.minimum);
    const step = positiveInteger(rule.step) || 1;
    const scope = rule.scope === 'item' ? 'item' : 'cart-product-total';

    if (!minimum) {
      errors.push(`QUANTITY_RULE_MINIMUM_INVALID:${productKey}`);
      continue;
    }

    if (scope === 'item') {
      for (const item of productItems) {
        validateQuantityValue(item.quantity, minimum, step, `${productKey}:${item.itemId}`, errors);
      }
      continue;
    }

    const total = productItems.reduce((sum, item) => sum + item.quantity, 0);
    validateQuantityValue(total, minimum, step, productKey, errors);
  }

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

export function validateOrderV2(order) {
  const errors = [];

  if (!order || order.schemaVersion !== ORDER_SCHEMA_VERSION) errors.push('SCHEMA_VERSION_INVALID');
  if (!clean(order?.orderNumber)) errors.push('ORDER_NUMBER_REQUIRED');
  if (!validIsoDate(order?.createdAt)) errors.push('CREATED_AT_INVALID');
  if (!validIsoDate(order?.updatedAt)) errors.push('UPDATED_AT_INVALID');
  if (!Array.isArray(order?.items) || !order.items.length) errors.push('ORDER_ITEMS_REQUIRED');

  const seen = new Set();
  for (const item of order?.items || []) {
    if (!clean(item.itemId)) errors.push('ITEM_ID_REQUIRED');
    if (seen.has(item.itemId)) errors.push(`DUPLICATE_ITEM_ID:${item.itemId}`);
    seen.add(item.itemId);
    if (!identityPart(item.driveFileId)) errors.push(`DRIVE_FILE_ID_REQUIRED:${item.itemId || 'unknown'}`);
    if (!cleanCode(item.code)) errors.push(`ITEM_CODE_REQUIRED:${item.itemId || 'unknown'}`);
    if (!clean(item.productKey)) errors.push(`PRODUCT_KEY_REQUIRED:${item.itemId || 'unknown'}`);
    if (!positiveInteger(item.quantity)) errors.push(`ITEM_QUANTITY_INVALID:${item.itemId || 'unknown'}`);
    if (moneyValue(item.unitPrice) === null) errors.push(`ITEM_UNIT_PRICE_INVALID:${item.itemId || 'unknown'}`);
    if (roundMoney(item.unitPrice * item.quantity) !== item.lineSubtotal) {
      errors.push(`LINE_SUBTOTAL_INVALID:${item.itemId || 'unknown'}`);
    }
  }

  const expectedSubtotal = roundMoney((order?.items || []).reduce((sum, item) => sum + Number(item.lineSubtotal || 0), 0));
  const discountPercent = percentage(order?.pricing?.discountPercent);
  const expectedDiscount = roundMoney(expectedSubtotal * (discountPercent / 100));
  const expectedTotal = roundMoney(Math.max(0, expectedSubtotal - expectedDiscount));

  if (order?.pricing?.currency !== 'BRL') errors.push('PRICING_CURRENCY_INVALID');
  if (order?.pricing?.subtotal !== expectedSubtotal) errors.push('PRICING_SUBTOTAL_INVALID');
  if (order?.pricing?.discountAmount !== expectedDiscount) errors.push('PRICING_DISCOUNT_INVALID');
  if (order?.pricing?.total !== expectedTotal) errors.push('PRICING_TOTAL_INVALID');
  if (order?.pricing?.calculationVersion !== ORDER_CALCULATION_VERSION) errors.push('CALCULATION_VERSION_INVALID');
  if (order?.integrity?.canonicalItemCount !== (order?.items || []).length) errors.push('CANONICAL_ITEM_COUNT_INVALID');

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function validateQuantityValue(value, minimum, step, label, errors) {
  if (value < minimum) {
    errors.push(`QUANTITY_BELOW_MINIMUM:${label}:${value}:${minimum}`);
    return;
  }

  if ((value - minimum) % step !== 0) {
    errors.push(`QUANTITY_STEP_INVALID:${label}:${value}:${minimum}:${step}`);
  }
}

function assertUniqueItemIds(items) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.itemId)) {
      const error = orderError('DUPLICATE_ITEM_ID');
      error.itemId = item.itemId;
      throw error;
    }
    seen.add(item.itemId);
  }
}

function sanitizeSeller(value = {}) {
  return deepFreeze({
    id: identifier(value?.id || value?.sellerId || value?.username),
    label: clean(value?.label || value?.name)
  });
}

function sanitizeCustomer(value = {}) {
  return deepFreeze({
    name: clean(value?.name || value?.nome).slice(0, 160),
    whatsapp: digits(value?.whatsapp || value?.phone).slice(0, 20),
    phone: digits(value?.phone || value?.whatsapp).slice(0, 20)
  });
}

function sanitizeDetails(value, depth = 0) {
  if (depth > 5) throw orderError('ITEM_DETAILS_TOO_DEEP');
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') return value.trim().slice(0, 300);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return deepFreeze(value.slice(0, 30).map(item => sanitizeDetails(item, depth + 1)));
  }

  if (typeof value !== 'object') return null;

  const entries = Object.entries(value).slice(0, 50).map(([key, nested]) => [
    identifier(key).slice(0, 80),
    sanitizeDetails(nested, depth + 1)
  ]).filter(([key]) => key);

  return deepFreeze(Object.fromEntries(entries));
}

function percentage(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 100);
}

function moneyValue(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : null;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanCode(value) {
  return String(value ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function identifier(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function identityPart(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function orderError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
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
