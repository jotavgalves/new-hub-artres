import { createHash } from 'node:crypto';
import { GOOGLE_DRIVE_MIME } from './service-account-google-drive.mjs';

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff'
]);
const ALLOWED_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff']);
const UNSUPPORTED_DESIGN_EXT = new Set(['psd', 'psb', 'ai', 'eps', 'cdr']);
const PDF_MIME = 'application/pdf';

export const DEFAULT_CATALOG_ROOTS = Object.freeze([
  Object.freeze({
    rootDriveId: '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
    productKey: '50x50',
    productName: 'Bolinhas 50x50',
    sizeKey: '50X50',
    scope: 'bolinhas-drive-root',
    productCardPrefix: 'catalog-bolinhas-product:'
  }),
  Object.freeze({
    rootDriveId: '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-',
    productKey: 'painel-150',
    productName: 'Painel 150 cm',
    sizeKey: '150X150',
    scope: 'panel150-drive-root',
    productCardPrefix: 'catalog-panel150-product:'
  })
]);

export async function scanPrivateDriveCatalog(options = {}) {
  const drive = options.drive;
  if (!drive || typeof drive.getFile !== 'function' || typeof drive.listChildren !== 'function') {
    throw catalogError('GOOGLE_DRIVE_CLIENT_REQUIRED');
  }
  const roots = normalizeRoots(options.roots || DEFAULT_CATALOG_ROOTS);
  const limits = {
    folders: boundedInteger(options.maxFolders, 10, 50000, 10000),
    files: boundedInteger(options.maxFiles, 10, 500000, 250000),
    depth: boundedInteger(options.maxDepth, 1, 100, 30)
  };
  const state = {
    roots: [],
    folders: new Map(),
    artworks: new Map(),
    issues: [],
    scannedFolderSources: new Set(),
    sourceFilesSeen: 0,
    shortcutsResolved: 0
  };

  for (const root of roots) {
    const rootFile = await drive.getFile(root.rootDriveId);
    if (rootFile.trashed || rootFile.mimeType !== GOOGLE_DRIVE_MIME.FOLDER) {
      throw catalogError(`CATALOG_ROOT_NOT_FOLDER_${root.productKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`);
    }
    const rootState = {
      ...root,
      rootName: rootFile.name,
      directFolderIds: [],
      directArtworkIds: [],
      issueStart: state.issues.length
    };
    state.roots.push(rootState);
    await traverseFolder({
      drive,
      state,
      limits,
      root: rootState,
      catalogFolderId: root.rootDriveId,
      sourceFolderId: root.rootDriveId,
      parentCatalogId: '',
      depth: 0,
      pathParts: [],
      themeId: '',
      themeName: '',
      shortcutTrail: []
    });
  }

  computeDescendantCounts(state);
  const built = buildAcceptedCatalog(state);
  const report = buildScanReport(state, built);
  if (!built.items.length) throw catalogError('AUTHENTICATED_CATALOG_ARTWORKS_EMPTY');
  if (!built.folders.length) throw catalogError('AUTHENTICATED_CATALOG_THEMES_EMPTY');
  return Object.freeze({ ...built, report });
}

