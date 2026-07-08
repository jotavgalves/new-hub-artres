#!/usr/bin/env node
/*
  Reindexa todo o catálogo do Google Drive em public.catalog_index no Supabase.

  Requisitos:
    GOOGLE_API_KEY
    DRIVE_ROOT_FOLDER_ID
    ARTS_SUPABASE_URL=https://...supabase.co/rest/v1
    ARTS_SUPABASE_SERVICE_KEY=sb_secret_...

  Uso:
    node scripts/reindex-drive-catalog.mjs
    node scripts/reindex-drive-catalog.mjs --dry-run
    node scripts/reindex-drive-catalog.mjs --root=ID_DA_PASTA --max-depth=20
*/

import { readFileSync, existsSync } from 'node:fs';
import process from 'node:process';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEFAULT_BATCH_SIZE = 250;

loadEnvFile('.env');
loadEnvFile('.env.local');
loadEnvFile('.env.catalog-index');

const args = parseArgs(process.argv.slice(2));
const RUN_ID = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + Math.random().toString(16).slice(2, 8);
const GOOGLE_API_KEY = mustEnv('GOOGLE_API_KEY', 'GOOGLE_DRIVE_API_KEY', 'DRIVE_API_KEY');
const ROOT_FOLDER_ID = args.root || process.env.DRIVE_ROOT_FOLDER_ID || process.env.CATALOG_DRIVE_ROOT_ID || process.env.ROOT_FOLDER_ID;
const SUPABASE_URL = restBase(process.env.ARTS_SUPABASE_URL || process.env.SUPABASE_ARTS_URL || process.env.ARTWORKS_SUPABASE_URL || process.env.SUPABASE_REST_URL);
const SUPABASE_KEY = process.env.ARTS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_ARTS_SERVICE_KEY || process.env.ARTWORKS_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = !!args['dry-run'];
const DELETE_STALE = args['delete-stale'] !== false && args['no-stale-delete'] !== true;
const MAX_DEPTH = Number(args['max-depth'] || process.env.CATALOG_INDEX_MAX_DEPTH || 30);
const BATCH_SIZE = Number(args['batch-size'] || process.env.CATALOG_INDEX_BATCH_SIZE || DEFAULT_BATCH_SIZE);
const INDEX_OTHER_FILES = args['index-other'] === true || process.env.CATALOG_INDEX_OTHER_FILES === '1';

if (!ROOT_FOLDER_ID) fail('Defina DRIVE_ROOT_FOLDER_ID ou use --root=ID_DA_PASTA.');
if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_KEY)) fail('Defina ARTS_SUPABASE_URL e ARTS_SUPABASE_SERVICE_KEY, ou rode com --dry-run.');

const stats = {
  folders: 0,
  artworks: 0,
  other: 0,
  batches: 0,
  skipped: 0,
  errors: 0
};

main().catch(error => {
  console.error('\n[ERRO]', error && error.stack || error);
  process.exit(1);
});

async function main() {
  console.log('== Reindexação do catálogo Drive ==');
  console.log('run_id:', RUN_ID);
  console.log('root:', ROOT_FOLDER_ID);
  console.log('dry_run:', DRY_RUN ? 'sim' : 'não');
  console.log('delete_stale:', DELETE_STALE && !DRY_RUN ? 'sim' : 'não');

  if (!DRY_RUN) await assertSupabaseReady();

  const buffer = [];
  const seenFolders = new Set();
  const queue = [{ folderId: ROOT_FOLDER_ID, pathParts: [], depth: 0 }];

  while (queue.length) {
    const current = queue.shift();
    if (!current || !current.folderId) continue;
    if (seenFolders.has(current.folderId)) continue;
    seenFolders.add(current.folderId);
    if (current.depth > MAX_DEPTH) {
      stats.skipped++;
      continue;
    }

    const children = await listChildren(current.folderId);
    for (const file of children) {
      const isFolder = file.mimeType === FOLDER_MIME;
      const isImage = String(file.mimeType || '').startsWith('image/');
      if (!isFolder && !isImage && !INDEX_OTHER_FILES) {
        stats.skipped++;
        continue;
      }

      const childPathParts = isFolder ? current.pathParts.concat([cleanLabel(file.name)]) : current.pathParts;
      const row = toCatalogRow(file, current, isFolder, isImage);
      buffer.push(row);
      if (row.type === 'folder') stats.folders++;
      else if (row.type === 'artwork') stats.artworks++;
      else stats.other++;

      if (isFolder) queue.push({ folderId: file.id, pathParts: childPathParts, depth: current.depth + 1 });
      if (buffer.length >= BATCH_SIZE) await flush(buffer);
    }
  }

  await flush(buffer);

  if (!DRY_RUN && DELETE_STALE) await markStaleDeleted();

  console.log('\n== Fim ==');
  console.log(JSON.stringify(stats, null, 2));
}

