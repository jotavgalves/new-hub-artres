import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BRIDGE_TAG = '<script src="./assets/v2-checkout-bridge.js" defer></script>';

export async function prepareSiteV2StaticAssets(options = {}) {
  const sourceIndex = String(options.sourceIndex || 'index.html');
  const sourceAssets = String(options.sourceAssets || 'assets');
  const sourceBridge = String(
    options.sourceBridge || 'staging/site-v2-worker/public/v2-checkout-bridge.js'
  );
  const destination = String(options.destination || 'staging/site-v2-public');

  const [indexStat, assetsStat, bridgeStat] = await Promise.all([
    stat(sourceIndex),
    stat(sourceAssets),
    stat(sourceBridge)
  ]);
  if (!indexStat.isFile()) throw assetError('STAGING_INDEX_SOURCE_INVALID');
  if (!assetsStat.isDirectory()) throw assetError('STAGING_ASSETS_SOURCE_INVALID');
  if (!bridgeStat.isFile()) throw assetError('STAGING_CHECKOUT_BRIDGE_SOURCE_INVALID');

  const sourceHtml = await readFile(sourceIndex, 'utf8');
  if (!sourceHtml.includes('</body>')) throw assetError('STAGING_INDEX_BODY_END_MISSING');
  if (sourceHtml.includes(BRIDGE_TAG) || sourceHtml.includes('v2-checkout-bridge.js')) {
    throw assetError('STAGING_CHECKOUT_BRIDGE_ALREADY_PRESENT');
  }
  const transformedHtml = sourceHtml.replace('</body>', `  ${BRIDGE_TAG}\n</body>`);
  if (countOccurrences(transformedHtml, BRIDGE_TAG) !== 1) {
    throw assetError('STAGING_CHECKOUT_BRIDGE_INJECTION_FAILED');
  }

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(sourceAssets, `${destination}/assets`, { recursive: true });
  await cp(sourceBridge, `${destination}/assets/v2-checkout-bridge.js`);
  await writeFile(`${destination}/index.html`, transformedHtml, 'utf8');
  await writeFile(`${destination}/.assetsignore`, '.gitkeep\n', 'utf8');

  return Object.freeze({
    ok: true,
    destination,
    designSource: 'current-public-repository',
    transformed: true,
    transformation: 'staging-only-checkout-bridge',
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