async function traverseFolder(context) {
  const {
    drive, state, limits, root, catalogFolderId, sourceFolderId,
    depth, pathParts, themeId, themeName
  } = context;
  if (depth > limits.depth) {
    issue(state, root, 'MAX_DEPTH_REACHED', { folderId: catalogFolderId, path: pathParts.join(' / ') });
    return;
  }
  const visitKey = `${root.rootDriveId}:${catalogFolderId}:${sourceFolderId}`;
  if (state.scannedFolderSources.has(visitKey)) {
    issue(state, root, 'FOLDER_CYCLE_SKIPPED', { folderId: catalogFolderId, path: pathParts.join(' / ') });
    return;
  }
  state.scannedFolderSources.add(visitKey);
  if (state.scannedFolderSources.size > limits.folders) throw catalogError('AUTHENTICATED_CATALOG_FOLDER_LIMIT_REACHED');

  const children = await drive.listChildren(sourceFolderId);
  for (const child of children) {
    state.sourceFilesSeen += 1;
    if (state.sourceFilesSeen > limits.files) throw catalogError('AUTHENTICATED_CATALOG_FILE_LIMIT_REACHED');
    if (internalCatalogName(child.name)) {
      issue(state, root, 'INTERNAL_TEST_ENTRY_SKIPPED', { name: child.name, parentId: catalogFolderId });
      continue;
    }

    if (child.mimeType === GOOGLE_DRIVE_MIME.FOLDER) {
      const childThemeId = depth === 0 ? child.id : themeId;
      const childThemeName = depth === 0 ? child.name : themeName;
      addFolder(state, root, {
        id: child.id,
        sourceFolderId: child.id,
        parentId: catalogFolderId,
        name: child.name,
        depth: depth + 1,
        pathParts: [...pathParts, child.name],
        themeId: childThemeId,
        themeName: childThemeName,
        isShortcut: false,
        shortcutTargetId: ''
      });
      await traverseFolder({
        ...context,
        catalogFolderId: child.id,
        sourceFolderId: child.id,
        parentCatalogId: catalogFolderId,
        depth: depth + 1,
        pathParts: [...pathParts, child.name],
        themeId: childThemeId,
        themeName: childThemeName
      });
      continue;
    }

    if (child.mimeType === GOOGLE_DRIVE_MIME.SHORTCUT) {
      await handleShortcut({ ...context, child });
      continue;
    }

    if (depth === 0) {
      issue(state, root, 'ARTWORK_OUTSIDE_THEME_SKIPPED', { name: child.name, fileId: child.id });
      continue;
    }
    addArtworkFromFile(state, root, {
      catalogId: child.id,
      sourceFile: child,
      originalEntry: child,
      parentFolderId: catalogFolderId,
      pathParts,
      themeId,
      themeName,
      isShortcut: false
    });
  }
}

async function handleShortcut(context) {
  const { drive, state, root, child, depth, catalogFolderId, pathParts, themeId, themeName } = context;
  const targetId = String(child.shortcut?.targetId || '').trim();
  if (!targetId) {
    issue(state, root, 'SHORTCUT_TARGET_MISSING', { name: child.name, shortcutId: child.id });
    return;
  }
  if (context.shortcutTrail.includes(targetId)) {
    issue(state, root, 'SHORTCUT_CYCLE_SKIPPED', { name: child.name, shortcutId: child.id });
    return;
  }
  let target;
  try {
    target = await drive.getFile(targetId);
  } catch (error) {
    issue(state, root, 'SHORTCUT_TARGET_UNREADABLE', {
      name: child.name,
      shortcutId: child.id,
      error: publicCode(error?.code || error?.message, 'GOOGLE_DRIVE_ERROR')
    });
    return;
  }
  state.shortcutsResolved += 1;
  if (target.trashed) {
    issue(state, root, 'SHORTCUT_TARGET_TRASHED', { name: child.name, shortcutId: child.id });
    return;
  }

  if (target.mimeType === GOOGLE_DRIVE_MIME.FOLDER) {
    const childThemeId = depth === 0 ? child.id : themeId;
    const childThemeName = depth === 0 ? child.name : themeName;
    addFolder(state, root, {
      id: child.id,
      sourceFolderId: target.id,
      parentId: catalogFolderId,
      name: child.name,
      depth: depth + 1,
      pathParts: [...pathParts, child.name],
      themeId: childThemeId,
      themeName: childThemeName,
      isShortcut: true,
      shortcutTargetId: target.id
    });
    await traverseFolder({
      ...context,
      catalogFolderId: child.id,
      sourceFolderId: target.id,
      parentCatalogId: catalogFolderId,
      depth: depth + 1,
      pathParts: [...pathParts, child.name],
      themeId: childThemeId,
      themeName: childThemeName,
      shortcutTrail: [...context.shortcutTrail, target.id]
    });
    return;
  }

  if (depth === 0) {
    issue(state, root, 'ARTWORK_OUTSIDE_THEME_SKIPPED', { name: child.name, fileId: child.id });
    return;
  }
  addArtworkFromFile(state, root, {
    catalogId: child.id,
    sourceFile: target,
    originalEntry: child,
    parentFolderId: catalogFolderId,
    pathParts,
    themeId,
    themeName,
    isShortcut: true
  });
}

function addFolder(state, root, input) {
  if (state.folders.has(input.id)) {
    issue(state, root, 'DUPLICATE_FOLDER_ID_SKIPPED', { folderId: input.id, name: input.name });
    return;
  }
  state.folders.set(input.id, {
    ...input,
    rootDriveId: root.rootDriveId,
    productKey: root.productKey,
    productName: root.productName,
    sizeKey: root.sizeKey,
    scope: root.scope,
    productCardPrefix: root.productCardPrefix,
    directArtworkIds: [],
    childFolderIds: [],
    descendantArtworkCount: 0
  });
  if (input.parentId === root.rootDriveId) root.directFolderIds.push(input.id);
  else {
    const parent = state.folders.get(input.parentId);
    if (parent) parent.childFolderIds.push(input.id);
  }
}

