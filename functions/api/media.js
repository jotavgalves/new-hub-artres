import { openMediaId } from './_image_guard.js';

const MAX_PREVIEW_WIDTH = 900;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const token = String(url.searchParams.get('t') || '').trim();
    if (!token) return text('Imagem indisponível.', 400);

    const fileId = await openMediaId(context.env, token);
    const source = `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${MAX_PREVIEW_WIDTH}`;
    const upstream = await fetch(source, {
      redirect:'follow',
      headers:{
        Accept:'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent':'Mozilla/5.0'
      }
    });

    if (!upstream.ok) return text('Imagem indisponível.', upstream.status === 404 ? 404 : 502);

    const contentType = String(upstream.headers.get('content-type') || 'image/jpeg');
    if (!contentType.startsWith('image/')) return text('Imagem indisponível.', 502);

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'private, max-age=1800, stale-while-revalidate=300');
    headers.set('Content-Disposition', 'inline');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Robots-Tag', 'noindex, noimageindex, noarchive');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');

    return new Response(upstream.body, { status:200, headers });
  } catch (error) {
    console.warn('MEDIA_PREVIEW_FAILED', String(error && error.message || error));
    return text('Imagem indisponível.', 404);
  }
}

function text(message, status) {
  return new Response(message, {
    status,
    headers:{
      'Content-Type':'text/plain; charset=utf-8',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff',
      'X-Robots-Tag':'noindex, noimageindex, noarchive'
    }
  });
}
