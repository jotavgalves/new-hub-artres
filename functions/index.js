const CACHE_BUST_SCRIPT = '<script src="/assets/catalog-cache-bust.js?v=9"></script>';
const CUSTOMER_CHECKOUT_SCRIPT = '<script src="/assets/customer-checkout.js?v=6" defer></script>';
const SITE_TEXTS_SCRIPT = '<script src="/assets/site-texts-runtime.js?v=1" defer></script>';
const CATALOG_NAV_UX_SCRIPT = '<script src="/assets/catalog-navigation-ux.js?v=3" defer></script>';
const HERO_LOGO_CENTER_STYLE = '<style id="heroLogoCenterStyle">.brand .logo{margin-left:auto;margin-right:auto}</style>';

export async function onRequest(context) {
  const assetResponse = await context.env.ASSETS.fetch(context.request);
  const contentType = assetResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetResponse;

  let html = await assetResponse.text();
  html = html.replace(/<script\s+src=["']\/assets\/catalog-cache-bust\.js\?v=[^"']+["']><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/customer-checkout\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/site-texts-runtime\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/catalog-navigation-ux\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace('<style id="heroLogoCenterStyle">.brand .logo{margin-left:auto;margin-right:auto}</style>', '');
  html = html.replace('</head>', `${HERO_LOGO_CENTER_STYLE}${CACHE_BUST_SCRIPT}${CUSTOMER_CHECKOUT_SCRIPT}${SITE_TEXTS_SCRIPT}${CATALOG_NAV_UX_SCRIPT}</head>`);

  const headers = new Headers(assetResponse.headers);
  headers.delete('content-length');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');

  return new Response(html, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
}