function addArtworkFromFile(state, root, input) {
  const classification = classifyArtwork(input.sourceFile, input.originalEntry);
  if (!classification.accepted) {
    issue(state, root, classification.reason, {
      name: input.originalEntry.name,
      fileId: input.catalogId,
      mimeType: input.sourceFile.mimeType,
      extension: classification.extension
    });
    return;
  }
  const codeResult = extractArtworkCode(input.originalEntry.name || input.sourceFile.name, input.catalogId);
  if (codeResult.warning) {
    issue(state, root, codeResult.warning, { name: input.originalEntry.name, fileId: input.catalogId, code: codeResult.code });
  }
  const folder = state.folders.get(input.parentFolderId);
  if (!folder) {
    issue(state, root, 'ARTWORK_PARENT_NOT_INDEXED', { name: input.originalEntry.name, fileId: input.catalogId });
    return;
  }
  if (state.artworks.has(input.catalogId)) {
    issue(state, root, 'DUPLICATE_ARTWORK_ID_SKIPPED', { name: input.originalEntry.name, fileId: input.catalogId });
    return;
  }
  const sourceId = input.sourceFile.id;
  const path = [...input.pathParts, input.originalEntry.name].join(' / ');
  const artwork = {
    id: input.catalogId,
    sourceDriveFileId: sourceId,
    shortcutTargetId: input.isShortcut ? sourceId : '',
    isShortcut: input.isShortcut,
    parentFolderId: input.parentFolderId,
    originalName: input.originalEntry.name,
    sourceName: input.sourceFile.name,
    mimeType: input.sourceFile.mimeType,
    extension: classification.extension,
    code: codeResult.code,
    sortId: codeResult.sortId,
    theme: input.themeName,
    themeId: input.themeId,
    subtheme: input.pathParts.slice(1).join(' / '),
    path,
    rootDriveId: root.rootDriveId,
    productKey: root.productKey,
    productName: root.productName,
    sizeKey: root.sizeKey,
    modifiedTime: input.sourceFile.modifiedTime,
    sizeBytes: input.sourceFile.size,
    checksum: input.sourceFile.md5Checksum,
    webViewLink: input.sourceFile.webViewLink,
    pdfPreview: classification.pdfPreview
  };
  state.artworks.set(artwork.id, artwork);
  folder.directArtworkIds.push(artwork.id);
}

export function classifyArtwork(sourceFile, originalEntry = sourceFile) {
  const mimeType = String(sourceFile?.mimeType || '').toLowerCase();
  const extension = fileExtension(originalEntry?.name || sourceFile?.name);
  if (ALLOWED_IMAGE_MIME.has(mimeType) || ALLOWED_IMAGE_EXT.has(extension)) {
    return Object.freeze({ accepted: true, extension, pdfPreview: false, reason: '' });
  }
  if (mimeType === PDF_MIME) {
    if (sourceFile?.thumbnailLink) return Object.freeze({ accepted: true, extension: extension || 'pdf', pdfPreview: true, reason: '' });
    return Object.freeze({ accepted: false, extension: extension || 'pdf', pdfPreview: false, reason: 'PDF_WITHOUT_THUMBNAIL' });
  }
  if (UNSUPPORTED_DESIGN_EXT.has(extension) || /photoshop|illustrator|postscript|coreldraw/.test(mimeType)) {
    return Object.freeze({ accepted: false, extension, pdfPreview: false, reason: 'DESIGN_SOURCE_NOT_PUBLICABLE' });
  }
  return Object.freeze({ accepted: false, extension, pdfPreview: false, reason: 'UNSUPPORTED_FILE_FORMAT' });
}

