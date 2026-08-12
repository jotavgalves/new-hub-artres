import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequestPost } from '../../functions/api/reconcile-cart.js';

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
    env: {
      ARTS_SUPABASE_URL: 'https://catalog.example.test',
      ARTS_SUPABASE_SERVICE_KEY: 'test-service-key'
    }
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

test('uma arte ausente é removida e as demais seguem para o checkout', async () => {
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

  try {
    const response = await onRequestPost(contextFor([
      { driveFileId: 'drive-valid', productKey: '50x50', quantity: 2, code: '100', theme: 'FESTA' },
      { driveFileId: 'drive-missing', productKey: '50x50', quantity: 2, code: '999', theme: 'FESTA' }
    ]));
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
    globalThis.fetch = originalFetch;
  }
});

test('reconciliação não bloqueia o lote inteiro com ARTE_NAO_ENCONTRADA', async () => {
  const server = await read('functions/api/reconcile-cart.js');
  const client = await read('assets/cart-reconcile-v1.js');
  const loader = await read('assets/catalog-cache-bust.js');

  assert.doesNotMatch(server, /return json\(\{ ok: false, error: 'ARTE_NAO_ENCONTRADA'/);
  assert.match(server, /removed\.push\(safeMissing\(item\)\)/);
  assert.match(server, /items: resolved/);
  assert.match(server, /removed,/);

  assert.match(client, /repairLocalCart\(reconcile\.migrations,reconcile\.removed\)/);
  assert.match(client, /cart\.splice\(index,1\)/);
  assert.match(client, /removedIds\.has\(oldId\)/);
  assert.match(client, /repairLocalCart\(reconcile\.migrations,reconcile\.removed\);\s*return originalFetch/);

  assert.match(loader, /cart-reconcile-v1\.js\?v=20260812-1/);
});
