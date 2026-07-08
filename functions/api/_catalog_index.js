const DEFAULT_LIMIT = 80;
const BOLINHAS_ROOT_FOLDER_ID = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';
const BOLINHAS_PRODUCT_KEY = '50x50';
const BOLINHAS_PRODUCT_LABEL = 'Bolinhas 50x50';

export function envConfig(env){
  const base = restBase(env && (env.ARTS_SUPABASE_URL || env.SUPABASE_ARTS_URL || env.ARTWORKS_SUPABASE_URL || env.SUPABASE_REST_URL));
  const key = String(env && (env.ARTS_SUPABASE_SERVICE_KEY || env.SUPABASE_ARTS_SERVICE_KEY || env.ARTWORKS_SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY) || '').trim();
  if(!base || !key) throw new Error('CONFIGURE_ARTS_SUPABASE_URL_E_SERVICE_KEY');
  return { base, key };
}

export async function supabaseRows(env, table, params){
  const cfg = envConfig(env);
  const url = cfg.base + '/' + table + '?' + params.toString();
  const response = await fetch(url, {
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      Accept: 'application/json'
    }
  });
  if(!response.ok) throw new Error('SUPABASE_' + table.toUpperCase() + '_' + response.status);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export async function readIndex(env, params){
  return supabaseRows(env, 'catalog_index', params);
}

export function baseIndexParams(limit){
  const params = new URLSearchParams({
    select: 'drive_id,parent_drive_id,root_drive_id,type,name,mime_type,path,path_parts,depth,theme,subtheme,product,size,code,extension,drive_url,thumbnail_url,search_text,indexed_at,deleted_at',
    order: 'type.asc,theme.asc,product.asc,code.desc',
    limit: String(clampLimit(limit))
  });
  params.set('deleted_at', 'is.null');
  return params;
}

export function clampLimit(value){
  const n = Number(value || DEFAULT_LIMIT);
  return Math.min(Math.max(Number.isFinite(n) ? n : DEFAULT_LIMIT, 1), 500);
}

export function json(payload, status = 200){
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export function norm(value){
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanLike(value){
  return norm(value).replace(/[,*()]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function scoreRow(row, q){
  const raw = String(q || '').trim();
  const nq = norm(raw);
  const digits = raw.replace(/\D/g, '');
  const code = String(row.code || '');
  const driveId = String(row.drive_id || '');
  const text = String(row.search_text || '');
  if(digits && code === digits) return 2000;
  if(digits && String(row.name || '').includes(digits)) return 1700;
  if(driveId && driveId === raw) return 1600;
  if(norm(row.theme) === nq) return 1200;
  if(norm(row.product) === nq) return 1100;
  if(norm(row.name).includes(nq)) return 1000;
  if(text.includes(nq)) return 900;
  const tokens = nq.split(' ').filter(Boolean);
  if(tokens.length > 1 && tokens.every(t => text.includes(t))) return 700;
  return 1;
}

export function dedupeRows(rows){
  const seen = new Set();
  return (rows || []).filter(row => {
    const key = String(row.drive_id || row.id || '');
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isBolinhasRoot(row){
  return String(row && row.root_drive_id || '') === BOLINHAS_ROOT_FOLDER_ID;
}

export function catalogProductKey(row){
  return isBolinhasRoot(row) ? BOLINHAS_PRODUCT_KEY : productKey(row && row.product);
}

export function catalogProductLabel(row){
  return isBolinhasRoot(row) ? BOLINHAS_PRODUCT_LABEL : (row && row.product || 'Arte');
}

export function mapArtwork(row){
  const image = row.thumbnail_url || (row.drive_id ? 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(row.drive_id) + '&sz=w1200' : '');
  const product = catalogProductKey(row);
  const productName = catalogProductLabel(row);
  return {
    id: row.drive_id || String(row.id || ''),
    code: String(row.code || row.name || '').replace(/^#/, ''),
    theme: row.theme || 'Sem tema',
    subtheme: row.subtheme || '',
    product,
    productName,
    productLabel: productName,
    size: row.size || '',
    dimension: row.size || '',
    driveFileId: row.drive_id || '',
    originalName: row.name || '',
    path: row.path || '',
    driveUrl: row.drive_url || '',
    image,
    thumbnail: image,
    qty: 1,
    details: isBolinhasRoot(row) ? { size: row.size || '50x50' } : {}
  };
}

export function mapFolder(row){
  const product = catalogProductKey(row);
  const productName = isBolinhasRoot(row) ? BOLINHAS_PRODUCT_LABEL : (row.product || '');
  return {
    id: row.drive_id || '',
    parentId: row.parent_drive_id || '',
    name: row.name || row.theme || row.product || 'Pasta',
    rawName: row.name || '',
    label: row.name || row.theme || row.product || 'Pasta',
    kind: 'folder',
    type: row.type || 'folder',
    path: row.path || '',
    theme: row.theme || '',
    product,
    productName
  };
}

export function productKey(value){
  const v = norm(value);
  if(v.includes('50') || v.includes('bolinha')) return '50x50';
  if(v.includes('sacol')) return 'sacolinha';
  if(v.includes('cilind')) return 'cilindros';
  if(v.includes('romano') && v.includes('kit')) return 'kit-romano';
  if(v.includes('romano')) return 'romano';
  if(v.includes('kit') && v.includes('painel')) return 'kit-painel-cilindros';
  if(v.includes('cenario')) return 'cenario';
  if(v.includes('lateral') || v.includes('retangular')) return 'lateral';
  if(v.includes('painel') || v.includes('redondo')) return 'painel-150';
  return 'painel-150';
}

function restBase(value){
  let u = String(value || '').trim().replace(/\/+$/, '');
  if(!u) return '';
  if(!/\/rest\/v1$/.test(u)) u += '/rest/v1';
  return u;
}