export function extractArtworkCode(name, fallbackIdentity = '') {
  const base = String(name || '').replace(/\.[^.]+$/, '').trim();
  const leading = base.match(/^\s*#?(\d{1,18})(?:[_\-\s]|$)/);
  const anyDigits = base.match(/\d{1,18}/);
  const digits = String((leading && leading[1]) || (anyDigits && anyDigits[0]) || '').replace(/^0+(?=\d)/, '');
  if (digits) {
    const parsed = Number.parseInt(digits, 10);
    return Object.freeze({
      code: digits,
      sortId: Number.isSafeInteger(parsed) ? parsed : 0,
      warning: leading ? '' : 'NONSTANDARD_ARTWORK_CODE'
    });
  }
  const textual = normalizeCode(base) || String(fallbackIdentity || '').slice(0, 40);
  return Object.freeze({ code: textual, sortId: 0, warning: 'NON_NUMERIC_ARTWORK_CODE' });
}

function computeDescendantCounts(state) {
  for (const folder of state.folders.values()) {
    folder.descendantArtworkCount = folder.directArtworkIds.length;
  }
  const ordered = [...state.folders.values()].sort((a, b) => b.depth - a.depth);
  for (const folder of ordered) {
    if (folder.parentId && state.folders.has(folder.parentId)) {
      state.folders.get(folder.parentId).descendantArtworkCount += folder.descendantArtworkCount;
    }
  }
  for (const root of state.roots) {
    for (const folderId of root.directFolderIds) {
      const folder = state.folders.get(folderId);
      if (folder && folder.descendantArtworkCount === 0) {
        issue(state, root, 'EMPTY_THEME_NOT_PUBLISHED', { name: folder.name, folderId: folder.id });
      }
    }
  }
}

function buildAcceptedCatalog(state) {
  const publicFolders = [...state.folders.values()]
    .filter(folder => folder.descendantArtworkCount > 0)
    .sort(compareFolder);
  const publicFolderIds = new Set(publicFolders.map(folder => folder.id));
  const publicArtworks = [...state.artworks.values()]
    .filter(artwork => publicFolderIds.has(artwork.parentFolderId))
    .sort(compareArtwork);

  const folders = publicFolders.map(folder => folderRow(folder));
  const items = publicArtworks.map(artwork => itemRow(artwork));
  const routes = [];
  for (const root of state.roots) {
    const themes = publicFolders.filter(folder => folder.parentId === root.rootDriveId);
    routes.push(routeRow({
      routeKey: `themes:${root.productKey}`,
      mode: 'themes',
      folderId: '',
      productKey: root.productKey,
      payload: {
        ok: true,
        mode: 'themes',
        source: 'authenticated-private-drive',
        scope: root.scope,
        rootDriveId: root.rootDriveId,
        total: themes.length,
        folders: themes.map(folderPayload)
      }
    }));
    for (const folder of publicFolders.filter(value => value.rootDriveId === root.rootDriveId)) {
      const childFolders = folder.childFolderIds
        .filter(id => publicFolderIds.has(id))
        .map(id => state.folders.get(id))
        .sort(compareFolder)
        .map(folderPayload);
      if (folder.directArtworkIds.some(id => state.artworks.has(id))) {
        childFolders.push(productCardPayload(folder));
      }
      routes.push(routeRow({
        routeKey: `products:${folder.id}:${root.productKey}`,
        mode: 'products',
        folderId: folder.id,
        productKey: root.productKey,
        payload: {
          ok: true,
          mode: 'products',
          source: 'authenticated-private-drive',
          scope: root.scope,
          rootDriveId: root.rootDriveId,
          theme: folder.themeName,
          folders: childFolders
        }
      }));
      const directItems = folder.directArtworkIds
        .map(id => state.artworks.get(id))
        .filter(Boolean)
        .sort(compareArtwork)
        .map(itemPayload);
      if (directItems.length) {
        routes.push(routeRow({
          routeKey: `items:${folder.id}:${root.productKey}`,
          mode: 'items',
          folderId: folder.id,
          productKey: root.productKey,
          payload: {
            ok: true,
            mode: 'items',
            source: 'authenticated-private-drive',
            scope: root.scope,
            rootDriveId: root.rootDriveId,
            theme: folder.themeName,
            product: root.productKey,
            productName: root.productName,
            total: directItems.length,
            items: directItems
          }
        }));
      }
    }
  }
  const fingerprint = fingerprintCatalog({ routes, folders, items });
  return Object.freeze({ routes, folders, items, fingerprint, traversalComplete: true });
}

function folderRow(folder) {
  const payload = folderPayload(folder);
  return Object.freeze({
    driveId: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    path: folder.pathParts.join(' / '),
    theme: folder.themeName,
    depth: folder.depth,
    searchText: normalizeSearchText([folder.name, folder.pathParts.join(' '), folder.themeName].join(' ')),
    payload
  });
}

function itemRow(artwork) {
  const payload = itemPayload(artwork);
  return Object.freeze({
    driveFileId: artwork.id,
    parentFolderId: artwork.parentFolderId,
    code: artwork.code,
    sortId: artwork.sortId,
    theme: artwork.theme,
    subtheme: artwork.subtheme,
    productKey: artwork.productKey,
    originalName: artwork.originalName,
    searchText: normalizeSearchText([
      artwork.code, artwork.originalName, artwork.sourceName, artwork.theme,
      artwork.subtheme, artwork.path, artwork.productName, artwork.sizeKey
    ].join(' ')),
    payload
  });
}

function folderPayload(folder) {
  return Object.freeze({
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    rawName: folder.name,
    label: folder.name,
    kind: 'folder',
    type: 'folder',
    path: folder.pathParts.join(' / '),
    theme: folder.themeName,
    themeId: folder.themeId,
    product: folder.productKey,
    productKey: folder.productKey,
    productName: folder.productName,
    catalogRootDriveId: folder.rootDriveId,
    rootVerified: true,
    artworkCount: folder.descendantArtworkCount,
    liveDrive: false,
    authenticatedIndex: true,
    isShortcut: folder.isShortcut,
    shortcutTargetId: folder.shortcutTargetId || undefined
  });
}

function productCardPayload(folder) {
  return Object.freeze({
    id: `${folder.productCardPrefix}${folder.id}`,
    name: folder.productName,
    rawName: folder.productName,
    label: folder.productName,
    kind: 'product',
    type: 'product',
    product: folder.productKey,
    productKey: folder.productKey,
    productName: folder.productName,
    theme: folder.themeName,
    productFolderId: folder.id,
    directItems: true,
    catalogRootDriveId: folder.rootDriveId,
    rootVerified: true,
    disableCustomization: true,
    customizationDisabled: true,
    allowCustomSize: false,
    canCustomize: false
  });
}

function itemPayload(artwork) {
  const imageVersion = artwork.checksum || artwork.modifiedTime || '1';
  const image = `/api/catalog-image?id=${encodeURIComponent(artwork.id)}&v=${encodeURIComponent(imageVersion)}`;
  return Object.freeze({
    id: artwork.id,
    driveFileId: artwork.id,
    sourceDriveFileId: artwork.sourceDriveFileId,
    shortcutTargetId: artwork.shortcutTargetId || undefined,
    isShortcut: artwork.isShortcut,
    code: artwork.code,
    sortId: artwork.sortId,
    theme: artwork.theme,
    themeId: artwork.themeId,
    subtheme: artwork.subtheme,
    product: artwork.productKey,
    productKey: artwork.productKey,
    productName: artwork.productName,
    productLabel: artwork.productName,
    productFolderId: artwork.parentFolderId,
    catalogRootDriveId: artwork.rootDriveId,
    rootVerified: true,
    originalName: artwork.originalName,
    sourceName: artwork.sourceName,
    mimeType: artwork.mimeType,
    extension: artwork.extension,
    driveUrl: artwork.webViewLink,
    image,
    thumbnail: image,
    size: artwork.sizeKey,
    sizeKey: artwork.sizeKey,
    details: { size: artwork.sizeKey },
    modifiedTime: artwork.modifiedTime,
    sizeBytes: artwork.sizeBytes,
    checksum: artwork.checksum,
    pdfPreview: artwork.pdfPreview,
    authenticatedIndex: true
  });
}

function routeRow(input) {
  const text = JSON.stringify(input.payload);
  return Object.freeze({
    routeKey: input.routeKey,
    mode: input.mode,
    folderId: input.folderId,
    productKey: input.productKey,
    payload: input.payload,
    payloadBytes: new TextEncoder().encode(text).byteLength
  });
}

function buildScanReport(state, built) {
  const issueSummary = new Map();
  for (const entry of state.issues) issueSummary.set(entry.code, (issueSummary.get(entry.code) || 0) + 1);
  const roots = state.roots.map(root => {
    const rootFolders = [...state.folders.values()].filter(folder => folder.rootDriveId === root.rootDriveId);
    const rootItems = [...state.artworks.values()].filter(item => item.rootDriveId === root.rootDriveId);
    const themes = root.directFolderIds.map(id => state.folders.get(id)).filter(Boolean).map(theme => ({
      id: theme.id,
      name: theme.name,
      foldersFound: rootFolders.filter(folder => folder.themeId === theme.id).length,
      filesFound: rootItems.filter(item => item.themeId === theme.id).length,
      artworksPublished: theme.descendantArtworkCount,
      published: theme.descendantArtworkCount > 0
    }));
    return {
      rootDriveId: root.rootDriveId,
      rootName: root.rootName,
      productKey: root.productKey,
      productName: root.productName,
      themesFound: themes.length,
      themesPublished: themes.filter(theme => theme.published).length,
      foldersPublished: built.folders.filter(folder => folder.payload.catalogRootDriveId === root.rootDriveId).length,
      artworksPublished: built.items.filter(item => item.payload.catalogRootDriveId === root.rootDriveId).length,
      themes
    };
  });
  return Object.freeze({
    ok: true,
    generatedAt: new Date().toISOString(),
    source: 'google-drive-service-account',
    traversalComplete: true,
    requests: Number(state.scannedFolderSources.size),
    foldersScanned: state.folders.size,
    sourceEntriesSeen: state.sourceFilesSeen,
    shortcutsResolved: state.shortcutsResolved,
    foldersPublished: built.folders.length,
    artworksPublished: built.items.length,
    routeCount: built.routes.length,
    fingerprint: built.fingerprint,
    issueCount: state.issues.length,
    issueSummary: [...issueSummary.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ code, count })),
    roots,
    issues: state.issues.slice(0, 2000)
  });
}

