import { baseIndexParams, readIndex } from './_catalog_index.js';
import { extractDriveId, sealMediaId } from './_image_guard.js';

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const fileId = extractDriveId(body && (body.fileId || body.source || body.url) || '');
    if (!fileId) return json({ ok:false, error:'IMAGEM_INVALIDA' }, 400);

    const params = baseIndexParams(1);
    params.set('type', 'eq.artwork');
    params.set('drive_id', 'eq.' + fileId);
    const rows = await readIndex(context.env, params);
    if (!Array.isArray(rows) || !rows.length) return json({ ok:false, error:'IMAGEM_NAO_ENCONTRADA' }, 404);

    const token = await sealMediaId(context.env, fileId);
    return json({ ok:true, url:'/api/media?t=' + encodeURIComponent(token) }, 200);
  } catch (error) {
    console.warn('IMAGE_TOKEN_FAILED', String(error && error.message || error));
    return json({ ok:false, error:'FALHA_AO_PROTEGER_IMAGEM' }, 500);
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
