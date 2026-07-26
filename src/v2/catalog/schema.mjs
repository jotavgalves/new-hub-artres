import { requireProductDefinition, resolveProductKey } from '../products/registry.mjs';

export const CATALOG_SCHEMA_VERSION = 2;

export function createCatalogContext(input = {}) {
  const catalogVersion = positiveInteger(input.catalogVersion);
  if (!catalogVersion) throw catalogError('CATALOG_VERSION_REQUIRED');

  const roots = {};
  for (const raw of Array.isArray(input.roots) ? input.roots : []) {
    if (!raw || raw.active === false) continue;

    const rootDriveId = identity(raw.rootDriveId || raw.folderId || raw.id);
    if (!rootDriveId) throw catalogError('ROOT_DRIVE_ID_REQUIRED');
    if (Object.hasOwn(roots, rootDriveId)) throw catalogError('ROOT_DRIVE_DUPLICATED', rootDriveId);

    const product = requireProductDefinition(raw.productKey);
    roots[rootDriveId] = deepFreeze({
      rootDriveId,
      driveId: identity(raw.driveId || raw.id || rootDriveId),
      productKey: product.key,
      productName: clean(raw.productName || raw.label || product.label),
      structure: clean(raw.structure || 'theme-or-subtheme-images'),
      active: true
    });
  }

  if (!Object.keys(roots).length) throw catalogError('CATALOG_ROOTS_REQUIRED');

  return deepFreeze({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion,
    mode: 'passive-contract',
    loadedByProduction: false,
    roots
  });
}

export function mapCatalogRowV2(row = {}, context, options = {}) {
  assertContext(context);

  if (row.deleted_at || row.deletedAt) throw rowError('ROW_DELETED', row);

  const driveId = identity(row.drive_id || row.driveId || row.id);
  const rootDriveId = identity(row.root_drive_id || row.rootDriveId);
  const parentDriveId = identity(row.parent_drive_id || row.parentDriveId);
  const type = normalizeType(row.type);

  if (!driveId) throw rowError('DRIVE_ID_MISSING', row);
  if (!rootDriveId) throw rowError('ROOT_DRIVE_ID_MISSING', row);

  const root = context.roots[rootDriveId];
  if (!root) throw rowError('ROOT_DRIVE_NOT_CONFIGURED', row, rootDriveId);

  const expectedRootDriveId = identity(options.expectedRootDriveId);
  if (expectedRootDriveId && rootDriveId !== expectedRootDriveId) {
    throw rowError('ROW_OUTSIDE_REQUESTED_ROOT', row, `${rootDriveId}:${expectedRootDriveId}`);
  }

  if (!['folder', 'artwork'].includes(type)) throw rowError('ROW_TYPE_INVALID', row, type);

  const explicitProduct = clean(row.product);
  if (explicitProduct) {
    const explicitProductKey = resolveProductKey(explicitProduct);
    if (!explicitProductKey) throw rowError('PRODUCT_NOT_CONFIGURED', row, explicitProduct);
    if (explicitProductKey !== root.productKey) {
      throw rowError('PRODUCT_ROOT_MISMATCH', row, `${explicitProductKey}:${root.productKey}`);
    }
  }

  if (type === 'folder') return mapFolder(row, { driveId, rootDriveId, parentDriveId, root });
  return mapArtwork(row, { driveId, rootDriveId, parentDriveId, root });
}

export function mapCatalogRowsV2(rows = [], context, options = {}) {
  assertContext(context);
  const items = [];
  const rejected = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      items.push(mapCatalogRowV2(row, context, options));
    } catch (error) {
      rejected.push(deepFreeze({
        driveId: identity(row?.drive_id || row?.driveId || row?.id),
        code: cleanCode(row?.code),
        error: error?.code || 'CATALOG_ROW_INVALID',
        detail: clean(error?.detail).slice(0, 200)
      }));
    }
  }

  if (options.strict === true && rejected.length) {
    const error = catalogError('CATALOG_ROWS_REJECTED');
    error.rejected = rejected;
    throw error;
  }

  return deepFreeze({
    items,
    rejected,
    acceptedCount: items.length,
    rejectedCount: rejected.length
  });
}

