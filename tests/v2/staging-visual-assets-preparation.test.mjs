import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareSiteV2StaticAssets } from '../../scripts/v2/prepare-site-v2-static-assets.mjs';

const BASE_HTML = `<!doctype html><html><body><main>Design atual</main><script>
const $=id=>document.getElementById(id);
function restore(){}
function renderCart(){}
function loadThemes(){}
function cartQty(){return 0}
function toast(){}
function api(){}
restore();renderCart();loadThemes();
</script></body></html>`;

async function fixture(html = BASE_HTML) {
  const root = await mkdtemp(join(tmpdir(), 'site-v2-assets-'));
  const sourceIndex = join(root, 'index.html');
  const sourceAssets = join(root, 'assets');
  const sourceWorkspaces = join(root, 'v2-product-workspaces.js');
  const sourceContext = join(root, 'v2-checkout-context.js');
  const sourceWhatsapp = join(root, 'v2-checkout-whatsapp.js');
  const sourceBridge = join(root, 'v2-checkout-bridge.js');
  const destination = join(root, 'public');
  await mkdir(sourceAssets);
  await writeFile(sourceIndex, html, 'utf8');
  await writeFile(join(sourceAssets, 'logo.svg'), '<svg></svg>', 'utf8');
  await writeFile(sourceWorkspaces, "document.documentElement.dataset.v2ProductWorkspaces='workspace-marker';\n", 'utf8');
  await writeFile(sourceContext, "document.documentElement.dataset.v2CheckoutContext='context-marker';\n", 'utf8');
  await writeFile(sourceWhatsapp, "document.documentElement.dataset.v2CheckoutWhatsapp='whatsapp-marker';\n", 'utf8');
  await writeFile(sourceBridge, "document.documentElement.dataset.v2CheckoutBridge='bridge-marker';\n", 'utf8');
  return {
    root,
    sourceIndex,
    sourceAssets,
    sourceWorkspaces,
    sourceContext,
    sourceWhatsapp,
    sourceBridge,
    destination,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

test('injeta seletor de produtos antes do catálogo e mantém checkout no fim somente no staging', async t => {
  const files = await fixture();
  t.after(files.cleanup);
  const original = await readFile(files.sourceIndex, 'utf8');

  const result = await prepareSiteV2StaticAssets(files);
  const staged = await readFile(join(files.destination, 'index.html'), 'utf8');
  const stagedWorkspaces = await readFile(join(files.destination, 'assets/v2-product-workspaces.js'), 'utf8');
  const stagedContext = await readFile(join(files.destination, 'assets/v2-checkout-context.js'), 'utf8');
  const stagedWhatsapp = await readFile(join(files.destination, 'assets/v2-checkout-whatsapp.js'), 'utf8');
  const stagedBridge = await readFile(join(files.destination, 'assets/v2-checkout-bridge.js'), 'utf8');
  const sourceAfter = await readFile(files.sourceIndex, 'utf8');

  assert.deepEqual(result, {
    ok: true,
    destination: files.destination,
    designSource: 'current-public-repository',
    transformed: true,
    transformation: 'staging-only-product-workspaces-and-checkout-bridge',
    productWorkspaces: './assets/v2-product-workspaces.js',
    checkoutContext: './assets/v2-checkout-context.js',
    checkoutWhatsapp: './assets/v2-checkout-whatsapp.js',
    checkoutBridge: './assets/v2-checkout-bridge.js'
  });
  assert.equal(sourceAfter, original);
  assert.equal((staged.match(/v2-product-workspaces\.js/g) || []).length, 1);
  assert.equal((staged.match(/v2-checkout-context\.js/g) || []).length, 1);
  assert.equal((staged.match(/v2-checkout-whatsapp\.js/g) || []).length, 1);
  assert.equal((staged.match(/v2-checkout-bridge\.js/g) || []).length, 1);
  assert.ok(staged.includes('<script src="./assets/v2-product-workspaces.js"></script>'));
  assert.ok(staged.includes('<script src="./assets/v2-checkout-context.js" defer></script>'));
  assert.ok(staged.includes('<script src="./assets/v2-checkout-whatsapp.js" defer></script>'));
  assert.ok(staged.includes('<script src="./assets/v2-checkout-bridge.js" defer></script>'));
  assert.equal(staged.includes('restore();renderCart();loadThemes();'), false);
  assert.match(staged, /SiteV2ProductWorkspaces\.start\(\{/);
  assert.ok(staged.indexOf('v2-product-workspaces.js') < staged.indexOf('const $=id=>document.getElementById'));
  assert.ok(staged.indexOf('SiteV2ProductWorkspaces.start') < staged.indexOf('v2-checkout-context.js'));
  assert.ok(staged.indexOf('v2-checkout-context.js') < staged.indexOf('v2-checkout-whatsapp.js'));
  assert.ok(staged.indexOf('v2-checkout-whatsapp.js') < staged.indexOf('v2-checkout-bridge.js'));
  assert.ok(staged.indexOf('v2-checkout-bridge.js') < staged.indexOf('</body>'));
  assert.equal(stagedWorkspaces, "document.documentElement.dataset.v2ProductWorkspaces='workspace-marker';\n");
  assert.equal(stagedContext, "document.documentElement.dataset.v2CheckoutContext='context-marker';\n");
  assert.equal(stagedWhatsapp, "document.documentElement.dataset.v2CheckoutWhatsapp='whatsapp-marker';\n");
  assert.equal(stagedBridge, "document.documentElement.dataset.v2CheckoutBridge='bridge-marker';\n");
  assert.equal(await readFile(join(files.destination, 'assets/logo.svg'), 'utf8'), '<svg></svg>');
});

test('falha fechada quando faltam os pontos seguros de transformação', async t => {
  const missingBody = await fixture(BASE_HTML.replace('</body>', ''));
  t.after(missingBody.cleanup);
  await assert.rejects(
    prepareSiteV2StaticAssets(missingBody),
    error => error.code === 'STAGING_INDEX_BODY_END_MISSING'
  );

  const missingMain = await fixture('<html><body><script>restore();renderCart();loadThemes();</script></body></html>');
  t.after(missingMain.cleanup);
  await assert.rejects(
    prepareSiteV2StaticAssets(missingMain),
    error => error.code === 'STAGING_MAIN_SCRIPT_START_MISSING'
  );

  const missingStartup = await fixture(BASE_HTML.replace('restore();renderCart();loadThemes();', 'restore();renderCart();'));
  t.after(missingStartup.cleanup);
  await assert.rejects(
    prepareSiteV2StaticAssets(missingStartup),
    error => error.code === 'STAGING_LEGACY_STARTUP_INVALID'
  );
});

test('falha fechada quando qualquer asset V2 já existe na origem', async t => {
  for (const asset of [
    'v2-product-workspaces.js',
    'v2-checkout-context.js',
    'v2-checkout-whatsapp.js',
    'v2-checkout-bridge.js'
  ]) {
    const files = await fixture(BASE_HTML.replace('</body>', `<script src="./assets/${asset}"></script></body>`));
    t.after(files.cleanup);
    await assert.rejects(
      prepareSiteV2StaticAssets(files),
      error => error.code === 'STAGING_V2_ASSET_ALREADY_PRESENT'
    );
  }
});
