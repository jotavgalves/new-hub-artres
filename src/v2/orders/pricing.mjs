import { createCanonicalOrderV2, roundMoney, validateQuantityRules } from './schema.mjs';
import { resolveCatalogProductKey } from '../products/catalog-references.mjs';

export function priceOrderIntentV2(input = {}) {
  const productSnapshot = input.productSnapshot || {};
  const sourceItems = Array.isArray(input.items) ? input.items : [];
  const catalogItems = Array.isArray(input.catalogItems) ? input.catalogItems : [];
  const allowPassiveSimulation = input.allowPassiveSimulation === true;
  const warnings = [];

  if (!sourceItems.length) throw pricingError('ORDER_ITEMS_REQUIRED');
  if (sourceItems.length > 200) throw pricingError('ORDER_ITEMS_LIMIT_EXCEEDED');

  const catalogMap = new Map();
  for (const item of catalogItems) {
    const driveFileId = identity(item?.driveFileId || item?.id || item?.drive_id);
    if (!driveFileId) continue;
    if (catalogMap.has(driveFileId)) throw pricingError('CATALOG_DRIVE_ID_DUPLICATED', driveFileId);
    catalogMap.set(driveFileId, item);
  }

  const pricedItems = sourceItems.map((raw, index) => {
    const driveFileId = identity(raw?.driveFileId || raw?.id || raw?.drive_id);
    if (!driveFileId) throw pricingError('DRIVE_FILE_ID_REQUIRED', String(index));

    const catalogItem = catalogMap.get(driveFileId);
    if (!catalogItem) throw pricingError('ARTWORK_NOT_FOUND', driveFileId);

    const catalogProductKey = resolveCatalogProductKey(catalogItem.productKey || catalogItem.product);
    if (!catalogProductKey) throw pricingError('CATALOG_PRODUCT_NOT_CONFIGURED', driveFileId);

    const requestedProductKey = raw?.productKey || raw?.product
      ? resolveCatalogProductKey(raw.productKey || raw.product)
      : catalogProductKey;

    if (!requestedProductKey) throw pricingError('REQUEST_PRODUCT_NOT_CONFIGURED', driveFileId);
    if (requestedProductKey !== catalogProductKey) {
      throw pricingError('ARTWORK_PRODUCT_MISMATCH', `${driveFileId}:${requestedProductKey}:${catalogProductKey}`);
    }

    const product = productSnapshot.products?.[catalogProductKey];
    if (!product) throw pricingError('PRODUCT_PRICING_NOT_AVAILABLE', catalogProductKey);

    if (!allowPassiveSimulation && product.activation?.checkoutEnabled !== true) {
      throw pricingError('PRODUCT_CHECKOUT_DISABLED', catalogProductKey);
    }

    const unitPrice = positiveMoney(product.pricing?.unitPrice);
    if (unitPrice === null) throw pricingError('PRODUCT_UNIT_PRICE_INVALID', catalogProductKey);

    const quantity = positiveInteger(raw?.quantity ?? raw?.qty);
    if (!quantity) throw pricingError('ITEM_QUANTITY_INVALID', driveFileId);

    if (raw?.unitPrice !== undefined || raw?.price !== undefined || raw?.lineSubtotal !== undefined) {
      warnings.push(`CLIENT_ITEM_PRICE_IGNORED:${driveFileId}`);
    }

    return {
      driveFileId,
      code: clean(catalogItem.code),
      originalName: clean(catalogItem.originalName || catalogItem.name),
      theme: clean(catalogItem.theme),
      subtheme: clean(catalogItem.subtheme),
      productKey: catalogProductKey,
      productName: clean(catalogItem.productName || product.label || catalogProductKey),
      variantKey: identity(raw?.variantKey || raw?.variant || 'default') || 'default',
      sizeKey: identity(raw?.sizeKey || raw?.size || catalogItem.sizeKey || catalogItem.size || 'default') || 'default',
      quantity,
      unitPrice,
      lineSubtotal: roundMoney(unitPrice * quantity),
      details: raw?.details || {}
    };
  });

  const quantityRules = {};
  for (const productKey of new Set(pricedItems.map(item => item.productKey))) {
    const quantity = productSnapshot.products?.[productKey]?.quantity || {};
    quantityRules[productKey] = {
      minimum: positiveInteger(quantity.minimum),
      step: positiveInteger(quantity.step) || 1,
      scope: quantity.scope === 'item' ? 'item' : 'cart-product-total'
    };
  }

  const quantityValidation = validateQuantityRules(pricedItems.map((item, index) => ({
    ...item,
    itemId: `${item.driveFileId}:${item.productKey}:${item.variantKey}:${item.sizeKey}:${index}`
  })), quantityRules);

  if (!quantityValidation.ok) {
    const error = pricingError('ORDER_QUANTITY_RULES_INVALID');
    error.details = quantityValidation.errors;
    throw error;
  }

  if (input.clientTotals || input.totals || input.subtotal !== undefined || input.total !== undefined) {
    warnings.push('CLIENT_ORDER_TOTALS_IGNORED');
  }

  const discountPercent = percentage(
    input.serverDiscountPercent ?? productSnapshot.commercialState?.effectiveDiscountPercent ?? 0
  );
  const subtotal = roundMoney(pricedItems.reduce((sum, item) => sum + item.lineSubtotal, 0));
  const discountAmount = roundMoney(subtotal * (discountPercent / 100));
  const total = roundMoney(Math.max(0, subtotal - discountAmount));

  return deepFreeze({
    schemaVersion: 1,
    mode: allowPassiveSimulation ? 'passive-simulation' : 'active-server-pricing',
    currency: 'BRL',
    items: pricedItems,
    quantityRules,
    pricing: {
      subtotal,
      discountPercent,
      discountAmount,
      total
    },
    integrity: {
      catalogVersion: positiveInteger(input.catalogVersion || productSnapshot.metadata?.catalogVersion),
      configVersion: positiveInteger(input.configVersion || productSnapshot.metadata?.configVersion),
      productCount: new Set(pricedItems.map(item => item.productKey)).size,
      itemCount: pricedItems.length,
      quantity: pricedItems.reduce((sum, item) => sum + item.quantity, 0)
    },
    warnings: unique(warnings)
  });
}

