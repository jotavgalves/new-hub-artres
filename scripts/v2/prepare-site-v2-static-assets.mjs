import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function prepareSiteV2StaticAssets(options = {}) {
  const sourceIndex = String(options.sourceIndex || 'index.html');
  const sourceAssets = String(options.sourceAssets || 'assets');
  const destination = String(options.destination || 'staging/site-v2-public');

  const indexStat = await stat(sourceIndex);
  const assetsStat = await stat(sourceAssets);
  if (!indexStat.isFile()) throw assetError('STAGING_INDEX_SOURCE_INVALID');
  if (!assetsStat.isDirectory()) throw assetError('STAGING_ASSETS_SOURCE_INVALID');

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(sourceIndex, `${destination}/index.html`);
  await cp(sourceAssets, `${destination}/assets`, { recursive: true });
  await writeFile(`${destination}/.assetsignore`, '.gitkeep\n', 'utf8');

  return Object.freeze({
    ok: true,
    destination,
    designSource: 'current-public-repository',
    transformed: false
  });
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
