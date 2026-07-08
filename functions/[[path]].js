const CACHE_BUST_SCRIPT = '<script src="/assets/catalog-cache-bust.js?v=9"></script>';
const CUSTOMER_CHECKOUT_SCRIPT = '<script src="/assets/customer-checkout.js?v=6" defer></script>';
const CATALOG_DRIVE_SEARCH_SCRIPT = '<scr' + 'ipt src="/assets/catalog-drive-search.js?v=4" defer></scr' + 'ipt>';
const CATALOG_NAV_UX_SCRIPT = '<script src="/assets/catalog-navigation-ux.js?v=2" defer></script>';
const HERO_LOGO_CENTER_STYLE = '<style id="heroLogoCenterStyle">.brand .logo{margin-left:auto;margin-right:auto}</style>';
const ORDER_TOOLS_SCRIPT = '<script src="/assets/order-action-tools.js?v=4" defer></script>';
const CACHE_BUST_RE = /<script\s+src=["']\/assets\/catalog-cache-bust\.js\?v=[^"']+["']><\/script>/g;
const CUSTOMER_CHECKOUT_RE = /<script\s+src=["']\/assets\/customer-checkout\.js\?v=[^"']+["']\s+defer><\/script>/g;
const CATALOG_DRIVE_SEARCH_RE = new RegExp("<scr" + "ipt\\s+src=[\"']\\/assets\\/catalog-drive-search\\.js\\?v=[^\"']+[\"']\\s+defer><\\/scr" + "ipt>", "g");
const CATALOG_NAV_UX_RE = /<script\s+src=["']\/assets\/catalog-navigation-ux\.js\?v=[^"']+["']\s+defer><\/script>/g;
const HERO_LOGO_CENTER_RE = /<style\s+id=["']heroLogoCenterStyle["']>[^<]*<\/style>/g;
const ORDER_TOOLS_RE = /<script\s+src=["']\/assets\/order-action-tools\.js\?v=[^"']+["']\s+defer><\/script>/g;
const ADMIN_UI_FIX_RE = /<script\s+src=["']\/assets\/admin-ui-fix\.js\?v=[^"']+["']\s+defer><\/script>/g;
const PERMISSIONS_REAL_RE = /<script\s+src=["']\/assets\/admin-permissions-real\.js\?v=[^"']+["']\s+defer><\/script>/g;
const VENDOR_PANEL_RE = /<script\s+src=["']\/assets\/admin-vendor-panel\.js\?v=[^"']+["']\s+defer><\/script>/g;
const ORDERS_UNIFIED_RE = /<script\s+src=["']\/assets\/admin-orders-unified\.js\?v=[^"']+["']\s+defer><\/script>/g;

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

  if (url.pathname === '/adm' || url.pathname === '/adm/' || url.pathname === '/adm/index.html') {
    html = html.replace(ORDER_TOOLS_RE, '');
    html = html.replace(ORDERS_UNIFIED_RE, '');
    html = html.replace('</head>', `${ORDER_TOOLS_SCRIPT}</head>`);
    html = html.replace(ADMIN_UI_FIX_RE, '<script src="/assets/admin-ui-fix.js?v=4" defer></script>');
    html = html.replace(PERMISSIONS_REAL_RE, '<script src="/assets/admin-permissions-real.js?v=3" defer></script>');
    html = html.replace(VENDOR_PANEL_RE, '<script src="/assets/admin-vendor-panel.js?v=6" defer></script>');
  } else {
    html = html.replace(HERO_LOGO_CENTER_RE, '');
    html = html.replace(CATALOG_DRIVE_SEARCH_RE, '');
    html = html.replace(CATALOG_NAV_UX_RE, '');
    html = html.replace('</head>', `${HERO_LOGO_CENTER_STYLE}</head>`);

    if (CACHE_BUST_RE.test(html)) html = html.replace(CACHE_BUST_RE, CACHE_BUST_SCRIPT);
    else html = html.replace('</head>', `${CACHE_BUST_SCRIPT}</head>`);

    if (CUSTOMER_CHECKOUT_RE.test(html)) html = html.replace(CUSTOMER_CHECKOUT_RE, CUSTOMER_CHECKOUT_SCRIPT);
    else html = html.replace('</head>', `${CUSTOMER_CHECKOUT_SCRIPT}</head>`);

    html = html.replace('</head>', `${CATALOG_DRIVE_SEARCH_SCRIPT}${CATALOG_NAV_UX_SCRIPT}</head>`);
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
