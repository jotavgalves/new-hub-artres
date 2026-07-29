import {
  buildItemId,
  resolveProductKey
} from '../products/registry.mjs';

export const CART_LINE_IDENTITY_VERSION = 1;

export function createCartLineIdentity(input = {}) {
  const driveFileId = firstText(
    input.driveFileId,
    input.driveId,
    input.drive_id,
    input.artworkId,
    input.id
  );
  const requestedProductKey = firstText(
    input.productKey,
    input.product,
    input.productId
  );
  const productKey = resolveProductKey(requestedProductKey);

  if (!driveFileId) throw identityError('CART_LINE_DRIVE_FILE_ID_REQUIRED');
  if (!productKey) throw identityError('CART_LINE_PRODUCT_KEY_INVALID');

  const variantKey = resolveVariantKey(input, productKey);
  const sizeKey = resolveSizeKey(input);
  const lineId = buildItemId({
    driveFileId,
    productKey,
    variantKey,
    sizeKey
  });
  const [canonicalDriveFileId, canonicalProductKey, canonicalVariantKey, canonicalSizeKey] = lineId.split(':');

  return deepFreeze({
    version: CART_LINE_IDENTITY_VERSION,
    lineId,
    itemId: lineId,
    driveFileId: canonicalDriveFileId,
    productKey: canonicalProductKey,
    variantKey: canonicalVariantKey,
    sizeKey: canonicalSizeKey
  });
}

export function attachCartLineIdentity(item = {}) {
  const identity = createCartLineIdentity(item);
  return deepFreeze({
    ...item,
    lineId: identity.lineId,
    itemId: identity.itemId,
    driveFileId: identity.driveFileId,
    productKey: identity.productKey,
    variantKey: identity.variantKey,
    sizeKey: identity.sizeKey
  });
}

export function cartLineId(input = {}) {
  return createCartLineIdentity(input).lineId;
}

export function sameCartLine(left = {}, right = {}) {
  try {
    return cartLineId(left) === cartLineId(right);
  } catch (_) {
    return false;
  }
}

export function indexCartLines(lines = []) {
  if (!Array.isArray(lines)) throw identityError('CART_LINES_ARRAY_REQUIRED');

  const index = new Map();
  for (let position = 0; position < lines.length; position += 1) {
    const line = lines[position];
    const identity = createCartLineIdentity(line);
    if (index.has(identity.lineId)) {
      const error = identityError('CART_LINE_ID_DUPLICATED');
      error.lineId = identity.lineId;
      error.firstIndex = index.get(identity.lineId).index;
      error.duplicateIndex = position;
      throw error;
    }
    index.set(identity.lineId, deepFreeze({
      index: position,
      identity,
      line
    }));
  }

  return index;
}

export function findCartLine(lines = [], candidate = {}) {
  if (!Array.isArray(lines)) return null;
  let lineId;
  try {
    lineId = cartLineId(candidate);
  } catch (_) {
    return null;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    try {
      if (cartLineId(line) === lineId) {
        return deepFreeze({ index, lineId, line });
      }
    } catch (_) {
      // Linhas legadas inválidas são ignoradas e serão tratadas na etapa de migração.
    }
  }
  return null;
}

function resolveVariantKey(input, productKey) {
  const details = record(input.details);
  const candidate = firstText(
    input.variantKey,
    input.variant,
    details.variantKey,
    details.variant,
    productKey === 'sacolinha' ? details.size : ''
  );
  return candidate || 'default';
}

function resolveSizeKey(input) {
  const details = record(input.details);
  return firstText(
    input.sizeKey,
    input.size,
    details.sizeKey,
    details.size
  ) || 'default';
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function identityError(code) {
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
