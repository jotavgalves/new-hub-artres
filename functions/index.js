const CACHE_BUST_SCRIPT = '<script src="/assets/catalog-cache-bust.js?v=5"></script>';
const CUSTOMER_CHECKOUT_SCRIPT = '<script src="/assets/customer-checkout.js?v=1" defer></script>';

export async function onRequest(context) {
  const assetResponse = await context.env.ASSETS.fetch(context.request);
  const contentType = assetResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetResponse;

  let html = await assetResponse.text();
  html = html.replace('<script src="/assets/catalog-cache-bust.js?v=1"></script>', '');
  html = html.replace('<script src="/assets/catalog-cache-bust.js?v=2"></script>', '');
  html = html.replace('<script src="/assets/catalog-cache-bust.js?v=3"></script>', '');
  html = html.replace('<script src="/assets/catalog-cache-bust.js?v=4"></script>', '');
  html = html.replace('<script src="/assets/catalog-cache-bust.js?v=5"></script>', '');
  html = html.replace('<script src="/assets/customer-checkout.js?v=1" defer></script>', '');
  html = html.replace('</head>', `${CACHE_BUST_SCRIPT}${CUSTOMER_CHECKOUT_SCRIPT}</head>`);

  const headers = new Headers(assetResponse.headers);
  headers.delete('content-length');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');

  return new Response(html, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
}
