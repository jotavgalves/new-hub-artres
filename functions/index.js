import { loadConfig } from './api/_config.js';

const MEDIA_PROTECTION_SCRIPT = '<script src="/assets/media-protection.js?v=2"></script>';
const CACHE_BUST_SCRIPT = '<script src="/assets/catalog-cache-bust.js?v=15"></script>';
const CUSTOMER_CHECKOUT_SCRIPT = '<script src="/assets/customer-checkout.js?v=6" defer></script>';
const SITE_TEXTS_SCRIPT = '<script src="/assets/site-texts-runtime.js?v=1" defer></script>';
const CATALOG_NAV_UX_SCRIPT = '<script src="/assets/catalog-navigation-ux.js?v=3" defer></script>';
const CART_FIXED_MEASURE_POLISH_SCRIPT = '<script src="/assets/cart-fixed-measure-polish.js?v=3" defer></script>';
const HERO_LOGO_CENTER_STYLE = '<style id="heroLogoCenterStyle">.brand .logo{margin-left:auto;margin-right:auto}</style>';

export async function onRequest(context) {
  const assetResponse = await context.env.ASSETS.fetch(context.request);
  const contentType = assetResponse.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return assetResponse;

  let html = await assetResponse.text();
  let config = null;
  try {
    const loaded = await loadConfig(context.env);
    config = loaded && loaded.config || null;
  } catch (_) {}

  html = injectFixedProductsIntoSource(html, config);
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
  html = html.replace('</head>', `${HERO_LOGO_CENTER_STYLE}${MEDIA_PROTECTION_SCRIPT}${CACHE_BUST_SCRIPT}${CUSTOMER_CHECKOUT_SCRIPT}${SITE_TEXTS_SCRIPT}${CATALOG_NAV_UX_SCRIPT}${CART_FIXED_MEASURE_POLISH_SCRIPT}</head>`);

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

function injectFixedProductsIntoSource(html, config) {
  const products = config && config.products && typeof config.products === 'object' ? config.products : {};
  const romanRaw = products.painelRomano || products['painel-romano'] || {};
  const rectangularRaw = products.retangular1x2 || products['retangular-1x2'] || {};
  const roman = fixedProduct('Painel Romano 1x2', romanRaw, 78);
  const rectangular = fixedProduct('Painel Retangular', rectangularRaw, 78);

  let out = html.replace(
    'const PRODUCT_CONFIG={',
    `const PRODUCT_CONFIG={"painel-romano":${JSON.stringify(roman)},"retangular-1x2":${JSON.stringify(rectangular)},`
  );

  out = out.replace(
    'function itemActionButton(i){\n  const cfg=productConfig(i.product);\n  if(cfg.type==="bag")',
    'function itemActionButton(i){\n  const cfg=productConfig(i.product);\n  if(cfg.type==="fixedRectangle")return "";\n  if(cfg.type==="bag")'
  );

  out = out.replace(
    'function measureFields(item){\n  const cfg=productConfig(item.product);\n  ensureDetails(item);\n  if(cfg.type==="bag")return bagFields(item);',
    'function measureFields(item){\n  const cfg=productConfig(item.product);\n  ensureDetails(item);\n  if(cfg.type==="fixedRectangle")return `<div class="measureClosed fixedMeasureInline"><div class="measureSummary">Medida fixa: 1,00 × 2,00 m</div></div>`;\n  if(cfg.type==="bag")return bagFields(item);'
  );

  return out;
}

function fixedProduct(defaultLabel, raw, fallbackPrice) {
  const parsed = Number(String(raw && raw.unitPrice != null ? raw.unitPrice : '').replace(',', '.'));
  const unitPrice = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : fallbackPrice;
  const label = String(raw && raw.label || defaultLabel).replace(/\s+/g, ' ').trim() || defaultLabel;
  return {
    label,
    type:'fixedRectangle',
    unitPrice,
    baseQty:1,
    basePrice:unitPrice,
    afterStep:1,
    initialQuantity:1,
    checkoutEnabled:raw && raw.enabled === false ? false : true,
    fixedWidth:100,
    fixedHeight:200,
    fixedSize:'1X2',
    sizeKey:'100x200'
  };
}
