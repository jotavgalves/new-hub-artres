import { baseIndexParams, cleanLike, clampLimit, dedupeRows, json, mapArtwork, mapFolder, norm, readIndex, scoreRow } from '../_catalog_index.js';

export async function onRequestGet(context){
  try{
    const url = new URL(context.request.url);
    const q = String(url.searchParams.get('q') || '').trim();
    const type = String(url.searchParams.get('type') || 'artwork').trim();
    const limit = clampLimit(url.searchParams.get('limit') || 80);
    const debug = url.searchParams.get('debug') === '1';
    const nq = norm(q);
    const digits = q.replace(/\D/g, '');

    if(nq.length < 2 && digits.length < 2){
      return json({ ok:true, total:0, items:[], folders:[], source:'catalog_index' });
    }

    const rows = await searchIndex(context.env, q, type, limit);
    const sorted = dedupeRows(rows)
      .sort((a,b) => scoreRow(b, q) - scoreRow(a, q))
      .slice(0, limit);

    const artworkRows = sorted.filter(r => r.type === 'artwork');
    const folderRows = sorted.filter(r => r.type === 'folder');

    const payload = {
      ok: true,
      source: 'catalog_index',
      query: q,
      total: sorted.length,
      items: artworkRows.map(mapArtwork),
      folders: folderRows.map(mapFolder)
    };
    if(debug) payload.debug = { normalized: nq, rows: rows.length, type };
    return json(payload);
  }catch(error){
    return json({ ok:false, error:String(error && error.message || error || 'CATALOG_INDEX_SEARCH_ERROR') }, 500);
  }
}

async function searchIndex(env, q, type, limit){
  const nq = norm(q);
  const digits = String(q || '').replace(/\D/g, '');
  const rows = [];

  if(digits.length >= 2){
    const params = baseIndexParams(limit);
    params.set('type', 'eq.artwork');
    params.set('code', 'eq.' + digits);
    rows.push(...await readIndex(env, params));
  }

  if(/^[A-Za-z0-9_-]{10,}$/.test(String(q || '').trim())){
    const params = baseIndexParams(limit);
    params.set('drive_id', 'eq.' + String(q).trim());
    rows.push(...await readIndex(env, params));
  }

  const phrase = cleanLike(q);
  if(phrase.length >= 2){
    const params = baseIndexParams(Math.max(limit, 120));
    if(type === 'artwork' || type === 'folder') params.set('type', 'eq.' + type);
    params.set('search_text', 'ilike.*' + phrase + '*');
    rows.push(...await readIndex(env, params));
  }

  const tokens = nq.split(' ').filter(t => t.length >= 2).slice(0, 4);
  for(const token of tokens){
    if(rows.length >= limit * 3) break;
    const params = baseIndexParams(120);
    if(type === 'artwork' || type === 'folder') params.set('type', 'eq.' + type);
    params.set('search_text', 'ilike.*' + token + '*');
    const tokenRows = await readIndex(env, params);
    rows.push(...tokenRows.filter(row => tokens.every(t => String(row.search_text || '').includes(t))));
  }

  return rows;
}