export function createOrderFromPricingQuoteV2(input = {}) {
  const quote = input.quote;
  if (!quote || !Array.isArray(quote.items) || !quote.items.length) throw pricingError('PRICING_QUOTE_REQUIRED');

  return createCanonicalOrderV2({
    orderNumber: input.orderNumber,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    status: input.status || 'Novo',
    seller: input.seller,
    customer: input.customer,
    items: quote.items,
    discountPercent: quote.pricing.discountPercent,
    catalogVersion: quote.integrity.catalogVersion,
    configVersion: quote.integrity.configVersion,
    productRegistryVersion: input.productRegistryVersion || 1,
    requestItemCount: input.requestItemCount || quote.items.length,
    quantityRules: quote.quantityRules,
    source: input.source || 'catalog-v2'
  });
}

export function validatePricingQuoteV2(quote) {
  const errors = [];

  if (!quote || quote.schemaVersion !== 1) errors.push('PRICING_QUOTE_SCHEMA_INVALID');
  if (!['passive-simulation', 'active-server-pricing'].includes(quote?.mode)) errors.push('PRICING_QUOTE_MODE_INVALID');
  if (quote?.currency !== 'BRL') errors.push('PRICING_QUOTE_CURRENCY_INVALID');
  if (!Array.isArray(quote?.items) || !quote.items.length) errors.push('PRICING_QUOTE_ITEMS_REQUIRED');

  const subtotal = roundMoney((quote?.items || []).reduce((sum, item) => sum + Number(item.lineSubtotal || 0), 0));
  const discountPercent = percentage(quote?.pricing?.discountPercent);
  const discountAmount = roundMoney(subtotal * (discountPercent / 100));
  const total = roundMoney(Math.max(0, subtotal - discountAmount));

  if (quote?.pricing?.subtotal !== subtotal) errors.push('PRICING_QUOTE_SUBTOTAL_INVALID');
  if (quote?.pricing?.discountAmount !== discountAmount) errors.push('PRICING_QUOTE_DISCOUNT_INVALID');
  if (quote?.pricing?.total !== total) errors.push('PRICING_QUOTE_TOTAL_INVALID');
  if (quote?.integrity?.itemCount !== (quote?.items || []).length) errors.push('PRICING_QUOTE_ITEM_COUNT_INVALID');

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

function percentage(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 100);
}

function positiveMoney(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : null;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function identity(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function pricingError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
