import { tryAcceptedCatalogRequest } from './_accepted_catalog.js';
import { loadConfig } from './_config.js';
import {
  baseIndexParams,
  cleanLike,
  dedupeRows,
  mapArtwork,
  readIndex,
  scoreRow,
  norm
} from './_catalog_index.js';
import {
  applyFolderRule,
  cleanLabel,
  displayTheme,
  isBlockedArt,
  isHiddenTheme,
  sortFolders
} from './_catalog_rules.js';

const ROOTS = Object.freeze({
  '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
});
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PAGE_SIZE = 500;
const MAX_ROWS = 5000;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const mode = String(url.searchParams.get('mode') || 'themes');
    const productKey = canonicalProduct(url.searchParams.get('product'));
    if (!productKey) return json({ ok: false, error: 'PRODUTO_INVALIDO' }, 400);

    const rootId = ROOTS[productKey];
    const { config } = await loadConfig(context.env);
    const commercial = productConfig(config, productKey);
    const folderId = catalogFolderId(url.searchParams.get('folderId'), rootId);
    const theme = cleanLabel(url.searchParams.get('theme') || '');
    const query = String(
      url.searchParams.get('q') ||
      url.searchParams.get('code') ||
      url.searchParams.get('imageId') || ''
    ).trim();

    const accepted = await tryAcceptedCatalogRequest(context.env, {
      mode,
      productKey,
      folderId,
      query,
      limit: 80
    });
    if (accepted) return json(accepted, 200, 15);

    if (mode === 'themes') {
      const folders = await themeFolders(context.env, config, productKey, rootId);
      return json({ ok: true, mode, product: productKey, rootVerified: true, folders }, 200, 15);
    }

    if (mode === 'products') {
      const folders = await productFolders(context.env, {
        folderId,
        theme,
        config,
        productKey,
        rootId,
        commercial
      });
      return json({ ok: true, mode, product: productKey, rootVerified: true, theme, folders }, 200, 15);
    }

    if (mode === 'items') {
      const items = await itemRows(context.env, {
        folderId,
        theme,
        config,
        productKey,
        rootId,
        commercial
      });
      return json({
        ok: true,
        mode,
        product: productKey,
        productName: commercial.label,
        rootVerified: true,
        total: items.length,
        items
      }, 200, 15);
    }

    if (mode === 'search') {
      if (!query) return json({ ok: true, mode, product: productKey, rootVerified: true, items: [] }, 200, 15);
      const items = await searchItems(context.env, query, {
        config,
        productKey,
        rootId,
        commercial,
        limit: 80
      });
      return json({ ok: true, mode, product: productKey, rootVerified: true, total: items.length, items }, 200, 15);
    }

    if (mode === 'folderSearch' || mode === 'globalSearch') {
      const q = cleanLabel(query);
      if (!q || norm(q).length < 2) {
        const empty = mode === 'globalSearch' ? { folders: [], items: [] } : { results: [] };
        return json({ ok: true, mode, product: productKey, rootVerified: true, ...empty }, 200, 15);
      }
      const [folders, items] = await Promise.all([
        searchFolders(context.env, q, config, productKey, rootId),
        searchItems(context.env, q, { config, productKey, rootId, commercial, limit: 80 })
      ]);
      if (mode === 'globalSearch') {
        return json({ ok: true, mode, product: productKey, rootVerified: true, folders, items }, 200, 15);
      }
      return json({ ok: true, mode, product: productKey, rootVerified: true, results: folders }, 200, 15);
    }

    return json({ ok: false, error: 'MODO_INVALIDO' }, 400);
  } catch (error) {
    return json({
      ok: false,
      error: 'FALHA_AO_LER_CATALOGO_V2',
      detail: safeError(error)
    }, 500);
  }
}

async function themeFolders(env, config, productKey, rootId) {
  const indexed = await indexedThemeFolders(env, config, productKey, rootId);
  if (productKey !== 'painel-150') return indexed;

  const live = await liveThemeFolders(env, config, productKey, rootId);
  if (!Array.isArray(live) || live.length === 0) return indexed;
  sortFolders(live);
  return live;
}

