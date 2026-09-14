import { baseIndexParams, readIndex } from './_catalog_index.js';
import { extractDriveId, sealMediaId } from './_image_guard.js';

const MAX_IDS = 500;
const QUERY_CHUNK = 80;

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const raw = Array.isArray(body && body.ids) ? body.ids : [];
    const ids = [...new Set(raw.map(extractDriveId).filter(Boolean))].slice(0, MAX_IDS);
    if (!ids.length) return json({ ok:true, urls:{} }, 200);

    const allowed = new Set();
    for (let i = 0; i < ids.length; i += QUERY_CHUNK) {
      const chunk = ids.slice(i, i + QUERY_CHUNK);
      const params = baseIndexParams(chunk.length);
      params.set('type', 'eq.artwork');
      params.set('drive_id', 'in.(' + chunk.join(',') + ')');
      const rows = await readIndex(context.env, params);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row && row.drive_id) allowed.add(String(row.drive_id));
      }
    }

    const urls = {};
    await Promise.all([...allowed].map(async id => {
      const token = await sealMediaId(context.env, id);
      urls[id] = '/api/media?t=' + encodeURIComponent(token);
    }));

    return json({ ok:true, urls }, 200);
  } catch (error) {
    console.warn('IMAGE_TOKEN_BATCH_FAILED', String(error && error.message || error));
    return json({ ok:false, error:'FALHA_AO_PROTEGER_IMAGENS' }, 500);
  }
}

function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff',
      'X-Robots-Tag':'noindex, noimageindex, noarchive'
    }
  });
}
