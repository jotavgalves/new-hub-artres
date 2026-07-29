import { cartLineId } from './line-identity.mjs';
import { validateCartQuantityRules } from './quantity-rules.mjs';
import { applyCartVariantSize } from './variant-size.mjs';
import { resolveProductKey } from '../products/registry.mjs';

export const CART_MIGRATION_VERSION = 1;
export const MIGRATED_CART_SCHEMA_VERSION = 2;

const MAX_SOURCE_LENGTH = 2_000_000;
const MAX_CART_LINES = 500;

export function migrateLegacyCartSource(source, options = {}) {
  const decoded = parseLegacyCartSource(source);
  const envelope = extractLegacyEnvelope(decoded.parsed);
  const catalogMap = buildCatalogMap(options.catalogItems || []);
  const requireCatalogMatch = options.requireCatalogMatch !== false;
  const migrated = [];
  const reviewLines = [];
  const seen = new Map();

  for (let index = 0; index < envelope.cart.length; index += 1) {
    const original = cloneJson(envelope.cart[index], 'LEGACY_CART_LINE_NOT_SERIALIZABLE');

    try {
      const line = migrateLegacyLine(original, {
        catalogMap,
        requireCatalogMatch
      });
      const lineId = cartLineId(line);

      if (seen.has(lineId)) {
        reviewLines.push(reviewLine(index, 'LEGACY_CART_DUPLICATE_LINE_ID', original, {
          lineId,
          duplicateOf: seen.get(lineId)
        }));
        continue;
      }

      seen.set(lineId, index);
      migrated.push(line);
    } catch (error) {
      reviewLines.push(reviewLine(index, publicCode(error), original));
    }
  }

  const quantityValidation = options.quantitySnapshot
    ? validateMigratedQuantities(migrated, options.quantitySnapshot)
    : deepFreeze({
      checked: false,
      ok: migrated.length === 0,
      errors: migrated.length ? ['LEGACY_CART_QUANTITY_SNAPSHOT_REQUIRED'] : []
    });

  const status = envelope.cart.length === 0
    ? 'empty'
    : reviewLines.length === 0 && quantityValidation.ok
      ? 'ready'
      : 'needs-review';

  const plan = {
    schemaVersion: MIGRATED_CART_SCHEMA_VERSION,
    migrationVersion: CART_MIGRATION_VERSION,
    mode: 'passive-no-write',
    sourceType: decoded.sourceType,
    status,
    seller: canonicalSeller(envelope.seller),
    cart: migrated,
    review: {
      lines: reviewLines,
      quantityErrors: quantityValidation.errors
    },
    report: {
      sourceLineCount: envelope.cart.length,
      migratedLineCount: migrated.length,
      reviewLineCount: reviewLines.length,
      quantityChecked: quantityValidation.checked,
      quantityValid: quantityValidation.ok,
      backupPreserved: true,
      writePerformed: false
    },
    backup: {
      format: 'legacy-cart-backup-v1',
      sourceType: decoded.sourceType,
      raw: decoded.raw,
      parsed: decoded.parsed
    }
  };

  return deepFreeze(cloneJson(plan, 'LEGACY_CART_MIGRATION_PLAN_NOT_SERIALIZABLE'));
}

export function parseLegacyCartSource(source) {
  if (typeof source === 'string') {
    if (source.length > MAX_SOURCE_LENGTH) throw migrationError('LEGACY_CART_SOURCE_TOO_LARGE');
    const raw = source;
    const trimmed = source.trim();
    if (!trimmed) throw migrationError('LEGACY_CART_SOURCE_EMPTY');

    try {
      return deepFreeze({
        sourceType: 'storage-json',
        raw,
        parsed: cloneJson(JSON.parse(trimmed), 'LEGACY_CART_SOURCE_NOT_SERIALIZABLE')
      });
    } catch (jsonError) {
      try {
        const decoded = decodeLegacyCartSharePayload(trimmed);
        return deepFreeze({
          sourceType: 'share-base64',
          raw,
          parsed: cloneJson(JSON.parse(decoded), 'LEGACY_CART_SOURCE_NOT_SERIALIZABLE')
        });
      } catch (shareError) {
        throw migrationError('LEGACY_CART_SOURCE_INVALID');
      }
    }
  }

  if (Array.isArray(source) || isRecord(source)) {
    const parsed = cloneJson(source, 'LEGACY_CART_SOURCE_NOT_SERIALIZABLE');
    const raw = JSON.stringify(parsed);
    if (raw.length > MAX_SOURCE_LENGTH) throw migrationError('LEGACY_CART_SOURCE_TOO_LARGE');
    return deepFreeze({
      sourceType: Array.isArray(parsed) ? 'array-object' : 'envelope-object',
      raw,
      parsed
    });
  }

  throw migrationError('LEGACY_CART_SOURCE_INVALID');
}

