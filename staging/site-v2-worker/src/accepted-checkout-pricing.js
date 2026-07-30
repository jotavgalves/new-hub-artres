import {
  priceOrderIntentV2,
  validatePricingQuoteV2
} from '../../../src/v2/orders/pricing.mjs';
import { loadActiveCommercialConfig } from './commercial-config-route.js';

export async function priceAcceptedCheckoutDraft(input = {}) {
  const body = record(input.body);
  const requestItems = Array.isArray(body.items) ? body.items : [];
  const validatedItems = Array.isArray(input.validated?.items) ? input.validated.items : [];
  const catalogItems = Array.isArray(input.resolved?.items) ? input.resolved.items : [];
  const catalogVersion = positiveInteger(input.resolved?.catalogVersion);

  if (!requestItems.length || requestItems.length !== validatedItems.length) {
    throw pricingError('CHECKOUT_PRICING_ITEM_COUNT_MISMATCH');
  }
  if (!catalogItems.length || !catalogVersion) {
    throw pricingError('CHECKOUT_PRICING_CATALOG_INVALID');
  }

  const sourceItems = validatedItems.map((validated, index) => {
    const requested = record(requestItems[index]);
    return {
      ...validated,
      unitPrice: requested.unitPrice,
      price: requested.price,
      lineSubtotal: requested.lineSubtotal
    };
  });

  const loadConfig = typeof input.loadCommercialConfig === 'function'
    ? input.loadCommercialConfig
    : loadActiveCommercialConfig;
  const commercial = await loadConfig(input.env, { catalogVersion });
  const productSnapshot = commercial?.productSnapshot;
  const configVersion = positiveInteger(commercial?.config?.version || productSnapshot?.metadata?.configVersion);
  if (!productSnapshot || !configVersion) throw pricingError('CHECKOUT_COMMERCIAL_CONFIG_INVALID');

  const quote = priceOrderIntentV2({
    items: sourceItems,
    catalogItems,
    productSnapshot,
    catalogVersion,
    configVersion,
    serverDiscountPercent: productSnapshot.commercialState?.effectiveDiscountPercent || 0,
    clientTotals: body.clientTotals,
    totals: body.totals,
    subtotal: body.subtotal,
    total: body.total,
    allowPassiveSimulation: false
  });

  const validation = validatePricingQuoteV2(quote);
  if (!validation.ok) {
    const error = pricingError('CHECKOUT_PRICING_QUOTE_INVALID');
    error.validationErrors = validation.errors;
    throw error;
  }

  return deepFreeze({
    ok: true,
    authoritative: true,
    source: 'admin-commercial-config-server-pricing',
    productSnapshot,
    config: commercial.config,
    quote,
    summary: {
      currency: quote.currency,
      itemCount: quote.integrity.itemCount,
      quantity: quote.integrity.quantity,
      subtotal: quote.pricing.subtotal,
      discountPercent: quote.pricing.discountPercent,
      discountAmount: quote.pricing.discountAmount,
      total: quote.pricing.total,
      catalogVersion: quote.integrity.catalogVersion,
      configVersion: quote.integrity.configVersion,
      clientValuesIgnored: quote.warnings.some(code =>
        code === 'CLIENT_ORDER_TOTALS_IGNORED' || code.startsWith('CLIENT_ITEM_PRICE_IGNORED:')
      )
    },
    warnings: quote.warnings.map(publicWarning)
  });
}

function publicWarning(value) {
  const code = String(value || '').split(':')[0];
  return /^[A-Z0-9_]{3,100}$/.test(code) ? code : 'CHECKOUT_WARNING';
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function pricingError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
