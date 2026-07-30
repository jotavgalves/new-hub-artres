import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const WORKSPACES_TAG = '<script src="./assets/v2-product-workspaces.js"></script>';
const CONTEXT_TAG = '<script src="./assets/v2-checkout-context.js" defer></script>';
const WHATSAPP_TAG = '<script src="./assets/v2-checkout-whatsapp.js" defer></script>';
const BRIDGE_TAG = '<script src="./assets/v2-checkout-bridge.js" defer></script>';
const MAIN_SCRIPT_START = '<script>\nconst $=id=>document.getElementById(id);';
const LEGACY_STARTUP = 'restore();renderCart();loadThemes();';
const WORKSPACE_STARTUP = `restore();
renderCart();
if (!globalThis.SiteV2ProductWorkspaces) throw new Error("V2_PRODUCT_WORKSPACES_MISSING");
SiteV2ProductWorkspaces.start({
  getApi:()=>api,
  setApi:next=>{api=next},
  loadThemes,
  renderCart,
  getCartQuantity:cartQty,
  clearNavigation:()=>{const input=$("search");if(input)input.value=""},
  notify:toast
});`;

export async function prepareSiteV2StaticAssets(options = {}) {
  const sourceIndex = String(options.sourceIndex || 'index.html');
  const sourceAssets = String(options.sourceAssets || 'assets');
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

  const [indexStat, assetsStat, workspacesStat, contextStat, whatsappStat, bridgeStat] = await Promise.all([
    stat(sourceIndex),
    stat(sourceAssets),
    stat(sourceWorkspaces),
    stat(sourceContext),
    stat(sourceWhatsapp),
    stat(sourceBridge)
  ]);
  if (!indexStat.isFile()) throw assetError('STAGING_INDEX_SOURCE_INVALID');
  if (!assetsStat.isDirectory()) throw assetError('STAGING_ASSETS_SOURCE_INVALID');
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
    sourceHtml.includes(WORKSPACES_TAG) ||
    sourceHtml.includes(CONTEXT_TAG) ||
    sourceHtml.includes(WHATSAPP_TAG) ||
    sourceHtml.includes(BRIDGE_TAG) ||
    sourceHtml.includes('v2-product-workspaces.js') ||
    sourceHtml.includes('v2-checkout-context.js') ||
    sourceHtml.includes('v2-checkout-whatsapp.js') ||
    sourceHtml.includes('v2-checkout-bridge.js')
  ) {
    throw assetError('STAGING_V2_ASSET_ALREADY_PRESENT');
  }

  const withWorkspaceAsset = sourceHtml.replace(
    MAIN_SCRIPT_START,
    `${WORKSPACES_TAG}\n${MAIN_SCRIPT_START}`
  );
  const withWorkspaceStartup = withWorkspaceAsset.replace(LEGACY_STARTUP, WORKSPACE_STARTUP);
  const checkoutTags = `  ${CONTEXT_TAG}\n  ${WHATSAPP_TAG}\n  ${BRIDGE_TAG}`;
  const transformedHtml = withWorkspaceStartup.replace('</body>', `${checkoutTags}\n</body>`);

  if (
    countOccurrences(transformedHtml, WORKSPACES_TAG) !== 1 ||
    countOccurrences(transformedHtml, CONTEXT_TAG) !== 1 ||
    countOccurrences(transformedHtml, WHATSAPP_TAG) !== 1 ||
    countOccurrences(transformedHtml, BRIDGE_TAG) !== 1 ||
    countOccurrences(transformedHtml, WORKSPACE_STARTUP) !== 1 ||
    transformedHtml.includes(LEGACY_STARTUP) ||
    transformedHtml.indexOf(WORKSPACES_TAG) > transformedHtml.indexOf(MAIN_SCRIPT_START) ||
    transformedHtml.indexOf(CONTEXT_TAG) > transformedHtml.indexOf(WHATSAPP_TAG) ||
    transformedHtml.indexOf(WHATSAPP_TAG) > transformedHtml.indexOf(BRIDGE_TAG)
  ) {
    throw assetError('STAGING_V2_ASSET_INJECTION_FAILED');
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(sourceAssets, `${destination}/assets`, { recursive: true });
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
    transformation: 'staging-only-product-workspaces-and-checkout-bridge',
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