export function decodeLegacyCartSharePayload(payload) {
  const value = String(payload || '').trim();
  if (!value) throw migrationError('LEGACY_CART_SHARE_PAYLOAD_EMPTY');
  if (value.length > MAX_SOURCE_LENGTH) throw migrationError('LEGACY_CART_SOURCE_TOO_LARGE');

  try {
    const binary = globalThis.atob(value);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    throw migrationError('LEGACY_CART_SHARE_PAYLOAD_INVALID');
  }
}

export function encodeLegacyCartSharePayload(value) {
  const serialized = typeof value === 'string'
    ? value
    : JSON.stringify(cloneJson(value, 'LEGACY_CART_SOURCE_NOT_SERIALIZABLE'));
  if (!serialized || serialized.length > MAX_SOURCE_LENGTH) {
    throw migrationError('LEGACY_CART_SOURCE_TOO_LARGE');
  }

  const bytes = new TextEncoder().encode(serialized);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

export function createMigratedCartEnvelope(plan = {}) {
  assertMigrationPlan(plan);
  if (plan.status !== 'ready' && plan.status !== 'empty') {
    throw migrationError('LEGACY_CART_MIGRATION_REVIEW_REQUIRED');
  }

  return deepFreeze(cloneJson({
    schemaVersion: MIGRATED_CART_SCHEMA_VERSION,
    migrationVersion: CART_MIGRATION_VERSION,
    cart: plan.cart,
    seller: plan.seller
  }, 'MIGRATED_CART_ENVELOPE_NOT_SERIALIZABLE'));
}

export function restoreLegacyCartBackup(plan = {}, options = {}) {
  assertMigrationPlan(plan);
  if (options.format === 'raw') return String(plan.backup.raw);
  return cloneJson(plan.backup.parsed, 'LEGACY_CART_BACKUP_NOT_SERIALIZABLE');
}

function migrateLegacyLine(original, options) {
  if (!isRecord(original)) throw migrationError('LEGACY_CART_LINE_INVALID');

  const legacyDriveFileId = identityText(
    original.driveFileId,
    original.driveId,
    original.drive_id,
    original.artworkId,
    original.id
  );
  if (!legacyDriveFileId) throw migrationError('LEGACY_CART_DRIVE_FILE_ID_REQUIRED');

  const catalogItem = options.catalogMap.get(legacyDriveFileId) || null;
  if (options.requireCatalogMatch && !catalogItem) {
    throw migrationError('LEGACY_CART_CATALOG_MATCH_REQUIRED');
  }

  const legacyProductKey = resolveProductKey(
    original.productKey || original.product || original.productId
  );
  const catalogProductKey = catalogItem
    ? resolveProductKey(catalogItem.productKey || catalogItem.product)
    : null;

  if (catalogItem && !catalogProductKey) {
    throw migrationError('LEGACY_CART_CATALOG_PRODUCT_INVALID');
  }
  if (legacyProductKey && catalogProductKey && legacyProductKey !== catalogProductKey) {
    throw migrationError('LEGACY_CART_PRODUCT_MISMATCH');
  }

  const productKey = catalogProductKey || legacyProductKey;
  if (!productKey) throw migrationError('LEGACY_CART_PRODUCT_KEY_INVALID');

  const quantity = strictPositiveInteger(original.quantity ?? original.qty);
  if (!quantity) throw migrationError('LEGACY_CART_QUANTITY_INVALID');

  const candidate = {
    ...original,
    driveFileId: catalogItem?.driveFileId || catalogItem?.id || legacyDriveFileId,
    product: productKey,
    productKey,
    code: text(original.code || original.codigo || catalogItem?.code),
    originalName: text(
      original.originalName || original.fileName || original.filename ||
      catalogItem?.originalName || catalogItem?.name
    ),
    theme: text(original.theme || catalogItem?.theme),
    subtheme: text(original.subtheme || catalogItem?.subtheme),
    productName: text(original.productName || catalogItem?.productName),
    sizeKey: text(original.sizeKey || catalogItem?.sizeKey || catalogItem?.size),
    details: cloneJson(isRecord(original.details) ? original.details : {}, 'LEGACY_CART_DETAILS_NOT_SERIALIZABLE')
  };

  const identified = applyCartVariantSize(candidate);
  return deepFreeze({
    ...identified,
    quantity,
    qty: quantity,
    migration: {
      version: CART_MIGRATION_VERSION,
      source: 'legacy-cart',
      catalogMatched: Boolean(catalogItem)
    }
  });
}

function validateMigratedQuantities(lines, snapshot) {
  const validation = validateCartQuantityRules(lines, snapshot);
  return deepFreeze({
    checked: true,
    ok: validation.ok,
    errors: validation.errors
  });
}

function buildCatalogMap(items) {
  if (!Array.isArray(items)) throw migrationError('LEGACY_CART_CATALOG_ITEMS_ARRAY_REQUIRED');
  const map = new Map();

  for (const item of items) {
    if (!isRecord(item)) continue;
    const driveFileId = identityText(item.driveFileId, item.id, item.drive_id);
    if (!driveFileId) continue;
    if (map.has(driveFileId)) throw migrationError('LEGACY_CART_CATALOG_ID_DUPLICATED');
    map.set(driveFileId, item);
  }

  return map;
}

function extractLegacyEnvelope(parsed) {
  if (Array.isArray(parsed)) {
    if (parsed.length > MAX_CART_LINES) throw migrationError('LEGACY_CART_LINE_LIMIT_EXCEEDED');
    return { cart: parsed, seller: null };
  }
  if (!isRecord(parsed)) throw migrationError('LEGACY_CART_ENVELOPE_INVALID');

  const cart = Array.isArray(parsed.cart)
    ? parsed.cart
    : Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.carrinho)
        ? parsed.carrinho
        : [];

  if (cart.length > MAX_CART_LINES) throw migrationError('LEGACY_CART_LINE_LIMIT_EXCEEDED');
  return {
    cart,
    seller: parsed.seller ?? parsed.sellerId ?? parsed.vendedora ?? null
  };
}