export function buildCatalogResponseV2(input = {}) {
  const context = input.context;
  assertContext(context);

  const rootDriveId = identity(input.rootDriveId);
  if (!rootDriveId) throw catalogError('ROOT_DRIVE_ID_REQUIRED');
  if (!context.roots[rootDriveId]) throw catalogError('ROOT_DRIVE_NOT_CONFIGURED', rootDriveId);

  const mapped = mapCatalogRowsV2(input.rows, context, {
    expectedRootDriveId: rootDriveId,
    strict: input.strict === true
  });

  const folders = mapped.items.filter(item => item.kind === 'folder');
  const artworks = mapped.items.filter(item => item.kind === 'artwork');

  return deepFreeze({
    ok: mapped.rejectedCount === 0,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: context.catalogVersion,
    rootDriveId,
    acceptedCount: mapped.acceptedCount,
    rejectedCount: mapped.rejectedCount,
    folders,
    artworks,
    rejected: mapped.rejected
  });
}

export function validateCatalogContext(context) {
  const errors = [];

  if (!context || context.schemaVersion !== CATALOG_SCHEMA_VERSION) errors.push('CATALOG_SCHEMA_VERSION_INVALID');
  if (!positiveInteger(context?.catalogVersion)) errors.push('CATALOG_VERSION_REQUIRED');
  if (context?.loadedByProduction !== false) errors.push('CATALOG_CONTEXT_MUST_BE_PASSIVE');

  const roots = Object.values(context?.roots || {});
  if (!roots.length) errors.push('CATALOG_ROOTS_REQUIRED');

  for (const root of roots) {
    if (!identity(root.rootDriveId)) errors.push('ROOT_DRIVE_ID_REQUIRED');
    if (!resolveProductKey(root.productKey)) errors.push(`PRODUCT_NOT_CONFIGURED:${clean(root.productKey)}`);
  }

  return {
    ok: errors.length === 0,
    errors: unique(errors)
  };
}

function mapFolder(row, resolved) {
  return deepFreeze({
    id: resolved.driveId,
    parentId: resolved.parentDriveId,
    rootDriveId: resolved.rootDriveId,
    name: clean(row.name || row.theme || row.subtheme || 'Pasta'),
    rawName: clean(row.name),
    kind: 'folder',
    type: 'folder',
    theme: clean(row.theme),
    subtheme: clean(row.subtheme),
    productKey: resolved.root.productKey,
    productName: resolved.root.productName,
    depth: nonNegativeInteger(row.depth),
    path: clean(row.path)
  });
}

function mapArtwork(row, resolved) {
  const code = cleanCode(row.code || row.name);
  if (!code) throw rowError('ARTWORK_CODE_MISSING', row);

  const image = clean(row.thumbnail_url || row.thumbnailUrl || row.image);

  return deepFreeze({
    id: resolved.driveId,
    driveFileId: resolved.driveId,
    rootDriveId: resolved.rootDriveId,
    parentDriveId: resolved.parentDriveId,
    code,
    originalName: clean(row.name),
    theme: clean(row.theme || 'Sem tema'),
    subtheme: clean(row.subtheme),
    productKey: resolved.root.productKey,
    productName: resolved.root.productName,
    sizeKey: clean(row.size || 'default'),
    mimeType: clean(row.mime_type || row.mimeType),
    image,
    driveUrl: clean(row.drive_url || row.driveUrl),
    path: clean(row.path),
    kind: 'artwork',
    type: 'artwork',
    indexedAt: validIsoDate(row.indexed_at || row.indexedAt)
  });
}

function assertContext(context) {
  const result = validateCatalogContext(context);
  if (!result.ok) {
    const error = catalogError('CATALOG_CONTEXT_INVALID');
    error.details = result.errors;
    throw error;
  }
}

function normalizeType(value) {
  const type = clean(value).toLowerCase();
  if (['art', 'arte', 'file', 'image'].includes(type)) return 'artwork';
  if (['directory', 'dir', 'pasta'].includes(type)) return 'folder';
  return type;
}

function rowError(code, row, detail = '') {
  const error = catalogError(code, detail);
  error.driveId = identity(row?.drive_id || row?.driveId || row?.id);
  error.rowType = clean(row?.type);
  return error;
}

function catalogError(code, detail = '') {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
}

function cleanCode(value) {
  return String(value ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function identity(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
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
