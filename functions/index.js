const MEDIA_PROTECTION_SCRIPT = '<script src="/assets/media-protection.js?v=1"></script>';
const CACHE_BUST_SCRIPT = '<script src="/assets/catalog-cache-bust.js?v=13"></script>';
const CUSTOMER_CHECKOUT_SCRIPT = '<script src="/assets/customer-checkout.js?v=6" defer></script>';
const SITE_TEXTS_SCRIPT = '<script src="/assets/site-texts-runtime.js?v=1" defer></script>';
const CATALOG_NAV_UX_SCRIPT = '<script src="/assets/catalog-navigation-ux.js?v=3" defer></script>';
const DYNAMIC_PRODUCT_COMMERCE_SYNC_SCRIPT = '<script src="/assets/dynamic-product-commerce-sync.js?v=2" defer></script>';
const CART_FIXED_MEASURE_POLISH_SCRIPT = '<script src="/assets/cart-fixed-measure-polish.js?v=2" defer></script>';
const HERO_LOGO_CENTER_STYLE = '<style id="heroLogoCenterStyle">.brand .logo{margin-left:auto;margin-right:auto}</style>';

const LEGACY_PRODUCT_CONFIG = 'function productConfig(product){return PRODUCT_CONFIG[product]||PRODUCT_CONFIG["painel-150"]}';
const FIXED_PRODUCT_CONFIG = `function productConfig(product){
  if(product==="painel-romano"||product==="retangular-1x2"){
    const fallback=product==="painel-romano"?{label:"Painel Romano 1x2",unitPrice:78}:{label:"Painel Retangular",unitPrice:78};
    const state=window.__ARMAZEM_DYNAMIC_PRODUCT_STATE__&&window.__ARMAZEM_DYNAMIC_PRODUCT_STATE__[product];
    const unitPrice=state&&Number(state.unitPrice)>0?Number(state.unitPrice):fallback.unitPrice;
    return{label:(state&&state.label)||fallback.label,type:"fixedRectangle",unitPrice,baseQty:1,basePrice:unitPrice,afterStep:1,initialQuantity:1,checkoutEnabled:!(state&&state.enabled===false),fixedWidth:100,fixedHeight:200,fixedSize:"1X2",sizeKey:"100x200"};
  }
  return PRODUCT_CONFIG[product]||PRODUCT_CONFIG["painel-150"]
}`;

export async function onRequest(context) {
  const assetResponse = await context.env.ASSETS.fetch(context.request);
  const contentType = assetResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetResponse;

  let html = await assetResponse.text();
  html = html.replace(/<script\s+src=["']\/assets\/media-protection\.js\?v=[^"']+["']><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/catalog-cache-bust\.js\?v=[^"']+["']><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/customer-checkout\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/site-texts-runtime\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/catalog-navigation-ux\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/dynamic-product-commerce-sync\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/cart-fixed-measure-polish\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/painel-romano-runtime\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace(/<script\s+src=["']\/assets\/painel-retangular-runtime\.js\?v=[^"']+["']\s+defer><\/script>/g, '');
  html = html.replace('<style id="heroLogoCenterStyle">.brand .logo{margin-left:auto;margin-right:auto}</style>', '');
  html = html.replace(LEGACY_PRODUCT_CONFIG, FIXED_PRODUCT_CONFIG);
  html = html.replace('</head>', `${HERO_LOGO_CENTER_STYLE}${MEDIA_PROTECTION_SCRIPT}${CACHE_BUST_SCRIPT}${CUSTOMER_CHECKOUT_SCRIPT}${SITE_TEXTS_SCRIPT}${CATALOG_NAV_UX_SCRIPT}${DYNAMIC_PRODUCT_COMMERCE_SYNC_SCRIPT}${CART_FIXED_MEASURE_POLISH_SCRIPT}</head>`);

  const headers = new Headers(assetResponse.headers);
  headers.delete('content-length');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-robots-tag', 'noimageindex');

  return new Response(html, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
}
