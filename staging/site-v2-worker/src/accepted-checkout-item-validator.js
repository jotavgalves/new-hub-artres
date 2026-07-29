import { resolveCatalogProductKey } from '../../../src/v2/products/catalog-references.mjs';
import { buildItemId, getProductDefinition } from '../../../src/v2/products/registry.mjs';

const MAX_CHECKOUT_ITEMS = 200;

export function validateAcceptedCheckoutItems(requestItems, catalogItems) {
  if (!Array.isArray(requestItems) || requestItems.length < 1) {
    throw validationError('ORDER_ITEMS_REQUIRED');
  }
  if (requestItems.length > MAX_CHECKOUT_ITEMS) {
    throw validationError('ORDER_ITEMS_LIMIT_EXCEEDED');
  }
  if (!Array.isArray(catalogItems) || catalogItems.length < 1) {
    throw validationError('CATALOG_CHECKOUT_ITEMS_REQUIRED');
  }

  const catalogMap = buildCatalogMap(catalogItems);
  const validated = requestItems.map((rawItem, index) => {
    try {
      return validateOneItem(rawItem, catalogMap);
    } catch (error) {
      if (!Number.isInteger(error.itemIndex)) error.itemIndex = index;
      throw error;
    }
  });

  return deepFreeze({
    ok: true,
    itemCount: validated.length,
    productKeys: [...new Set(validated.map(item => item.productKey))],
    variantKeys: [...new Set(validated.map(item => item.variantKey))],
    sizeKeys: [...new Set(validated.map(item => item.sizeKey))],
    items: validated
  });
}

function buildCatalogMap(catalogItems) {
  const map = new Map();
  for (const rawItem of catalogItems) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw validationError('CATALOG_CHECKOUT_ITEM_INVALID');
    }
    const driveFileId = cleanText(rawItem.driveFileId || rawItem.id);
    if (!driveFileId) throw validationError('CATALOG_CHECKOUT_DRIVE_FILE_ID_INVALID');
    if (map.has(driveFileId)) throw validationError('CATALOG_CHECKOUT_DUPLICATED_ITEM');
    map.set(driveFileId, rawItem);
  }
  return map;
}

function validateOneItem(rawItem, catalogMap) {
  if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
    throw validationError('ORDER_ITEM_INVALID');
  }

  const driveFileId = cleanText(rawItem.driveFileId || rawItem.id);
  if (!driveFileId) throw validationError('DRIVE_FILE_ID_REQUIRED');

  const catalogItem = catalogMap.get(driveFileId);
  if (!catalogItem) throw validationError('ARTWORK_NOT_FOUND');

  const catalogProductKey = resolveCatalogProductKey(catalogItem.productKey || catalogItem.product);
  if (!catalogProductKey) throw validationError('CATALOG_PRODUCT_NOT_CONFIGURED');

  const requestedProductSource = rawItem.productKey || rawItem.product;
  const requestedProductKey = requestedProductSource
    ? resolveCatalogProductKey(requestedProductSource)
    : catalogProductKey;
  if (!requestedProductKey) throw validationError('REQUEST_PRODUCT_NOT_CONFIGURED');
  if (requestedProductKey !== catalogProductKey) {
    throw validationError('ARTWORK_PRODUCT_MISMATCH');
  }

  const definition = getProductDefinition(catalogProductKey);
  if (!definition) throw validationError('PRODUCT_NOT_REGISTERED');

  const variantKey = validateVariant(rawItem, definition);
  const sizeKey = validateSize(rawItem, catalogItem);
  const details = rawItem.details === undefined ? {} : rawItem.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    throw validationError('CHECKOUT_DETAILS_INVALID');
  }

  const itemId = buildItemId({
    driveFileId,
    productKey: catalogProductKey,
    variantKey,
    sizeKey
  });

  return deepFreeze({
    itemId,
    driveFileId,
    code: cleanText(catalogItem.code).slice(0, 100),
    originalName: cleanText(catalogItem.originalName || catalogItem.name).slice(0, 1000),
    theme: cleanText(catalogItem.theme).slice(0, 500),
    subtheme: cleanText(catalogItem.subtheme).slice(0, 500),
    productKey: catalogProductKey,
    productName: cleanText(
      catalogItem.productName || catalogItem.productLabel || definition.label || catalogProductKey
    ).slice(0, 160),
    variantKey,
    sizeKey,
    quantity: rawItem.quantity ?? rawItem.qty,
    details: { ...details }
  });
}

function validateVariant(rawItem, definition) {
  const variants = Object.keys(definition.variants || {});
  const requested = cleanIdentity(rawItem.variantKey || rawItem.variant || 'default') || 'default';

  if (!variants.length) {
    if (requested.toLowerCase() !== 'default') {
      throw validationError('VARIANT_NOT_ALLOWED');
    }
    return 'default';
  }

  if (requested.toLowerCase() === 'default') {
    throw validationError('VARIANT_REQUIRED');
  }

  const canonical = variants.find(key => key.toLowerCase() === requested.toLowerCase());
  if (!canonical) throw validationError('VARIANT_NOT_ALLOWED');
  return canonical;
}

function validateSize(rawItem, catalogItem) {
  const catalogSize = cleanIdentity(catalogItem.sizeKey || catalogItem.size || 'default') || 'default';
  const requestedSource = rawItem.sizeKey || rawItem.size;
  const requested = requestedSource ? cleanIdentity(requestedSource) : catalogSize;

  if (!requested || requested.toLowerCase() !== catalogSize.toLowerCase()) {
    throw validationError('ARTWORK_SIZE_MISMATCH');
  }
  return catalogSize;
}

function cleanIdentity(value) {
  return cleanText(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function validationError(code) {
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
