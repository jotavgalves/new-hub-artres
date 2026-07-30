export const COMMERCIAL_CONFIG_SCHEMA_VERSION = 1;
export const COMMERCIAL_CONFIG_OBJECT_NAME = 'commercial-config-v1';
export const COMMERCIAL_PRODUCT_KEYS = Object.freeze(['50x50', 'painel-150']);

export const DEFAULT_COMMERCIAL_CONFIG = normalizeCommercialConfig({
  schemaVersion: COMMERCIAL_CONFIG_SCHEMA_VERSION,
  version: 1,
  currency: 'BRL',
  effectiveDiscountPercent: 0,
  products: {
    '50x50': {
      label: 'Bolinhas 50x50',
      enabled: true,
      unitPrice: 9.75,
      minimum: 6,
      step: 2,
      initialQuantity: 6,
      quantityScope: 'cart-product-total'
    },
    'painel-150': {
      label: 'Painel redondo 150 cm',
      enabled: true,
      unitPrice: 59.90,
      minimum: 1,
      step: 1,
      initialQuantity: 1,
      quantityScope: 'item'
    }
  }
}, { allowMissingVersion: false });

export function normalizeCommercialConfig(input = {}, options = {}) {
  const source = record(input);
  const errors = [];
  const schemaVersion = positiveInteger(source.schemaVersion) || COMMERCIAL_CONFIG_SCHEMA_VERSION;
  if (schemaVersion !== COMMERCIAL_CONFIG_SCHEMA_VERSION) errors.push('COMMERCIAL_CONFIG_SCHEMA_VERSION_INVALID');

  const version = positiveInteger(source.version);
  if (!version && options.allowMissingVersion !== true) errors.push('COMMERCIAL_CONFIG_VERSION_INVALID');

  const currency = clean(source.currency || 'BRL').toUpperCase();
  if (currency !== 'BRL') errors.push('COMMERCIAL_CONFIG_CURRENCY_INVALID');

  const productsSource = record(source.products);
  const unknownProducts = Object.keys(productsSource).filter(key => !COMMERCIAL_PRODUCT_KEYS.includes(key));
  if (unknownProducts.length) errors.push('COMMERCIAL_CONFIG_UNKNOWN_PRODUCT');

  const products = {};
  for (const key of COMMERCIAL_PRODUCT_KEYS) {
    const normalized = normalizeProduct(key, productsSource[key], errors);
    if (normalized) products[key] = normalized;
  }

  const effectiveDiscountPercent = percentage(source.effectiveDiscountPercent);
  if (effectiveDiscountPercent === null) errors.push('COMMERCIAL_CONFIG_DISCOUNT_INVALID');

  if (errors.length) {
    const error = commercialConfigError('COMMERCIAL_CONFIG_INVALID');
    error.validationErrors = unique(errors);
    throw error;
  }

  return deepFreeze({
    schemaVersion,
    version: version || 1,
    currency,
    effectiveDiscountPercent,
    products,
    updatedAt: validIsoDate(source.updatedAt),
    updatedBy: safeActor(source.updatedBy)
  });
}

export function validateCommercialConfig(input = {}, options = {}) {
  try {
    return { ok: true, config: normalizeCommercialConfig(input, options), errors: [] };
  } catch (error) {
    return {
      ok: false,
      config: null,
      errors: unique(error?.validationErrors || [error?.code || 'COMMERCIAL_CONFIG_INVALID'])
    };
  }
}

export function publicCommercialConfigView(input = {}) {
  const config = normalizeCommercialConfig(input);
  return deepFreeze({
    schemaVersion: config.schemaVersion,
    version: config.version,
    currency: config.currency,
    effectiveDiscountPercent: config.effectiveDiscountPercent,
    products: Object.fromEntries(COMMERCIAL_PRODUCT_KEYS.map(key => [key, {
      key,
      label: config.products[key].label,
      enabled: config.products[key].enabled,
      unitPrice: config.products[key].unitPrice,
      quantity: {
        minimum: config.products[key].minimum,
        step: config.products[key].step,
        initial: config.products[key].initialQuantity,
        scope: config.products[key].quantityScope
      }
    }])),
    updatedAt: config.updatedAt
  });
}

