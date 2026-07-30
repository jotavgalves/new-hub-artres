import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const COMMERCIAL_TAG = '<script src="./assets/v2-commercial-config.js"></script>';
const WORKSPACES_TAG = '<script src="./assets/v2-product-workspaces.js"></script>';
const CONTEXT_TAG = '<script src="./assets/v2-checkout-context.js" defer></script>';
const WHATSAPP_TAG = '<script src="./assets/v2-checkout-whatsapp.js" defer></script>';
const BRIDGE_TAG = '<script src="./assets/v2-checkout-bridge.js" defer></script>';
const MAIN_SCRIPT_START = '<script>\nconst $=id=>document.getElementById(id);';
const LEGACY_STARTUP = 'restore();renderCart();loadThemes();';
const V2_STARTUP = `restore();
renderCart();
(async()=>{
  if (!globalThis.SiteV2CommercialConfig) throw new Error("V2_COMMERCIAL_CONFIG_MISSING");
  if (!globalThis.SiteV2ProductWorkspaces) throw new Error("V2_PRODUCT_WORKSPACES_MISSING");
  await SiteV2CommercialConfig.start({
    getProductConfig:()=>productConfig,
    setProductConfig:next=>{productConfig=next},
    getPrice:()=>price,
    setPrice:next=>{price=next},
    setDiscount:next=>{discount=next},
    getGross:()=>gross(),
    getRule50:()=>rule50,
    setRule50:next=>{rule50=next},
    getCartRule:()=>cartRule,
    setCartRule:next=>{cartRule=next},
    getRenderCart:()=>renderCart,
    setRenderCart:next=>{renderCart=next},
    renderCart,
    getCartItems:()=>cart,
    notify:toast
  });
  SiteV2ProductWorkspaces.start({
    getApi:()=>api,
    setApi:next=>{api=next},
    loadThemes,
    getShowProducts:()=>showProducts,
    setShowProducts:next=>{showProducts=next},
    filterProducts:productKey=>{products=(products||[]).filter(item=>item.kind==="folder"||item.product===productKey||item.productKey===productKey)},
    getFilteredItems:()=>filteredItems,
    setFilteredItems:next=>{filteredItems=next},
    getLocateItem:()=>locateItem,
    setLocateItem:next=>{locateItem=next},
    getCartItemProduct:id=>entry(id)?.product,
    getCartQuantity:cartQty,
    clearNavigation:()=>{const input=$("search");if(input)input.value=""},
    notify:toast
  });
})().catch(()=>{
  const content=$("content");
  if(content)content.innerHTML='<div class="empty"><div><b>Não foi possível carregar preços e produtos</b><span>Atualize a página ou tente novamente em alguns instantes.</span></div></div>';
  toast("Não foi possível carregar a configuração comercial.");
});`;

