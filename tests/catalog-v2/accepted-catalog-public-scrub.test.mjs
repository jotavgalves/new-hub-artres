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

async function withFetch(handler, callback) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await callback(); } finally { globalThis.fetch = previous; }
}

test('remove metadados privados das respostas públicas', async () => {
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
    folderId: 'catalog-panel150-product:folder-123'
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
