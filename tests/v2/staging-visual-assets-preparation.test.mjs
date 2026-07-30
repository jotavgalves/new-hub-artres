import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareSiteV2StaticAssets } from '../../scripts/v2/prepare-site-v2-static-assets.mjs';

async function fixture(html = '<!doctype html><html><body><main>Design atual</main></body></html>') {
  const root = await mkdtemp(join(tmpdir(), 'site-v2-assets-'));
  const sourceIndex = join(root, 'index.html');
  const sourceAssets = join(root, 'assets');
  const sourceContext = join(root, 'v2-checkout-context.js');
  const sourceBridge = join(root, 'v2-checkout-bridge.js');
  const destination = join(root, 'public');
  await mkdir(sourceAssets);
  await writeFile(sourceIndex, html, 'utf8');
  await writeFile(join(sourceAssets, 'logo.svg'), '<svg></svg>', 'utf8');
  await writeFile(sourceContext, "document.documentElement.dataset.v2CheckoutContext='context-marker';\n", 'utf8');
  await writeFile(sourceBridge, "document.documentElement.dataset.v2CheckoutBridge='bridge-marker';\n", 'utf8');
  return {
    root,
    sourceIndex,
    sourceAssets,
    sourceContext,
    sourceBridge,
    destination,
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

test('copia design e assets e injeta contexto antes do bridge somente no staging', async t => {
  const files = await fixture();
  t.after(files.cleanup);
  const original = await readFile(files.sourceIndex, 'utf8');

  const result = await prepareSiteV2StaticAssets(files);
  const staged = await readFile(join(files.destination, 'index.html'), 'utf8');
  const stagedContext = await readFile(join(files.destination, 'assets/v2-checkout-context.js'), 'utf8');
  const stagedBridge = await readFile(join(files.destination, 'assets/v2-checkout-bridge.js'), 'utf8');
  const sourceAfter = await readFile(files.sourceIndex, 'utf8');

  assert.deepEqual(result, {
    ok: true,
    destination: files.destination,
    designSource: 'current-public-repository',
    transformed: true,
    transformation: 'staging-only-checkout-bridge',
    checkoutContext: './assets/v2-checkout-context.js',
    checkoutBridge: './assets/v2-checkout-bridge.js'
  });
  assert.equal(sourceAfter, original);
  assert.equal((staged.match(/v2-checkout-context\.js/g) || []).length, 1);
  assert.equal((staged.match(/v2-checkout-bridge\.js/g) || []).length, 1);
  assert.ok(staged.includes('<script src="./assets/v2-checkout-context.js" defer></script>'));
  assert.ok(staged.includes('<script src="./assets/v2-checkout-bridge.js" defer></script>'));
  assert.ok(staged.indexOf('v2-checkout-context.js') < staged.indexOf('v2-checkout-bridge.js'));
  assert.ok(staged.indexOf('v2-checkout-bridge.js') < staged.indexOf('</body>'));
  assert.equal(stagedContext, "document.documentElement.dataset.v2CheckoutContext='context-marker';\n");
  assert.equal(stagedBridge, "document.documentElement.dataset.v2CheckoutBridge='bridge-marker';\n");
  assert.equal(await readFile(join(files.destination, 'assets/logo.svg'), 'utf8'), '<svg></svg>');
});

test('falha fechada sem body ou quando contexto ou bridge já existem na origem', async t => {
  const missingBody = await fixture('<html><main>sem body</main></html>');
  t.after(missingBody.cleanup);
  await assert.rejects(
    prepareSiteV2StaticAssets(missingBody),
    error => error.code === 'STAGING_INDEX_BODY_END_MISSING'
  );

  const duplicatedBridge = await fixture('<html><body><script src="./assets/v2-checkout-bridge.js"></script></body></html>');
  t.after(duplicatedBridge.cleanup);
  await assert.rejects(
    prepareSiteV2StaticAssets(duplicatedBridge),
    error => error.code === 'STAGING_CHECKOUT_BRIDGE_ALREADY_PRESENT'
  );

  const duplicatedContext = await fixture('<html><body><script src="./assets/v2-checkout-context.js"></script></body></html>');
  t.after(duplicatedContext.cleanup);
  await assert.rejects(
    prepareSiteV2StaticAssets(duplicatedContext),
    error => error.code === 'STAGING_CHECKOUT_BRIDGE_ALREADY_PRESENT'
  );
});