function issue(state, root, code, details = {}) {
  state.issues.push(Object.freeze({
    code: publicCode(code, 'CATALOG_SCAN_ISSUE'),
    productKey: root.productKey,
    rootDriveId: root.rootDriveId,
    ...sanitizeDetails(details)
  }));
}

function sanitizeDetails(value) {
  const out = {};
  for (const [key, raw] of Object.entries(value || {})) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(key)) continue;
    if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = raw;
    else out[key] = String(raw || '').slice(0, 1000);
  }
  return out;
}

export function fingerprintCatalog(input) {
  const hash = createHash('sha256');
  hash.update('authenticated-catalog-v2\n');
  for (const [kind, rows] of [['routes', input.routes], ['folders', input.folders], ['items', input.items]]) {
    hash.update(`${kind}\n`);
    const normalized = [...(rows || [])].sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
    for (const row of normalized) {
      hash.update(stableStringify(row));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRoots(roots) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(roots) ? roots : []) {
    const rootDriveId = identity(raw?.rootDriveId);
    const productKey = safeToken(raw?.productKey, 160);
    if (!rootDriveId || !productKey || seen.has(rootDriveId) || seen.has(`product:${productKey}`)) {
      throw catalogError('CATALOG_ROOT_CONFIGURATION_INVALID');
    }
    seen.add(rootDriveId);
    seen.add(`product:${productKey}`);
    out.push(Object.freeze({
      rootDriveId,
      productKey,
      productName: safeText(raw?.productName, 200) || productKey,
      sizeKey: safeToken(raw?.sizeKey, 100) || 'DEFAULT',
      scope: safeToken(raw?.scope, 120) || productKey,
      productCardPrefix: safeText(raw?.productCardPrefix, 200) || `catalog-product:${productKey}:`
    }));
  }
  if (!out.length) throw catalogError('CATALOG_ROOTS_REQUIRED');
  return out;
}

function fileExtension(name) {
  const match = String(name || '').trim().toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  return match ? match[1] : '';
}

function normalizeCode(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 80);
}

function internalCatalogName(value) {
  return /^codex\s+test(?:e)?(?:\s|$)/.test(normalizeSearchText(value));
}

function identity(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_-]{5,500}$/.test(text) ? text : '';
}

function safeToken(value, max) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._-]{1,500}$/.test(text) ? text.slice(0, max) : '';
}

function safeText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function compareFolder(a, b) {
  return a.rootDriveId.localeCompare(b.rootDriveId) ||
    a.pathParts.join('/').localeCompare(b.pathParts.join('/'), 'pt-BR', { numeric: true });
}

function compareArtwork(a, b) {
  return b.sortId - a.sortId || a.originalName.localeCompare(b.originalName, 'pt-BR', { numeric: true });
}

function stableKey(row) {
  return String(row?.routeKey || row?.driveId || row?.driveFileId || '');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function publicCode(value, fallback) {
  const text = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function catalogError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
