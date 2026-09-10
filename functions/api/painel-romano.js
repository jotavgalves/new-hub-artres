import { loadConfig } from './_config.js';

const ROOT_FOLDER_ID = '15f6Ge0jZCHSIWMhmEUOs4bfXy9y5U3wk';
const PRODUCT_KEY = 'painel-romano';
const DEFAULT_LABEL = 'Painel Romano 1x2';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const MAX_DEPTH = 8;
const MAX_FOLDERS = 400;
const MAX_ARTWORKS = 4000;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const mode = clean(url.searchParams.get('mode') || 'items');
    const theme = clean(url.searchParams.get('theme') || '');
    const query = clean(url.searchParams.get('q') || url.searchParams.get('code') || '');
    const apiKey = driveApiKey(context.env);
    if (!apiKey) return json({ ok:false, error:'GOOGLE_DRIVE_API_KEY_NAO_CONFIGURADA' }, 503);

    const { config } = await loadConfig(context.env);
    const commercial = romanProduct(config);
    const catalog = await scanRomanDrive(apiKey);

    if (mode === 'themes') {
      const folders = uniqueThemes(catalog).map(t => ({
        id: `painel-romano-theme:${t.id}`,
        driveFolderId: t.id,
        name: t.name,
        theme: t.name,
        kind: 'theme',
        product: PRODUCT_KEY,
        productKey: PRODUCT_KEY,
        productName: commercial.label
      }));
      return json({ ok:true, mode, rootFolderId:ROOT_FOLDER_ID, folders, total:folders.length, product:commercial });
    }

    if (mode === 'search') {
      const wanted = norm(query);
      const digits = query.replace(/\D/g, '');
      const items = catalog.artworks
        .filter(row => {
          if (!wanted && !digits) return false;
          if (digits && String(row.code || '') === digits) return true;
          return norm([row.code, row.name, row.theme, row.path].filter(Boolean).join(' ')).includes(wanted);
        })
        .map(row => asItem(row, commercial))
        .sort(sortItems)
        .slice(0, 100);
      return json({ ok:true, mode, rootFolderId:ROOT_FOLDER_ID, total:items.length, items, product:commercial });
    }

    if (mode === 'has-theme') {
      const available = catalog.artworks.some(row => themeMatches(row, theme));
      return json({ ok:true, mode, rootFolderId:ROOT_FOLDER_ID, theme, available, product:commercial });
    }

    if (mode === 'items') {
      const items = catalog.artworks
        .filter(row => !theme || themeMatches(row, theme))
        .map(row => asItem(row, commercial))
        .sort(sortItems);
      return json({
        ok:true,
        mode,
        source:'google-drive-live',
        rootFolderId:ROOT_FOLDER_ID,
        theme,
        product:PRODUCT_KEY,
        productName:commercial.label,
        size:'1X2',
        sizeKey:'100x200',
        total:items.length,
        items
      });
    }

    return json({ ok:false, error:'MODO_INVALIDO' }, 400);
  } catch (error) {
    return json({
      ok:false,
      error:'FALHA_AO_LER_PAINEL_ROMANO',
      detail:String(error && error.message || error || '').slice(0, 240)
    }, 500);
  }
}

