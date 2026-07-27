import { getProductDefinition, resolveProductKey } from './registry.mjs';

const PASSIVE_ACTIVATION = Object.freeze({
  catalogEnabled: false,
  checkoutEnabled: false,
  productionEnabled: false
});

export function createCurrentSafetySnapshot(input = {}) {
  const errors = [];
  const warnings = [];
  const products = {};
  const sourceProducts = isRecord(input.products) ? input.products : {};
  const catalog = Array.isArray(input.productCatalog) ? input.productCatalog : [];
  const drives = Array.isArray(input.drives) ? input.drives : [];

  if (input.source !== 'kv') warnings.push('SOURCE_NOT_CONFIRMED_AS_KV');
  if (input.storageReady !== true) errors.push('CONFIG_STORAGE_NOT_READY');
  if (!catalog.length) errors.push('PRODUCT_CATALOG_EMPTY');

  for (const catalogEntry of catalog) {
    if (!catalogEntry || catalogEntry.active === false) continue;

    const canonicalKey = resolveProductKey(catalogEntry.productKey);
    if (!canonicalKey) {
      errors.push(`PRODUCT_NOT_REGISTERED:${clean(catalogEntry.productKey || catalogEntry.id)}`);
      continue;
    }

    const legacyDefinition = findLegacyDefinition(sourceProducts, catalogEntry, canonicalKey);
    if (!legacyDefinition) {
      errors.push(`PRODUCT_CONFIG_MISSING:${canonicalKey}`);
      continue;
    }

    const unitPrice = positiveNumber(legacyDefinition.unitPrice);
    const minimum = positiveInteger(legacyDefinition.minQty);
    const step = positiveInteger(legacyDefinition.step);

    if (!unitPrice) errors.push(`UNIT_PRICE_INVALID:${canonicalKey}`);
    if (!minimum) errors.push(`MINIMUM_QUANTITY_INVALID:${canonicalKey}`);
    if (!step) errors.push(`QUANTITY_STEP_INVALID:${canonicalKey}`);
    if (!unitPrice || !minimum || !step) continue;

    const registered = getProductDefinition(canonicalKey);
    const matchingDrives = drives
      .filter(drive => drive && drive.active !== false && resolveProductKey(drive.productKey) === canonicalKey)
      .map(drive => sanitizeDrive(drive));

    if (!matchingDrives.length) errors.push(`ACTIVE_DRIVE_MISSING:${canonicalKey}`);
    if (matchingDrives.some(drive => !drive.folderIdConfigured)) {
      errors.push(`DRIVE_FOLDER_NOT_CONFIGURED:${canonicalKey}`);
    }

    products[canonicalKey] = deepFreeze({
      key: canonicalKey,
      label: clean(catalogEntry.label || legacyDefinition.label || registered?.label || canonicalKey),
      sourceId: clean(catalogEntry.id),
      source: 'current-safety-kv',
      compatibilityStatus: 'observed-effective',
      validationStatus: 'staging-required',
      activation: PASSIVE_ACTIVATION,
      blockedReasons: [
        'PASSIVE_SNAPSHOT',
        'STAGING_NOT_CONFIGURED',
        'SERVER_VALIDATION_NOT_IMPLEMENTED'
      ],
      pricing: {
        currency: 'BRL',
        unitPrice,
        effectiveDiscountPercent: nonNegativeNumber(input.ui?.discountPercent) ?? 0,
        campaignActive: input.campaign?.active === true
      },
      quantity: {
        minimum,
        step,
        scope: 'cart-product-total'
      },
      customization: {
        disabled: legacyDefinition.disableCustomization === true
      },
      navigation: {
        skipProductsStep: legacyDefinition.skipProductsStep === true
      },
      drives: matchingDrives
    });
  }

  const effectiveDiscount = nonNegativeNumber(input.ui?.discountPercent);
  const campaignDiscount = nonNegativeNumber(input.campaign?.discountPercent);

  if (input.campaign?.active === false && effectiveDiscount && effectiveDiscount > 0) {
    warnings.push('DISCOUNT_ACTIVE_WITH_CAMPAIGN_DISABLED');
  }

  if (input.campaign?.active === true && campaignDiscount !== effectiveDiscount) {
    warnings.push('CAMPAIGN_AND_UI_DISCOUNT_DIVERGE');
  }

  const catalogVersion = positiveInteger(
    input.catalogMeta?.catalogVersion || input.catalogRules?.catalogVersion || input.ui?.cacheVersion
  );

  if (!catalogVersion) errors.push('CATALOG_VERSION_INVALID');

  return deepFreeze({
    metadata: {
      schemaVersion: 1,
      mode: 'passive-compatibility-snapshot',
      source: clean(input.source || 'unknown'),
      capturedAt: clean(input.capturedAt),
      configVersion: positiveInteger(input.version),
      catalogVersion,
      storageReady: input.storageReady === true,
      loadedByProduction: false
    },
    commercialState: {
      effectiveDiscountPercent: effectiveDiscount ?? 0,
      campaignActive: input.campaign?.active === true,
      maintenanceActive: input.maintenance?.active === true,
      orderSavingEnabled: input.orderSettings?.saveOrders === true,
      productionApiEnabled: input.productionApi?.enabled === true
    },
    products,
    errors: unique(errors),
    warnings: unique(warnings)
  });
}

export function validateCurrentSafetySnapshot(snapshot) {
  const errors = [];

  if (!snapshot || snapshot.metadata?.mode !== 'passive-compatibility-snapshot') {
    errors.push('SNAPSHOT_MODE_INVALID');
  }

  if (snapshot?.metadata?.loadedByProduction !== false) {
    errors.push('SNAPSHOT_MUST_NOT_LOAD_IN_PRODUCTION');
  }

  for (const [key, product] of Object.entries(snapshot?.products || {})) {
    if (key !== product.key) errors.push(`PRODUCT_KEY_MISMATCH:${key}`);
    if (!product.pricing?.unitPrice) errors.push(`UNIT_PRICE_REQUIRED:${key}`);
    if (!product.quantity?.minimum) errors.push(`MINIMUM_REQUIRED:${key}`);
    if (!product.quantity?.step) errors.push(`STEP_REQUIRED:${key}`);
    if (Object.values(product.activation || {}).some(Boolean)) {
      errors.push(`PASSIVE_PRODUCT_ACTIVATED:${key}`);
    }
    if (!Array.isArray(product.drives) || !product.drives.length) {
      errors.push(`DRIVE_REQUIRED:${key}`);
    }
  }

  return {
    ok: errors.length === 0 && (snapshot?.errors || []).length === 0,
    errors: unique([...(snapshot?.errors || []), ...errors]),
    warnings: unique(snapshot?.warnings || [])
  };
}

function findLegacyDefinition(sourceProducts, catalogEntry, canonicalKey) {
  const candidates = [
    catalogEntry.id,
    canonicalKey,
    Object.keys(sourceProducts).find(key => resolveProductKey(sourceProducts[key]?.productKey) === canonicalKey)
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (isRecord(sourceProducts[candidate])) return sourceProducts[candidate];
  }

  return null;
}

function sanitizeDrive(drive) {
  return deepFreeze({
    id: clean(drive.id),
    name: clean(drive.name),
    type: clean(drive.type),
    productKey: resolveProductKey(drive.productKey),
    structure: clean(drive.structure),
    filenamePattern: clean(drive.filenamePattern),
    folderIdConfigured: drive.folderIdConfigured === true || Boolean(clean(drive.folderId)),
    folderIdLength: positiveInteger(drive.folderIdLength || clean(drive.folderId).length)
  });
}

function positiveNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clean(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
