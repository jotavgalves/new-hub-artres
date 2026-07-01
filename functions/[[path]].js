const CACHE_BUST_SCRIPT = '<script src="/assets/catalog-cache-bust.js?v=4"></script>';
const CUSTOMER_CHECKOUT_SCRIPT = '<script src="/assets/customer-checkout.js?v=1" defer></script>';
const CACHE_BUST_RE = /<script\s+src=["']\/assets\/catalog-cache-bust\.js\?v=[^"']+["']><\/script>/g;
const CUSTOMER_CHECKOUT_RE = /<script\s+src=["']\/assets\/customer-checkout\.js\?v=[^"']+["']\s+defer><\/script>/g;

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
  if (CACHE_BUST_RE.test(html)) html = html.replace(CACHE_BUST_RE, CACHE_BUST_SCRIPT);
  else html = html.replace('</head>', `${CACHE_BUST_SCRIPT}</head>`);

  if (CUSTOMER_CHECKOUT_RE.test(html)) html = html.replace(CUSTOMER_CHECKOUT_RE, CUSTOMER_CHECKOUT_SCRIPT);
  else html = html.replace('</head>', `${CUSTOMER_CHECKOUT_SCRIPT}</head>`);

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