async function scanRomanDrive(apiKey) {
  const queue = [{ id:ROOT_FOLDER_ID, pathParts:[], depth:0, themeFolderId:'' }];
  const artworks = [];
  const themeFolders = [];
  const seen = new Set();
  let visitedFolders = 0;

  while (queue.length && visitedFolders < MAX_FOLDERS && artworks.length < MAX_ARTWORKS) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    visitedFolders++;

    const children = await listChildren(apiKey, current.id);
    for (const file of children) {
      const mime = String(file && file.mimeType || '');
      if (mime === 'application/vnd.google-apps.folder') {
        if (current.depth >= MAX_DEPTH) continue;
        const folderName = clean(file.name || '');
        const nextPath = current.pathParts.concat(folderName).filter(Boolean);
        const themeFolderId = current.depth === 0 ? String(file.id || '') : current.themeFolderId;
        if (current.depth === 0 && folderName) themeFolders.push({ id:String(file.id || ''), name:folderName });
        queue.push({
          id:String(file.id || ''),
          pathParts:nextPath,
          depth:current.depth + 1,
          themeFolderId
        });
        continue;
      }

      if (!mime.startsWith('image/')) continue;
      const id = String(file.id || '');
      const name = clean(file.name || 'Sem nome');
      const theme = current.pathParts[0] || '';
      artworks.push({
        id,
        name,
        code:extractArtworkCode(name),
        theme,
        themeFolderId:current.themeFolderId || '',
        parentFolderId:current.id,
        pathParts:current.pathParts.slice(),
        path:current.pathParts.concat(name).join(' / '),
        image:id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200` : '',
        driveUrl:id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '',
        modifiedTime:String(file.modifiedTime || '')
      });
      if (artworks.length >= MAX_ARTWORKS) break;
    }
  }

  return { artworks, themeFolders, visitedFolders };
}

async function listChildren(apiKey, folderId) {
  const files = [];
  let pageToken = '';
  do {
    const url = new URL(DRIVE_API);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('q', `'${escapeDriveQuery(folderId)}' in parents and trashed = false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,parents,fileExtension,modifiedTime,createdTime,size)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url.toString(), { headers:{ Accept:'application/json' } });
    if (!response.ok) throw new Error(`GOOGLE_DRIVE_${response.status}`);
    const data = await response.json();
    files.push(...(Array.isArray(data.files) ? data.files : []));
    pageToken = String(data.nextPageToken || '');
  } while (pageToken);
  return files;
}

function romanProduct(config) {
  const products = config && config.products && typeof config.products === 'object' ? config.products : {};
  const raw = products.painelRomano || products['painel-romano'] || {};
  const unitPrice = number(raw.unitPrice, 0);
  return {
    key:PRODUCT_KEY,
    label:clean(raw.label || DEFAULT_LABEL) || DEFAULT_LABEL,
    enabled:raw.enabled !== false && unitPrice > 0,
    unitPrice,
    minQty:positive(raw.minQty || raw.minimum, 1),
    step:positive(raw.step, 1),
    initialQty:positive(raw.initialQty || raw.initial, 1),
    size:'1X2',
    sizeKey:'100x200',
    rootFolderId:ROOT_FOLDER_ID
  };
}

function asItem(row, commercial) {
  return {
    id:row.id,
    driveFileId:row.id,
    code:row.code || row.id,
    sortId:Number(row.code) || 0,
    theme:row.theme || 'Sem tema',
    themeId:row.themeFolderId || '',
    product:PRODUCT_KEY,
    productKey:PRODUCT_KEY,
    productName:commercial.label,
    productLabel:commercial.label,
    productFolderId:`painel-romano:${row.themeFolderId || norm(row.theme || 'sem-tema')}`,
    size:'1X2',
    sizeKey:'100x200',
    image:row.image,
    driveUrl:row.driveUrl,
    name:row.name,
    path:row.path,
    details:{
      size:'1X2',
      sizeKey:'100x200',
      width:100,
      height:200,
      unit:'cm',
      fixed:true
    }
  };
}

function uniqueThemes(catalog) {
  const map = new Map();
  for (const folder of catalog.themeFolders || []) {
    const key = norm(folder.name);
    if (key && !map.has(key)) map.set(key, folder);
  }
  return [...map.values()].sort((a,b) => a.name.localeCompare(b.name, 'pt-BR', { numeric:true }));
}

function themeMatches(row, wantedTheme) {
  const wanted = norm(wantedTheme);
  if (!wanted) return true;
  const candidates = [row.theme, ...(row.pathParts || [])].map(norm).filter(Boolean);
  return candidates.some(value => value === wanted || value.includes(wanted) || wanted.includes(value));
}

function sortItems(a, b) {
  return (Number(b.sortId) || 0) - (Number(a.sortId) || 0) || String(a.code).localeCompare(String(b.code), 'pt-BR', { numeric:true });
}

function extractArtworkCode(name) {
  const base = clean(name).replace(/\.[a-z0-9]{2,5}$/i, '');
  const match = base.match(/(?:^|[^0-9])#?([0-9]{2,7})(?:[^0-9]|$)/);
  return match ? match[1] : '';
}

function driveApiKey(env) {
  return String(env && (env.GOOGLE_API_KEY || env.GOOGLE_DRIVE_API_KEY || env.DRIVE_API_KEY) || '').trim();
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function norm(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value, fallback) {
  const parsed = Number(String(value == null ? '' : value).replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

function positive(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff'
    }
  });
}