async function indexedThemeFolders(env, config, productKey, rootId) {
  const rows = await allRows(env, params => {
    params.set('type', 'eq.folder');
    params.set('root_drive_id', 'eq.' + rootId);
    params.set('parent_drive_id', 'eq.' + rootId);
  });
  const folders = dedupeRows(rows)
    .map(row => folderFromRow(row, config, 'theme', productKey, rootId))
    .map(folder => applyFolderRule(folder, config, 'theme'))
    .filter(folder => publicFolder(folder, config));
  sortFolders(folders);
  return folders;
}

async function productFolders(env, input) {
  const indexed = await indexedProductFolders(env, input);
  if (input.productKey !== 'painel-150') return indexed;

  const live = await liveFolderChildren(env, input.folderId, input.rootId);
  if (!live || (!live.folders.length && !live.images.length)) return indexed;

  const cards = live.folders
    .map(file => folderFromDrive(file, input.config, 'folder', input.productKey, input.rootId, input.folderId))
    .map(folder => applyFolderRule(folder, input.config, 'subtheme'))
    .filter(folder => publicFolder(folder, input.config));
  sortFolders(cards);
  if (live.images.length) {
    cards.push(productCard(
      input.folderId,
      input.theme,
      input.productKey,
      input.rootId,
      input.commercial
    ));
  }
  return cards;
}

async function indexedProductFolders(env, input) {
  const childRows = await allRows(env, params => {
    params.set('type', 'eq.folder');
    params.set('root_drive_id', 'eq.' + input.rootId);
    params.set('parent_drive_id', 'eq.' + input.folderId);
  });
  const cards = dedupeRows(childRows)
    .map(row => folderFromRow(row, input.config, 'folder', input.productKey, input.rootId))
    .map(folder => applyFolderRule(folder, input.config, 'subtheme'))
    .filter(folder => publicFolder(folder, input.config));
  sortFolders(cards);

  const artRows = await artworkRowsByParent(env, input.folderId, input.rootId);
  if (artRows.length) {
    cards.push(productCard(
      input.folderId,
      input.theme,
      input.productKey,
      input.rootId,
      input.commercial
    ));
  }
  return cards;
}

async function itemRows(env, input) {
  const parsed = parseVirtualProductId(input.folderId);
  const parentId = parsed ? parsed.parentId : input.folderId;
  const indexedRows = await artworkRowsByParent(env, parentId, input.rootId);
  const indexedItems = indexedRows
    .map(row => itemFromRow(row, input))
    .filter(Boolean);

  if (input.productKey !== 'painel-150') {
    return indexedItems.sort(sortItems);
  }

  const live = await liveFolderChildren(env, parentId, input.rootId);
  if (!live || live.images.length === 0) return indexedItems.sort(sortItems);

  const indexedById = new Map(indexedItems.map(item => [String(item.id || ''), item]));
  return live.images
    .map(file => {
      const indexed = indexedById.get(String(file.id || ''));
      return indexed || itemFromDriveFile(file, input, parentId);
    })
    .filter(Boolean)
    .sort(sortItems);
}

async function searchItems(env, query, input) {
  const q = cleanLabel(query);
  const normalized = cleanLike(q);
  const digits = q.replace(/\D/g, '');
  const out = [];

  if (digits.length >= 2) {
    out.push(...await limitedRows(env, params => {
      params.set('type', 'eq.artwork');
      params.set('root_drive_id', 'eq.' + input.rootId);
      params.set('code', 'eq.' + digits);
    }, input.limit));
  }

  if (normalized.length >= 2) {
    out.push(...await limitedRows(env, params => {
      params.set('type', 'eq.artwork');
      params.set('root_drive_id', 'eq.' + input.rootId);
      params.set('search_text', 'ilike.*' + normalized + '*');
    }, input.limit));
  }

  return dedupeRows(out)
    .filter(row => String(row.root_drive_id || '') === input.rootId)
    .map(row => itemFromRow(row, input))
    .filter(Boolean)
    .sort((a, b) => scoreRow(b.__row || b, q) - scoreRow(a.__row || a, q) || sortItems(a, b))
    .slice(0, input.limit)
    .map(item => { delete item.__row; return item; });
}