function canonicalSeller(value) {
  if (typeof value === 'string') return value.trim().slice(0, 100) || null;
  if (!isRecord(value)) return null;
  return text(value.id || value.sellerId || value.username || value.key || value.name).slice(0, 100) || null;
}

function reviewLine(index, reason, original, details = {}) {
  return deepFreeze({
    index,
    reason,
    details: cloneJson(details, 'LEGACY_CART_REVIEW_DETAILS_NOT_SERIALIZABLE'),
    original
  });
}

function assertMigrationPlan(plan) {
  if (!isRecord(plan) || plan.schemaVersion !== MIGRATED_CART_SCHEMA_VERSION) {
    throw migrationError('LEGACY_CART_MIGRATION_PLAN_INVALID');
  }
  if (!isRecord(plan.backup) || !Object.hasOwn(plan.backup, 'parsed')) {
    throw migrationError('LEGACY_CART_BACKUP_REQUIRED');
  }
}

function publicCode(error) {
  const code = String(error?.code || '');
  return /^[A-Z0-9_]{3,100}$/.test(code) ? code : 'LEGACY_CART_LINE_MIGRATION_FAILED';
}

function identityText(...values) {
  for (const value of values) {
    const normalized = text(value)
      .replace(/[:\s]+/g, '-')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    if (normalized) return normalized;
  }
  return '';
}

function strictPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value, errorCode) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('undefined');
    return JSON.parse(serialized);
  } catch (_) {
    throw migrationError(errorCode);
  }
}

function migrationError(code) {
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