export async function prepareSiteV2StaticAssets(options = {}) {
  const sourceIndex = String(options.sourceIndex || 'index.html');
  const sourceAssets = String(options.sourceAssets || 'assets');
  const sourceCommercial = String(
    options.sourceCommercial || 'staging/site-v2-worker/public/v2-commercial-config.js'
  );
  const sourceWorkspaces = String(
    options.sourceWorkspaces || 'staging/site-v2-worker/public/v2-product-workspaces.js'
  );
  const sourceContext = String(
    options.sourceContext || 'staging/site-v2-worker/public/v2-checkout-context.js'
  );
  const sourceWhatsapp = String(
    options.sourceWhatsapp || 'staging/site-v2-worker/public/v2-checkout-whatsapp.js'
  );
  const sourceBridge = String(
    options.sourceBridge || 'staging/site-v2-worker/public/v2-checkout-bridge.js'
  );
  const destination = String(options.destination || 'staging/site-v2-public');

  const [indexStat, assetsStat, commercialStat, workspacesStat, contextStat, whatsappStat, bridgeStat] = await Promise.all([
    stat(sourceIndex),
    stat(sourceAssets),
    stat(sourceCommercial),
    stat(sourceWorkspaces),
    stat(sourceContext),
    stat(sourceWhatsapp),
    stat(sourceBridge)
  ]);
  if (!indexStat.isFile()) throw assetError('STAGING_INDEX_SOURCE_INVALID');
  if (!assetsStat.isDirectory()) throw assetError('STAGING_ASSETS_SOURCE_INVALID');
  if (!commercialStat.isFile()) throw assetError('STAGING_COMMERCIAL_CONFIG_SOURCE_INVALID');
  if (!workspacesStat.isFile()) throw assetError('STAGING_PRODUCT_WORKSPACES_SOURCE_INVALID');
  if (!contextStat.isFile()) throw assetError('STAGING_CHECKOUT_CONTEXT_SOURCE_INVALID');
  if (!whatsappStat.isFile()) throw assetError('STAGING_CHECKOUT_WHATSAPP_SOURCE_INVALID');
  if (!bridgeStat.isFile()) throw assetError('STAGING_CHECKOUT_BRIDGE_SOURCE_INVALID');

  const sourceHtml = await readFile(sourceIndex, 'utf8');
  if (!sourceHtml.includes('</body>')) throw assetError('STAGING_INDEX_BODY_END_MISSING');
  if (!sourceHtml.includes(MAIN_SCRIPT_START)) throw assetError('STAGING_MAIN_SCRIPT_START_MISSING');
  if (countOccurrences(sourceHtml, LEGACY_STARTUP) !== 1) {
    throw assetError('STAGING_LEGACY_STARTUP_INVALID');
  }
  if (
    sourceHtml.includes(COMMERCIAL_TAG) ||
    sourceHtml.includes(WORKSPACES_TAG) ||
    sourceHtml.includes(CONTEXT_TAG) ||
    sourceHtml.includes(WHATSAPP_TAG) ||
    sourceHtml.includes(BRIDGE_TAG) ||
    sourceHtml.includes('v2-commercial-config.js') ||
    sourceHtml.includes('v2-product-workspaces.js') ||
    sourceHtml.includes('v2-checkout-context.js') ||
    sourceHtml.includes('v2-checkout-whatsapp.js') ||
    sourceHtml.includes('v2-checkout-bridge.js')
  ) {
    throw assetError('STAGING_V2_ASSET_ALREADY_PRESENT');
  }

  const withSynchronousAssets = sourceHtml.replace(
    MAIN_SCRIPT_START,
    `${COMMERCIAL_TAG}\n${WORKSPACES_TAG}\n${MAIN_SCRIPT_START}`
  );
  const withV2Startup = withSynchronousAssets.replace(LEGACY_STARTUP, V2_STARTUP);
  const checkoutTags = `  ${CONTEXT_TAG}\n  ${WHATSAPP_TAG}\n  ${BRIDGE_TAG}`;
  const transformedHtml = withV2Startup.replace('</body>', `${checkoutTags}\n</body>`);

  if (
    countOccurrences(transformedHtml, COMMERCIAL_TAG) !== 1 ||
    countOccurrences(transformedHtml, WORKSPACES_TAG) !== 1 ||
    countOccurrences(transformedHtml, CONTEXT_TAG) !== 1 ||
    countOccurrences(transformedHtml, WHATSAPP_TAG) !== 1 ||
    countOccurrences(transformedHtml, BRIDGE_TAG) !== 1 ||
    countOccurrences(transformedHtml, V2_STARTUP) !== 1 ||
    transformedHtml.includes(LEGACY_STARTUP) ||
    transformedHtml.indexOf(COMMERCIAL_TAG) > transformedHtml.indexOf(WORKSPACES_TAG) ||
    transformedHtml.indexOf(WORKSPACES_TAG) > transformedHtml.indexOf(MAIN_SCRIPT_START) ||
    transformedHtml.indexOf(CONTEXT_TAG) > transformedHtml.indexOf(WHATSAPP_TAG) ||
    transformedHtml.indexOf(WHATSAPP_TAG) > transformedHtml.indexOf(BRIDGE_TAG)
  ) {
    throw assetError('STAGING_V2_ASSET_INJECTION_FAILED');
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(sourceAssets, `${destination}/assets`, { recursive: true });
  await cp(sourceCommercial, `${destination}/assets/v2-commercial-config.js`);
  await cp(sourceWorkspaces, `${destination}/assets/v2-product-workspaces.js`);
  await cp(sourceContext, `${destination}/assets/v2-checkout-context.js`);
  await cp(sourceWhatsapp, `${destination}/assets/v2-checkout-whatsapp.js`);
  await cp(sourceBridge, `${destination}/assets/v2-checkout-bridge.js`);
  await writeFile(`${destination}/index.html`, transformedHtml, 'utf8');
  await writeFile(`${destination}/.assetsignore`, '.gitkeep\n', 'utf8');

  return Object.freeze({
    ok: true,
    destination,
    designSource: 'current-public-repository',
    transformed: true,
    transformation: 'staging-only-commercial-config-product-workspaces-and-checkout-bridge',
    commercialConfig: './assets/v2-commercial-config.js',
    productWorkspaces: './assets/v2-product-workspaces.js',
    checkoutContext: './assets/v2-checkout-context.js',
    checkoutWhatsapp: './assets/v2-checkout-whatsapp.js',
    checkoutBridge: './assets/v2-checkout-bridge.js'
  });
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function assetError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  const result = await prepareSiteV2StaticAssets();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    console.error(String(error?.code || 'STAGING_ASSET_PREPARATION_FAILED'));
    process.exitCode = 1;
  });
}