async function searchFolders(env, query, config, productKey, rootId) {
  const normalized = cleanLike(query);
  const rows = await limitedRows(env, params => {
    params.set('type', 'eq.folder');
    params.set('root_drive_id', 'eq.' + rootId);
    params.set('search_text', 'ilike.*' + normalized + '*');
  }, 120);
  const indexed = dedupeRows(rows)
    .filter(row => String(row.root_drive_id || '') === rootId)
    .map(row => folderResultFromRow(row, config, productKey, rootId))
    .filter(folder => publicFolder(folder, config));

  if (productKey !== 'painel-150') return sortSearchFolders(indexed);

  const liveThemes = await liveThemeFolders(env, config, productKey, rootId);
  if (!Array.isArray(liveThemes) || liveThemes.length === 0) return sortSearchFolders(indexed);
  const needle = norm(query);
  return sortSearchFolders(liveThemes.filter(folder => norm(folder.name).includes(needle)));
}

async function artworkRowsByParent(env, parentId, rootId) {
  return dedupeRows(await allRows(env, params => {
    params.set('type', 'eq.artwork');
    params.set('root_drive_id', 'eq.' + rootId);
    params.set('parent_drive_id', 'eq.' + parentId);
  })).filter(row => String(row.root_drive_id || '') === rootId);
}

async function liveThemeFolders(env, config, productKey, rootId) {
  const files = await listDriveChildren(env, rootId);
  if (files === null) return null;
  return files
    .filter(file => file.mimeType === FOLDER_MIME)
    .filter(file => !internalCatalogName(file.name))
    .map(file => folderFromDrive(file, config, 'theme', productKey, rootId, rootId))
    .map(folder => applyFolderRule(folder, config, 'theme'))
    .filter(folder => publicFolder(folder, config));
}

async function liveFolderChildren(env, folderId, rootId) {
  if (!(await folderWithinRoot(env, folderId, rootId))) return null;
  const files = await listDriveChildren(env, folderId);
  if (files === null) return null;
  return {
    folders: files.filter(file => file.mimeType === FOLDER_MIME && !internalCatalogName(file.name)),
    images: files.filter(file => String(file.mimeType || '').startsWith('image/'))
  };
}

async function folderWithinRoot(env, folderId, rootId) {
  if (!folderId || !rootId) return false;
  if (folderId === rootId) return true;
  let current = folderId;
  const seen = new Set();

  for (let depth = 0; depth < 10; depth += 1) {
    if (!current || seen.has(current)) return false;
    seen.add(current);
    const file = await getDriveFile(env, current);
    if (!file || file.trashed || file.mimeType !== FOLDER_MIME) return false;
    const parents = Array.isArray(file.parents) ? file.parents : [];
    if (parents.includes(rootId)) return true;
    current = parents[0] || '';
  }
  return false;
}

async function getDriveFile(env, fileId) {
  const key = driveApiKey(env);
  if (!key) return null;
  const params = new URLSearchParams({
    key,
    supportsAllDrives: 'true',
    fields: 'id,name,mimeType,parents,trashed'
  });
  const response = await fetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?${params}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) return null;
  return response.json();
}

