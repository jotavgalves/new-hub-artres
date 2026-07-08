import { baseIndexParams, clampLimit, dedupeRows, json, mapArtwork, mapFolder, norm, productKey, readIndex } from '../_catalog_index.js';

export async function onRequestGet(context){
  try{
    const url = new URL(context.request.url);
    const mode = String(url.searchParams.get('mode') || 'themes');
    const limit = clampLimit(url.searchParams.get('limit') || 300);

    if(mode === 'themes'){
      const folders = await themeFolders(context.env, limit);
      return json({ ok:true, mode, source:'catalog_index', total:folders.length, folders });
    }

    if(mode === 'children'){
      const parentDriveId = String(url.searchParams.get('parentDriveId') || url.searchParams.get('parent') || '').trim();
      if(!parentDriveId) return json({ ok:false, error:'INFORME_PARENT_DRIVE_ID' }, 400);
      const rows = await childrenRows(context.env, parentDriveId, limit);
      return json({ ok:true, mode, source:'catalog_index', total:rows.length, folders:rows.filter(r=>r.type==='folder').map(mapFolder), items:rows.filter(r=>r.type==='artwork').map(mapArtwork) });
    }

    if(mode === 'products'){
      const theme = String(url.searchParams.get('theme') || '').trim();
      const rows = await artworkRowsBy(context.env, { theme }, Math.max(limit, 500));
      const products = productFoldersFromRows(rows);
      return json({ ok:true, mode, source:'catalog_index', theme, total:products.length, folders:products });
    }

    if(mode === 'items'){
      const theme = String(url.searchParams.get('theme') || '').trim();
      const product = String(url.searchParams.get('product') || '').trim();
      const rows = await artworkRowsBy(context.env, { theme, product }, limit);
      return json({ ok:true, mode, source:'catalog_index', theme, product, total:rows.length, items:rows.map(mapArtwork) });
    }

    return json({ ok:false, error:'MODO_INVALIDO' }, 400);
  }catch(error){
    return json({ ok:false, error:String(error && error.message || error || 'CATALOG_INDEX_TREE_ERROR') }, 500);
  }
}

async function themeFolders(env, limit){
  const params = baseIndexParams(limit);
  params.set('type', 'eq.folder');
  params.set('depth', 'eq.1');
  const rows = await readIndex(env, params);
  return rows.map(mapFolder);
}

async function childrenRows(env, parentDriveId, limit){
  const params = baseIndexParams(limit);
  params.set('parent_drive_id', 'eq.' + parentDriveId);
  const rows = await readIndex(env, params);
  return dedupeRows(rows);
}

async function artworkRowsBy(env, filter, limit){
  const params = baseIndexParams(limit);
  params.set('type', 'eq.artwork');
  if(filter.theme){
    params.set('theme', 'ilike.' + escapeIlike(filter.theme));
  }
  if(filter.product){
    params.set('product', 'ilike.' + escapeIlike(filter.product));
  }
  const rows = await readIndex(env, params);
  return dedupeRows(rows);
}

function productFoldersFromRows(rows){
  const seen = new Set();
  const out = [];
  for(const row of rows){
    const label = row.product || 'Artes';
    const key = norm(label);
    if(seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: 'catalog-index-product-' + key.replace(/[^a-z0-9]+/g, '-'),
      name: label,
      rawName: label,
      label,
      kind: 'product',
      product: productKey(label),
      productName: label,
      theme: row.theme || '',
      path: [row.theme, label].filter(Boolean).join(' / ')
    });
  }
  return out.sort((a,b)=>String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric:true }));
}

function escapeIlike(value){
  return '*' + String(value || '').replace(/[,*()]/g, ' ').replace(/\s+/g, ' ').trim() + '*';
}
