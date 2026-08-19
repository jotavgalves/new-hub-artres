import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequestPost, reconcileCartItems } from '../../functions/api/reconcile-cart.js';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const BOLINHAS_ROOT = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';

function contextFor(items) {
  return {
    request: new Request('https://example.test/api/reconcile-cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    }),
    env: catalogEnv()
  };
}

function catalogEnv() {
  return {
    ARTS_SUPABASE_URL: 'https://catalog.example.test',
    ARTS_SUPABASE_SERVICE_KEY: 'test-service-key'
  };
}

function artwork(driveId, code) {
  return {
    drive_id: driveId,
    root_drive_id: BOLINHAS_ROOT,
    type: 'artwork',
    name: `${code}_FESTA.jpg`,
    code,
    theme: 'FESTA',
    thumbnail_url: ''
  };
}

function installCatalogMock() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    const driveFilter = url.searchParams.get('drive_id') || '';
    const codeFilter = url.searchParams.get('code') || '';
    if (driveFilter.includes('drive-valid')) {
      return new Response(JSON.stringify([artwork('drive-valid', '100')]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (codeFilter === 'eq.999') {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return () => { globalThis.fetch = originalFetch; };
}

const staleCart = () => [
  { driveFileId: 'drive-valid', productKey: '50x50', quantity: 2, code: '100', theme: 'FESTA' },
  { driveFileId: 'drive-missing', productKey: '50x50', quantity: 2, code: '999', theme: 'FESTA' }
];

test('uma arte ausente é removida e as demais seguem para o checkout', async () => {
  const restoreFetch = installCatalogMock();
  try {
    const response = await onRequestPost(contextFor(staleCart()));
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].driveFileId, 'drive-valid');
    assert.equal(data.removed.length, 1);
    assert.equal(data.removed[0].driveFileId, 'drive-missing');
    assert.equal(data.removed[0].code, '999');
    assert.equal(data.changed, true);
  } finally {
    restoreFetch();
  }
});

test('a mesma reconciliação pode ser executada dentro do endpoint de pedidos', async () => {
  const restoreFetch = installCatalogMock();
  try {
    const data = await reconcileCartItems(catalogEnv(), staleCart());
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].driveFileId, 'drive-valid');
    assert.equal(data.removed.length, 1);
    assert.equal(data.removed[0].driveFileId, 'drive-missing');
    assert.equal(data.changed, true);
  } finally {
    restoreFetch();
  }
});

test('reconciliação não depende mais apenas do navegador', async () => {
  const server = await read('functions/api/reconcile-cart.js');
  const orders = await read('functions/api/orders-v2.js');
  const client = await read('assets/cart-reconcile-v1.js');
  const loader = await read('assets/catalog-cache-bust.js');
  const middleware = await read('functions/[[path]].js');
  const serviceWorker = await read('service-worker.js');

  assert.match(server, /export async function reconcileCartItems/);
  assert.match(server, /removed\.push\(safeMissing\(item\)\)/);
  assert.match(server, /items: resolved/);

  assert.match(orders, /import \{ reconcileCartItems \} from '\.\/reconcile-cart\.js'/);
  assert.match(orders, /reconcileCartItems\(context\.env, rawItems\)/);
  assert.match(orders, /cartRepair/);
  assert.doesNotMatch(orders, /if \(!row\) return json\(\{ ok: false, error: 'ARTE_NAO_ENCONTRADA'/);

  assert.match(client, /sendOrderAndRepair/);
  assert.match(client, /response\.clone\(\)\.json\(\)/);
  assert.match(client, /repairLocalCart\(repair\.migrations,repair\.removed\)/);
  assert.match(client, /cart\.splice\(index,1\)/);

  assert.match(loader, /cart-reconcile-v1\.js\?v=20260819-1/);
  assert.match(middleware, /catalog-cache-bust\.js\?v=10/);
  assert.match(serviceWorker, /armazem-pwa-v2/);
  assert.match(serviceWorker, /CRITICAL_ASSETS/);
  assert.match(serviceWorker, /networkFirstAsset/);
});
