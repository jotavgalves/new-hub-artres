import { PRODUCT_REGISTRY, resolveProductKey } from './registry.mjs';

const REFERENCE_INDEX = deepFreeze(buildReferenceIndex(PRODUCT_REGISTRY));

export function resolveCatalogProductKey(value) {
  const direct = resolveProductKey(value);
  if (direct) return direct;
  return REFERENCE_INDEX[normalizeReference(value)] || null;
}

export function catalogProductReferences(productKey) {
  const canonical = resolveProductKey(productKey);
  if (!canonical) return [];

  return Object.entries(REFERENCE_INDEX)
    .filter(([, key]) => key === canonical)
    .map(([reference]) => reference)
    .sort();
}

function buildReferenceIndex(registry) {
  const index = {};

  for (const definition of Object.values(registry || {})) {
    const references = [
      definition.key,
      definition.label,
      ...(definition.aliases || [])
    ];

    for (const reference of references) {
      const normalized = normalizeReference(reference);
      if (!normalized) continue;
      if (index[normalized] && index[normalized] !== definition.key) {
        throw new Error(`CATALOG_PRODUCT_REFERENCE_COLLISION:${normalized}`);
      }
      index[normalized] = definition.key;
    }
  }

  return index;
}

function normalizeReference(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
