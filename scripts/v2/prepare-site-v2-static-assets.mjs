import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const CONTEXT_TAG = '<script src="./assets/v2-checkout-context.js" defer></script>';
const WHATSAPP_TAG = '<script src="./assets/v2-checkout-whatsapp.js" defer></script>';
const BRIDGE_TAG = '<script src="./assets/v2-checkout-bridge.js" defer></script>';

export async function prepareSiteV2StaticAssets(options = {}) {
  const sourceIndex = String(options.sourceIndex || 'index.html');
  const sourceAssets = String(options.sourceAssets || 'assets');
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

  const [indexStat, assetsStat, contextStat, whatsappStat, bridgeStat] = await Promise.all([
    stat(sourceIndex),
    stat(sourceAssets),
    stat(sourceContext),
    stat(sourceWhatsapp),
    stat(sourceBridge)
  ]);
  if (!indexStat.isFile()) throw assetError('STAGING_INDEX_SOURCE_INVALID');
  if (!assetsStat.isDirectory()) throw assetError('STAGING_ASSETS_SOURCE_INVALID');
  if (!contextStat.isFile()) throw assetError('STAGING_CHECKOUT_CONTEXT_SOURCE_INVALID');
  if (!whatsappStat.isFile()) throw assetError('STAGING_CHECKOUT_WHATSAPP_SOURCE_INVALID');
  if (!bridgeStat.isFile()) throw assetError('STAGING_CHECKOUT_BRIDGE_SOURCE_INVALID');

  const sourceHtml = await readFile(sourceIndex, 'utf8');
  if (!sourceHtml.includes('</body>')) throw assetError('STAGING_INDEX_BODY_END_MISSING');
  if (
    sourceHtml.includes(CONTEXT_TAG) ||
    sourceHtml.includes(WHATSAPP_TAG) ||
    sourceHtml.includes(BRIDGE_TAG) ||
    sourceHtml.includes('v2-checkout-context.js') ||
    sourceHtml.includes('v2-checkout-whatsapp.js') ||
    sourceHtml.includes('v2-checkout-bridge.js')
  ) {
    throw assetError('STAGING_CHECKOUT_BRIDGE_ALREADY_PRESENT');
  }

  const checkoutTags = `  ${CONTEXT_TAG}\n  ${WHATSAPP_TAG}\n  ${BRIDGE_TAG}`;
  const transformedHtml = sourceHtml.replace('</body>', `${checkoutTags}\n</body>`);
  if (
    countOccurrences(transformedHtml, CONTEXT_TAG) !== 1 ||
    countOccurrences(transformedHtml, WHATSAPP_TAG) !== 1 ||
    countOccurrences(transformedHtml, BRIDGE_TAG) !== 1 ||
    transformedHtml.indexOf(CONTEXT_TAG) > transformedHtml.indexOf(WHATSAPP_TAG) ||
    transformedHtml.indexOf(WHATSAPP_TAG) > transformedHtml.indexOf(BRIDGE_TAG)
  ) {
    throw assetError('STAGING_CHECKOUT_BRIDGE_INJECTION_FAILED');
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(sourceAssets, `${destination}/assets`, { recursive: true });
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
    transformation: 'staging-only-checkout-bridge',
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
