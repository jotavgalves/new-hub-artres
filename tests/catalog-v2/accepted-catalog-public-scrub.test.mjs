import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptedImageSource,
  tryAcceptedCatalogRequest
} from '../../functions/api/_accepted_catalog.js';

const env = {
  USE_AUTHENTICATED_CATALOG_V2: 'true',
  SUPABASE_V2_URL: 'https://example.supabase.co',
  SUPABASE_V2_SERVICE_ROLE_KEY: 'x'.repeat(64)
};
const commercial = {
  label: 'Painel 150 cm',
  unitPrice: 59.9,
  minimum: 1,
  step: 1,
  initial: 2,
  enabled: true
};

async function withFetch(handler, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = previous; }
}

test('remove metadados privados e aplica o preço administrativo atual', async () => {
  const payload = {
    ok: true,
    mode: 'items',
    items: [{
      id: 'public-item',
      sourceDriveFileId: 'private-target',
      shortcutTargetId: 'private-target',
      driveUrl: 'https://drive.google.com/private',
      sourceName: 'arquivo-privado.png',
      checksum: 'abc',
      thumbnailLink: 'https://private.example/thumb',
      image: '/api/catalog-image?id=public-item'
    }]
  };
  const result = await withFetch(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }), () => tryAcceptedCatalogRequest(env, {
    mode: 'items',
    productKey: 'painel-150',
    folderId: 'catalog-panel150-product:folder-123',
    commercial
  }));

  assert.equal(result.items.length, 1);
  for (const field of [
    'sourceDriveFileId', 'shortcutTargetId', 'driveUrl',
    'sourceName', 'checksum', 'thumbnailLink'
  ]) {
    assert.equal(Object.hasOwn(result.items[0], field), false, `${field} leaked`);
  }
  assert.equal(result.items[0].image, '/api/catalog-image?id=public-item');
  assert.equal(result.items[0].rootVerified, true);
  assert.equal(result.items[0].unitPrice, 59.9);
  assert.equal(result.items[0].price, 59.9);
  assert.equal(result.items[0].productName, 'Painel 150 cm');
  assert.equal(result.items[0].size, '150X150');
});

test('produto virtual recebe mínimo, incremento e quantidade inicial do admin', async () => {
  const payload = {
    ok: true,
    mode: 'products',
    folders: [{
      id: 'catalog-panel150-product:folder-123',
      kind: 'product',
      type: 'product',
      name: 'Painel 150 cm'
    }]
  };
  const result = await withFetch(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }), () => tryAcceptedCatalogRequest(env, {
    mode: 'products',
    productKey: 'painel-150',
    folderId: 'folder-123',
    commercial
  }));

  const product = result.folders[0];
  assert.equal(product.unitPrice, 59.9);
  assert.equal(product.price, 59.9);
  assert.equal(product.priceLabel, 'R$ 59,90 cada');
  assert.equal(product.minQty, 1);
  assert.equal(product.step, 1);
  assert.equal(product.initialQuantity, 2);
  assert.equal(product.checkoutEnabled, true);
});

test('resolvedor de imagem retorna apenas o ID aceito e metadados necessários', async () => {
  const payload = {
    ok: true,
    catalogVersion: 60,
    driveFileId: 'shortcut-public-id',
    mimeType: 'image/png',
    extension: 'png',
    modifiedTime: '2026-08-04T10:00:00.000Z',
    pdfPreview: false,
    productKey: 'painel-150',
    catalogRootDriveId: '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-',
    rootVerified: true,
    sourceDriveFileId: 'must-not-be-returned',
    checksum: 'must-not-be-returned'
  };
  const result = await withFetch(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }), () => acceptedImageSource(env, 'shortcut-public-id'));

  assert.equal(result.driveFileId, 'shortcut-public-id');
  assert.equal(Object.hasOwn(result, 'sourceDriveFileId'), false);
  assert.equal(Object.hasOwn(result, 'checksum'), false);
});
