const CACHE_BUST_SCRIPT = '<script src="/assets/catalog-cache-bust.js?v=3"></script>';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname.startsWith('/api/')) {
    return context.next ? context.next() : new Response('Not found', { status: 404 });
  }

  const assetResponse = await context.env.ASSETS.fetch(context.request);
  const contentType = assetResponse.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    return assetResponse;
  }

  let html = await assetResponse.text();
  if (!html.includes('/assets/catalog-cache-bust.js')) {
    html = html.replace('</head>', `${CACHE_BUST_SCRIPT}</head>`);
  }

  const headers = new Headers(assetResponse.headers);
  headers.delete('content-length');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');

  return new Response(html, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers
  });
}