async function listDriveChildren(env, folderId) {
  const key = driveApiKey(env);
  if (!key || !/^[A-Za-z0-9_-]{10,200}$/.test(String(folderId || ''))) return null;
  const files = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      key,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,parents,trashed)',
      pageSize: '1000',
      orderBy: 'folder,name_natural'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`${DRIVE_API}?${params}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    const data = await response.json();
    files.push(...(Array.isArray(data.files) ? data.files : []));
    pageToken = String(data.nextPageToken || '');
  } while (pageToken);

  return files;
}

function productCard(parentId, theme, productKey, rootId, commercial) {
  return {
    id: virtualProductId(parentId, productKey),
    name: commercial.label,
    rawName: commercial.label,
    label: commercial.label,
    kind: 'product',
    product: productKey,
    productKey,
    productName: commercial.label,
    theme,
    productFolderId: parentId,
    catalogRootDriveId: rootId,
    rootVerified: true,
    directItems: true,
    unitPrice: commercial.unitPrice,
    price: commercial.unitPrice,
    priceLabel: moneyBR(commercial.unitPrice) + ' cada',
    minQty: commercial.minimum,
    step: commercial.step,
    initialQuantity: commercial.initial,
    checkoutEnabled: commercial.enabled,
    disableCustomization: true,
    customizationDisabled: true,
    allowCustomSize: false,
    canCustomize: false
  };
}

function itemFromRow(row, input) {
  if (String(row.root_drive_id || '') !== input.rootId) return null;
  const item = mapArtwork(row);
  item.code = String(item.code || '').replace(/^#/, '');
  if (!item.code || isBlockedArt(item.code, input.config)) return null;
  item.theme = displayTheme(item.theme || input.theme || 'Sem tema', input.config);
  if (isHiddenTheme(item.theme, input.config) || internalCatalogName(item.theme)) return null;
  item.themeId = row.parent_drive_id || '';
  item.sortId = Number(item.code) || 0;
  item.product = input.productKey;
  item.productKey = input.productKey;
  item.productName = input.commercial.label;
  item.productLabel = input.commercial.label;
  item.productFolderId = row.parent_drive_id || '';
  item.catalogRootDriveId = input.rootId;
  item.rootVerified = true;
  item.size = input.productKey === 'painel-150' ? '150X150' : '50X50';
  item.sizeKey = item.size;
  item.details = { ...(item.details || {}), size: item.size };
  item.__row = row;
  return item;
}

function itemFromDriveFile(file, input, parentId) {
  const base = String(file.name || '').replace(/\.[^.]+$/, '').trim();
  const leading = base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);
  const digits = base.match(/\d+/);
  const code = String((leading && leading[1]) || (digits && digits[0]) || file.id || '').trim();
  if (!code || isBlockedArt(code, input.config)) return null;

  const theme = displayTheme(input.theme || 'Sem tema', input.config);
  if (isHiddenTheme(theme, input.config) || internalCatalogName(theme)) return null;
  const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1200`;
  const size = input.productKey === 'painel-150' ? '150X150' : '50X50';

  return {
    id: file.id,
    code,
    sortId: Number(code) || 0,
    theme,
    themeId: parentId,
    product: input.productKey,
    productKey: input.productKey,
    productName: input.commercial.label,
    productLabel: input.commercial.label,
    productFolderId: parentId,
    catalogRootDriveId: input.rootId,
    rootVerified: true,
    liveDrive: true,
    originalName: file.name || '',
    driveFileId: file.id,
    driveUrl: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
    image,
    thumbnail: image,
    unitPrice: input.commercial.unitPrice,
    price: input.commercial.unitPrice,
    size,
    sizeKey: size,
    details: { size }
  };
}

function folderFromRow(row, config, kind, productKey, rootId) {
  const raw = cleanLabel(row.name || row.theme || 'Pasta');
  const name = displayTheme(raw, config);
  return {
    id: row.drive_id || '',
    parentId: row.parent_drive_id || '',
    name,
    rawName: raw,
    label: name,
    kind,
    type: row.type || 'folder',
    path: displayPath(row.path || raw, config),
    theme: displayTheme(row.theme || raw, config),
    themeId: row.depth === 1 ? row.drive_id : row.parent_drive_id,
    product: productKey,
    productKey,
    catalogRootDriveId: rootId,
    rootVerified: true
  };
}

function folderFromDrive(file, config, kind, productKey, rootId, parentId) {
  const raw = cleanLabel(file.name || 'Pasta');
  const name = displayTheme(raw, config);
  return {
    id: file.id || '',
    parentId: parentId || '',
    name,
    rawName: raw,
    label: name,
    kind,
    type: 'folder',
    path: name,
    theme: name,
    themeId: kind === 'theme' ? file.id : parentId,
    product: productKey,
    productKey,
    catalogRootDriveId: rootId,
    rootVerified: true,
    liveDrive: true
  };
}