export function commercialConfigToProductSnapshot(input = {}, options = {}) {
  const config = normalizeCommercialConfig(input);
  const catalogVersion = positiveInteger(options.catalogVersion);
  if (!catalogVersion) throw commercialConfigError('COMMERCIAL_CONFIG_CATALOG_VERSION_INVALID');

  return deepFreeze({
    metadata: {
      schemaVersion: 1,
      mode: 'active-commercial-config',
      catalogVersion,
      configVersion: config.version,
      loadedByProduction: false
    },
    commercialState: {
      effectiveDiscountPercent: config.effectiveDiscountPercent,
      campaignActive: config.effectiveDiscountPercent > 0,
      maintenanceActive: false,
      orderSavingEnabled: true,
      productionApiEnabled: false
    },
    products: Object.fromEntries(COMMERCIAL_PRODUCT_KEYS.map(key => {
      const product = config.products[key];
      return [key, {
        key,
        label: product.label,
        source: 'admin-commercial-config',
        validationStatus: 'validated',
        activation: {
          catalogEnabled: product.enabled,
          checkoutEnabled: product.enabled,
          productionEnabled: false
        },
        pricing: {
          currency: config.currency,
          unitPrice: product.unitPrice,
          effectiveDiscountPercent: config.effectiveDiscountPercent,
          campaignActive: config.effectiveDiscountPercent > 0
        },
        quantity: {
          initial: product.initialQuantity,
          minimum: product.minimum,
          step: product.step,
          scope: product.quantityScope
        },
        customization: { disabled: false },
        drives: []
      }];
    }))
  });
}

export function commercialConfigUpdatePayload(current = {}, patch = {}, metadata = {}) {
  const currentConfig = normalizeCommercialConfig(current);
  const patchRecord = record(patch);
  const productsPatch = record(patchRecord.products);
  const nextProducts = {};

  for (const key of COMMERCIAL_PRODUCT_KEYS) {
    const previous = currentConfig.products[key];
    const requested = record(productsPatch[key]);
    nextProducts[key] = {
      ...previous,
      ...requested,
      label: previous.label,
      quantityScope: previous.quantityScope
    };
  }

  return normalizeCommercialConfig({
    schemaVersion: currentConfig.schemaVersion,
    version: positiveInteger(metadata.version) || currentConfig.version + 1,
    currency: 'BRL',
    effectiveDiscountPercent: patchRecord.effectiveDiscountPercent ?? currentConfig.effectiveDiscountPercent,
    products: nextProducts,
    updatedAt: metadata.updatedAt,
    updatedBy: metadata.updatedBy
  });
}

function normalizeProduct(key, value, errors) {
  const source = record(value);
  if (!Object.keys(source).length) {
    errors.push(`COMMERCIAL_CONFIG_PRODUCT_REQUIRED:${key}`);
    return null;
  }

  const label = fixedLabel(key);
  const enabled = source.enabled !== false;
  const unitPrice = money(source.unitPrice);
  const minimum = positiveInteger(source.minimum ?? source.quantity?.minimum);
  const step = positiveInteger(source.step ?? source.quantity?.step);
  const initialQuantity = positiveInteger(source.initialQuantity ?? source.initial ?? source.quantity?.initial);
  const quantityScope = fixedScope(key);

  if (unitPrice === null) errors.push(`COMMERCIAL_CONFIG_UNIT_PRICE_INVALID:${key}`);
  if (!minimum) errors.push(`COMMERCIAL_CONFIG_MINIMUM_INVALID:${key}`);
  if (!step) errors.push(`COMMERCIAL_CONFIG_STEP_INVALID:${key}`);
  if (!initialQuantity) errors.push(`COMMERCIAL_CONFIG_INITIAL_INVALID:${key}`);
  if (minimum && initialQuantity && initialQuantity < minimum) {
    errors.push(`COMMERCIAL_CONFIG_INITIAL_BELOW_MINIMUM:${key}`);
  }
  if (minimum && step && initialQuantity && (initialQuantity - minimum) % step !== 0) {
    errors.push(`COMMERCIAL_CONFIG_INITIAL_STEP_MISMATCH:${key}`);
  }

  if (unitPrice === null || !minimum || !step || !initialQuantity) return null;
  return deepFreeze({
    key,
    label,
    enabled,
    unitPrice,
    minimum,
    step,
    initialQuantity,
    quantityScope
  });
}

function fixedLabel(key) {
  return key === '50x50' ? 'Bolinhas 50x50' : 'Painel redondo 150 cm';
}

function fixedScope(key) {
  return key === '50x50' ? 'cart-product-total' : 'item';
}

function money(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) return null;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function percentage(value) {
  const parsed = Number(String(value ?? 0).replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : null;
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function safeActor(value) {
  const text = clean(value);
  return /^[A-Za-z0-9._:@-]{1,120}$/.test(text) ? text : '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function commercialConfigError(code) {
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
