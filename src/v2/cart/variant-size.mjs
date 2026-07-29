import {
  getProductDefinition,
  resolveProductKey
} from '../products/registry.mjs';
import { addCartLine } from './collection.mjs';
import { attachCartLineIdentity } from './line-identity.mjs';

export function resolveCartVariantSize(input = {}, selection = {}) {
  const details = record(input.details);
  const selectedDetails = record(selection.details);
  const requestedProduct = firstText(
    selection.productKey,
    selection.product,
    input.productKey,
    input.product,
    input.productId
  );
  const productKey = resolveProductKey(requestedProduct);
  const product = getProductDefinition(productKey);

  if (!productKey || !product) throw variantSizeError('CART_LINE_PRODUCT_KEY_INVALID');

  const variantCandidate = firstText(
    selection.variantKey,
    selection.variant,
    selectedDetails.variantKey,
    selectedDetails.variant,
    input.variantKey,
    input.variant,
    details.variantKey,
    details.variant,
    product.kind === 'bag' ? selection.size : '',
    product.kind === 'bag' ? selectedDetails.size : '',
    product.kind === 'bag' ? input.size : '',
    product.kind === 'bag' ? details.size : ''
  );

  const variantKey = canonicalVariant(product, variantCandidate);
  const sizeKey = product.kind === 'bag'
    ? 'default'
    : firstText(
      selection.sizeKey,
      selection.size,
      selectedDetails.sizeKey,
      selectedDetails.size,
      input.sizeKey,
      input.size,
      details.sizeKey,
      details.size
    ) || 'default';

  const knownVariant = product.variants?.[variantKey] || null;

  return deepFreeze({
    productKey,
    variantKey,
    sizeKey,
    variantLabel: knownVariant?.label || (variantKey === 'default' ? '' : variantKey),
    sizeLabel: sizeKey === 'default' ? '' : sizeKey,
    closedVariant: Object.keys(product.variants || {}).length > 0,
    measurementType: product.measurements?.type || 'none'
  });
}

export function applyCartVariantSize(input = {}, selection = {}) {
  const resolved = resolveCartVariantSize(input, selection);
  const details = {
    ...record(input.details),
    ...record(selection.details),
    variantKey: resolved.variantKey,
    sizeKey: resolved.sizeKey
  };

  if (resolved.productKey === 'sacolinha') {
    details.size = resolved.variantKey;
  }

  return attachCartLineIdentity({
    ...input,
    product: resolved.productKey,
    productKey: resolved.productKey,
    variantKey: resolved.variantKey,
    sizeKey: resolved.sizeKey,
    details
  });
}

export function addCartVariantSizeLine(lines = [], input = {}, selection = {}, options = {}) {
  return addCartLine(lines, applyCartVariantSize(input, selection), options);
}

export function cartVariantSizeKey(input = {}, selection = {}) {
  const resolved = resolveCartVariantSize(input, selection);
  return [resolved.productKey, resolved.variantKey, resolved.sizeKey].join(':');
}

export function sameCartVariantSize(left = {}, right = {}) {
  try {
    return cartVariantSizeKey(left) === cartVariantSizeKey(right);
  } catch (_) {
    return false;
  }
}

function canonicalVariant(product, candidate) {
  const variants = Object.values(product.variants || {});
  if (!variants.length) return candidate || 'default';
  if (!candidate) throw variantSizeError('CART_LINE_VARIANT_REQUIRED');

  const normalized = normalize(candidate);
  const matched = variants.find(variant => (
    normalize(variant.key) === normalized || normalize(variant.label) === normalized
  ));

  if (!matched) {
    const error = variantSizeError('CART_LINE_VARIANT_INVALID');
    error.productKey = product.key;
    throw error;
  }

  return matched.key;
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function variantSizeError(code) {
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