function folderResultFromRow(row, config, productKey, rootId) {
  const folder = folderFromRow(row, config, 'folder', productKey, rootId);
  const parts = Array.isArray(row.path_parts) ? row.path_parts : [];
  folder.theme = displayTheme(row.theme || parts[0] || folder.name, config);
  folder.themeId = row.depth === 1 ? row.drive_id : row.parent_drive_id;
  folder.trail = parts.slice(1).map((name, index) => ({
    id: index === parts.length - 2 ? row.drive_id : 'catalog-path-' + index + '-' + encodeURIComponent(name),
    name: displayTheme(name, config),
    kind: 'folder'
  }));
  return folder;
}

function publicFolder(folder, config) {
  const name = String(folder && (folder.rawName || folder.name) || '');
  return !internalCatalogName(name) &&
    !folder.hidden &&
    !isHiddenTheme(folder.name, config) &&
    !isHiddenTheme(folder.theme, config);
}

function internalCatalogName(value) {
  return /^codex\s+test(?:e)?(?:\s|$)/.test(norm(value));
}

function productConfig(config, productKey) {
  const products = config && config.products && typeof config.products === 'object' ? config.products : {};
  const raw = productKey === '50x50'
    ? (products.bolinhas || {})
    : (products.panel150 || products['painel-150'] || {});
  const defaults = productKey === '50x50'
    ? { label: 'Bolinhas 50x50', unitPrice: 9.9, minimum: 6, step: 2, initial: 6, enabled: true }
    : { label: 'Painel 150 cm', unitPrice: 0, minimum: 1, step: 1, initial: 1, enabled: false };
  const unitPrice = nonNegative(raw.unitPrice, defaults.unitPrice);
  return {
    label: cleanLabel(raw.label || defaults.label),
    unitPrice,
    minimum: positive(raw.minQty ?? raw.minimum, defaults.minimum),
    step: positive(raw.step, defaults.step),
    initial: positive(raw.initialQty ?? raw.initial, defaults.initial),
    enabled: raw.enabled !== false && unitPrice > 0
  };
}

function catalogFolderId(value, fallback) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if ([
    'catalog-v2-product:',
    'catalog-bolinhas-product:',
    'catalog-panel150-product:'
  ].some(prefix => text.startsWith(prefix))) return text;
  return /^[A-Za-z0-9_-]{5,200}$/.test(text) ? text : fallback;
}

function canonicalProduct(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === '50x50' || key === 'bolinhas' || key === 'bolinha') return '50x50';
  if (key === 'painel-150' || key === 'painel150' || key === 'painel') return 'painel-150';
  return '';
}

async function allRows(env, setup) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const batch = await limitedRows(env, params => {
      setup(params);
      params.set('offset', String(offset));
    }, PAGE_SIZE);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function limitedRows(env, setup, limit) {
  const params = baseIndexParams(Math.min(Math.max(Number(limit) || 80, 1), PAGE_SIZE));
  setup(params);
  return readIndex(env, params);
}

function virtualProductId(parentId, productKey) {
  return 'catalog-v2-product:' + encodeURIComponent(parentId) + ':' + encodeURIComponent(productKey);
}

function parseVirtualProductId(value) {
  const text = String(value || '');
  if (!text.startsWith('catalog-v2-product:')) return null;
  const parts = text.split(':');
  return {
    parentId: decodeURIComponent(parts[1] || ''),
    productKey: decodeURIComponent(parts[2] || '')
  };
}

function driveApiKey(env) {
  return String(env && (env.GOOGLE_API_KEY || env.GOOGLE_DRIVE_API_KEY || env.DRIVE_API_KEY) || '').trim();
}

function sortItems(a, b) {
  return (Number(b.sortId) || 0) - (Number(a.sortId) || 0);
}

function sortSearchFolders(folders) {
  return folders
    .sort((a, b) => String(a.path || a.name).localeCompare(String(b.path || b.name), 'pt-BR', { numeric: true }))
    .slice(0, 60);
}

function displayPath(path, config) {
  return String(path || '').split(' / ').map(part => displayTheme(part, config)).join(' / ');
}

function moneyBR(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function positive(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegative(value, fallback) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

function safeError(error) {
  return String(error && error.message || error || 'ERRO_DESCONHECIDO').slice(0, 220);
}

function json(payload, status = 200, ttl = 0) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl ? `public, max-age=${ttl}, stale-while-revalidate=30` : 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