async function listChildren(folderId) {
  const out = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      q: `'${String(folderId).replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id,name,mimeType,webViewLink,webContentLink,thumbnailLink,parents,modifiedTime,createdTime,size,fileExtension)',
      pageSize: '1000',
      orderBy: 'folder,name_natural',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const url = DRIVE_API + '?' + params.toString();
    const response = await fetchWithRetry(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Drive API ${response.status}: ${await response.text()}`);
    const data = await response.json();
    out.push(...(Array.isArray(data.files) ? data.files : []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

function toCatalogRow(file, current, isFolder, isImage) {
  const name = cleanLabel(file.name || 'Sem nome');
  const type = isFolder ? 'folder' : isImage ? 'artwork' : 'other';
  const pathParts = isFolder ? current.pathParts.concat([name]) : current.pathParts.slice();
  const fullPath = isFolder ? pathParts.join(' / ') : pathParts.concat([name]).join(' / ');
  const parsed = parseArtwork(name, pathParts);
  const theme = pathParts[0] || parsed.theme || '';
  const subtheme = pathParts.length > 2 ? pathParts.slice(1, -1).join(' / ') : (pathParts.length === 2 ? pathParts[1] : '');
  const product = parsed.product || detectProduct(pathParts.concat([name]));
  const size = parsed.size || detectSize(pathParts.concat([name]));
  const code = type === 'artwork' ? parsed.code : '';
  const driveUrl = file.webViewLink || (isFolder ? `https://drive.google.com/drive/folders/${file.id}` : `https://drive.google.com/file/d/${file.id}/view`);
  const thumbnailUrl = isImage ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1200` : '';
  const searchText = normalizeSearch([
    code,
    name,
    theme,
    subtheme,
    product,
    size,
    fullPath,
    file.id,
    file.fileExtension || ''
  ].join(' '));

  return {
    drive_id: file.id,
    parent_drive_id: current.folderId || null,
    root_drive_id: ROOT_FOLDER_ID,
    type,
    name,
    normalized_name: normalizeSearch(name),
    mime_type: file.mimeType || '',
    path: fullPath,
    path_parts: pathParts,
    depth: pathParts.length,
    theme: theme || null,
    subtheme: subtheme || null,
    product: product || null,
    size: size || null,
    code: code || null,
    extension: file.fileExtension || extensionFromName(name),
    drive_url: driveUrl,
    thumbnail_url: thumbnailUrl,
    search_text: searchText,
    raw: {
      createdTime: file.createdTime || null,
      modifiedTime: file.modifiedTime || null,
      size: file.size || null,
      parents: file.parents || []
    },
    last_indexed_run_id: RUN_ID,
    indexed_at: new Date().toISOString(),
    deleted_at: null
  };
}

function parseArtwork(name, pathParts) {
  const clean = cleanLabel(name);
  const withoutExt = clean.replace(/\.[a-z0-9]{2,5}$/i, '');
  const codeMatch = withoutExt.match(/(?:^|[^0-9])#?([0-9]{2,7})(?:[^0-9]|$)/);
  const code = codeMatch ? codeMatch[1] : '';
  const size = detectSize(pathParts.concat([withoutExt]));
  const product = detectProduct(pathParts.concat([withoutExt]));
  const theme = pathParts[0] || '';
  return { code, size, product, theme };
}

function detectProduct(parts) {
  const text = normalizeSearch(parts.join(' '));
  if (/sacol(inha|a)|sacola/.test(text)) return 'Sacolinha';
  if (/cilindro|cilindros/.test(text)) return 'Cilindros';
  if (/romano/.test(text) && /kit/.test(text)) return 'Kit + Romano';
  if (/romano/.test(text)) return 'Romano';
  if (/kit/.test(text) && /painel/.test(text)) return 'Kit Painel + Cilindros';
  if (/cenario|cenario/.test(text)) return 'Cenário';
  if (/lateral|retangular/.test(text)) return 'Lateral';
  if (/painel|redondo|redonda/.test(text)) return 'Painel Redondo';
  if (/50\s*x\s*50|bolinha|bolinhas/.test(text)) return 'Bolinhas';
  return parts.length > 1 ? cleanLabel(parts[parts.length - 1]) : '';
}

function detectSize(parts) {
  const text = parts.join(' ');
  const m = text.match(/(\d+(?:[,.]\d+)?)\s*(?:x|×)\s*(\d+(?:[,.]\d+)?)(?:\s*(cm|m))?/i);
  if (m) return `${m[1].replace('.', ',')}x${m[2].replace('.', ',')}${m[3] ? m[3].toLowerCase() : ''}`;
  const d = text.match(/(?:diametro|diâmetro|redondo|painel)[^0-9]*(\d{2,3})(?:\s*cm)?/i);
  if (d) return `${d[1]}cm`;
  return '';
}

async function flush(buffer) {
  if (!buffer.length) return;
  const batch = buffer.splice(0, buffer.length);
  stats.batches++;
  if (DRY_RUN) {
    console.log(`[dry-run] lote ${stats.batches}: ${batch.length} itens`);
    return;
  }
  const url = `${SUPABASE_URL}/catalog_index?on_conflict=drive_id`;
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(batch)
  });
  if (!response.ok) {
    stats.errors++;
    throw new Error(`Supabase upsert ${response.status}: ${await response.text()}`);
  }
  console.log(`lote ${stats.batches}: ${batch.length} itens gravados`);
}

async function markStaleDeleted() {
  const url = `${SUPABASE_URL}/catalog_index?root_drive_id=eq.${encodeURIComponent(ROOT_FOLDER_ID)}&last_indexed_run_id=neq.${encodeURIComponent(RUN_ID)}&deleted_at=is.null`;
  const response = await fetchWithRetry(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ deleted_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error(`Supabase stale delete ${response.status}: ${await response.text()}`);
  console.log('itens antigos marcados como deleted_at');
}

async function assertSupabaseReady() {
  const url = `${SUPABASE_URL}/catalog_index?select=id&limit=1`;
  const response = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' }
  });
  if (response.status === 404) {
    throw new Error('Tabela public.catalog_index não existe. Rode supabase/catalog_index.sql no Supabase antes.');
  }
  if (!response.ok) throw new Error(`Falha ao acessar catalog_index ${response.status}: ${await response.text()}`);
}

async function fetchWithRetry(url, options = {}, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, options);
      if (![429, 500, 502, 503, 504].includes(response.status)) return response;
      last = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      last = error;
    }
    await sleep(500 * Math.pow(2, i));
  }
  throw last;
}

function cleanLabel(value) { return String(value || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalizeSearch(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function extensionFromName(name) { const m = String(name || '').match(/\.([a-z0-9]{2,5})$/i); return m ? m[1].toLowerCase() : ''; }
function restBase(value) { let u = String(value || '').trim().replace(/\/+$/, ''); if (!u) return ''; if (!/\/rest\/v1$/.test(u)) u += '/rest/v1'; return u; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function fail(message) { console.error('[ERRO]', message); process.exit(1); }
function mustEnv(...names) { for (const name of names) if (process.env[name]) return process.env[name]; fail(`Defina ${names.join(' ou ')}.`); }

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const raw = arg.slice(2);
    const [key, ...rest] = raw.split('=');
    const value = rest.length ? rest.join('=') : true;
    if (key.startsWith('no-')) out[key] = true;
    else out[key] = value === 'false' ? false : value;
  }
  return out;
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  text.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  });
}
