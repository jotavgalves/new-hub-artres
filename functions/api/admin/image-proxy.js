import { requireAdmin } from './_auth.js';

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return new Response('Unauthorized', { status: auth.status || 401 });

  const url = new URL(context.request.url);
  const raw = String(url.searchParams.get('url') || '').trim();
  if (!raw) return new Response('Missing url', { status: 400 });

  let target;
  try {
    target = new URL(raw);
  } catch (_) {
    return new Response('Invalid url', { status: 400 });
  }

  if (!['http:', 'https:'].includes(target.protocol)) {
    return new Response('Invalid protocol', { status: 400 });
  }

  const response = await fetch(target.toString(), {
    headers: {
      'User-Agent': 'ArmazemHub/1.0 PDF Image Proxy',
      'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    return new Response('Image fetch failed', { status: 502 });
  }

  const type = response.headers.get('content-type') || 'application/octet-stream';
  if (!type.startsWith('image/')) {
    return new Response('Not an image', { status: 415 });
  }

  const headers = new Headers();
  headers.set('Content-Type', type);
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: 200, headers });
}
