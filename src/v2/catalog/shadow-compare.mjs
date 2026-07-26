import { resolveCatalogProductKey } from '../products/catalog-references.mjs';

export function compareCatalogShadow(input = {}) {
  const maxDetails = clamp(input.maxDetails, 1, 500, 100);
  const legacy = normalizeLegacy(input.legacy || {});
  const v2 = normalizeV2(input.v2 || {});

  const folderDiff = compareCollection(legacy.folders, v2.folders, compareFolder, maxDetails);
  const artworkDiff = compareCollection(legacy.artworks, v2.artworks, compareArtwork, maxDetails);
  const errors = [];

  if (!legacy.catalogVersion) errors.push('LEGACY_CATALOG_VERSION_MISSING');
  if (!v2.catalogVersion) errors.push('V2_CATALOG_VERSION_MISSING');
  if (legacy.catalogVersion && v2.catalogVersion && legacy.catalogVersion !== v2.catalogVersion) {
    errors.push(`CATALOG_VERSION_MISMATCH:${legacy.catalogVersion}:${v2.catalogVersion}`);
  }

  const summary = {
    legacyFolders: legacy.folders.length,
    v2Folders: v2.folders.length,
    legacyArtworks: legacy.artworks.length,
    v2Artworks: v2.artworks.length,
    missingFoldersInV2: folderDiff.totals.missing,
    extraFoldersInV2: folderDiff.totals.extra,
    changedFolders: folderDiff.totals.changed,
    missingArtworksInV2: artworkDiff.totals.missing,
    extraArtworksInV2: artworkDiff.totals.extra,
    changedArtworks: artworkDiff.totals.changed,
    detailLimit: maxDetails
  };

  const totalDifferences = Object.entries(summary)
    .filter(([key]) => !['legacyFolders', 'v2Folders', 'legacyArtworks', 'v2Artworks', 'detailLimit'].includes(key))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0) + errors.length;

  return deepFreeze({
    mode: 'shadow-comparison',
    schemaVersion: 1,
    equivalent: totalDifferences === 0,
    totalDifferences,
    versions: {
      legacy: legacy.catalogVersion,
      v2: v2.catalogVersion
    },
    summary,
    differences: {
      folders: folderDiff,
      artworks: artworkDiff
    },
    errors,
    valuesExposed: false
  });
}

function normalizeLegacy(payload) {
  const folders = (payload.folders || payload.themes || payload.products || [])
    .filter(Boolean)
    .map(folder => ({
      id: identity(folder.id || folder.driveId || folder.drive_id),
      parentId: identity(folder.parentId || folder.parent_drive_id),
      rootDriveId: identity(folder.rootDriveId || folder.root_drive_id),
      name: clean(folder.name || folder.label),
      theme: clean(folder.theme),
      productKey: resolveCatalogProductKey(folder.product || folder.productKey),
      kind: clean(folder.kind || folder.type || 'folder').toLowerCase()
    }))
    .filter(item => item.id);

  const artworks = (payload.items || payload.artworks || [])
    .filter(Boolean)
    .map(item => ({
      id: identity(item.driveFileId || item.id || item.drive_id),
      code: cleanCode(item.code),
      theme: clean(item.theme),
      subtheme: clean(item.subtheme),
      productKey: resolveCatalogProductKey(item.productKey || item.product),
      sizeKey: clean(item.sizeKey || item.size || item.dimension),
      imageConfigured: Boolean(clean(item.image || item.thumbnail || item.thumbnail_url))
    }))
    .filter(item => item.id);

  return {
    catalogVersion: positiveInteger(payload.catalogVersion || payload.version || payload.meta?.catalogVersion),
    folders: dedupeById(folders),
    artworks: dedupeById(artworks)
  };
}

function normalizeV2(payload) {
  const folders = (payload.folders || [])
    .filter(Boolean)
    .map(folder => ({
      id: identity(folder.id),
      parentId: identity(folder.parentId),
      rootDriveId: identity(folder.rootDriveId),
      name: clean(folder.name),
      theme: clean(folder.theme),
      productKey: resolveCatalogProductKey(folder.productKey),
      kind: clean(folder.kind || 'folder').toLowerCase()
    }))
    .filter(item => item.id);

  const artworks = (payload.artworks || payload.items || [])
    .filter(Boolean)
    .map(item => ({
      id: identity(item.driveFileId || item.id),
      code: cleanCode(item.code),
      theme: clean(item.theme),
      subtheme: clean(item.subtheme),
      productKey: resolveCatalogProductKey(item.productKey),
      sizeKey: clean(item.sizeKey),
      imageConfigured: Boolean(clean(item.image))
    }))
    .filter(item => item.id);

  return {
    catalogVersion: positiveInteger(payload.catalogVersion),
    folders: dedupeById(folders),
    artworks: dedupeById(artworks)
  };
}

function compareCollection(legacyItems, v2Items, compareItem, maxDetails) {
  const legacyMap = new Map(legacyItems.map(item => [item.id, item]));
  const v2Map = new Map(v2Items.map(item => [item.id, item]));
  const missing = [];
  const extra = [];
  const changed = [];

  for (const [id, legacyItem] of legacyMap.entries()) {
    const v2Item = v2Map.get(id);
    if (!v2Item) {
      missing.push({ id });
      continue;
    }

    const fields = compareItem(legacyItem, v2Item);
    if (fields.length) changed.push({ id, fields });
  }

  for (const id of v2Map.keys()) {
    if (!legacyMap.has(id)) extra.push({ id });
  }

  return deepFreeze({
    missing: missing.slice(0, maxDetails),
    extra: extra.slice(0, maxDetails),
    changed: changed.slice(0, maxDetails),
    truncated: missing.length > maxDetails || extra.length > maxDetails || changed.length > maxDetails,
    totals: {
      missing: missing.length,
      extra: extra.length,
      changed: changed.length
    }
  });
}

function compareFolder(legacy, v2) {
  return changedFields(legacy, v2, [
    'parentId',
    'rootDriveId',
    'name',
    'theme',
    'productKey',
    'kind'
  ]);
}

function compareArtwork(legacy, v2) {
  return changedFields(legacy, v2, [
    'code',
    'theme',
    'subtheme',
    'productKey',
    'sizeKey',
    'imageConfigured'
  ]);
}

function changedFields(left, right, fields) {
  return fields.filter(field => normalizeComparable(left[field]) !== normalizeComparable(right[field]));
}

function normalizeComparable(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function dedupeById(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

function cleanCode(value) {
  return String(value ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim();
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

function clamp(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
