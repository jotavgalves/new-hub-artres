import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyArtwork,
  extractArtworkCode,
  scanPrivateDriveCatalog
} from '../../scripts/catalog-v2/private-drive-catalog-indexer.mjs';

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const PRIVATE_FIELDS = [
  'sourceDriveFileId',
  'shortcutTargetId',
  'driveUrl',
  'sourceName',
  'checksum',
  'thumbnailLink'
];

function file(id, name, mimeType, extra = {}) {
  return {
    id,
    name,
    mimeType,
    parents: [],
    trashed: false,
    modifiedTime: '2026-08-04T10:00:00.000Z',
    size: 123,
    md5Checksum: 'a'.repeat(32),
    thumbnailLink: extra.thumbnailLink || '',
    webViewLink: `https://drive.google.com/file/d/${id}/view`,
    shortcut: extra.shortcut || null,
    ...extra
  };
}

function fakeDrive() {
  const files = new Map([
    ['root-bolinhas', file('root-bolinhas', 'Bolinhas', FOLDER)],
    ['root-painel', file('root-painel', 'Painéis', FOLDER)],
    ['theme-festa', file('theme-festa', 'FESTA', FOLDER)],
    ['theme-empty', file('theme-empty', 'VAZIO', FOLDER)],
    ['theme-codex', file('theme-codex', 'CODEX TESTE INTERNO', FOLDER)],
    ['sub-festa', file('sub-festa', 'SUBTEMA', FOLDER)],
    ['art-jpg', file('art-jpg', '101_FESTA.jpg', 'image/jpeg')],
    ['art-tiff', file('art-tiff', '102_FESTA.tif', 'image/tiff')],
    ['art-psd', file('art-psd', '103_FESTA.psd', 'image/vnd.adobe.photoshop')],
    ['shortcut-art', file('shortcut-art', '104_ATALHO.png', SHORTCUT, {
      shortcut: { targetId: 'target-art', targetMimeType: 'image/png' }
    })],
    ['target-art', file('target-art', 'origem.png', 'image/png')],
    ['shortcut-folder', file('shortcut-folder', 'PASTA ATALHO', SHORTCUT, {
      shortcut: { targetId: 'target-folder', targetMimeType: FOLDER }
    })],
    ['target-folder', file('target-folder', 'Destino', FOLDER)],
    ['target-nested-art', file('target-nested-art', '105_DESTINO.webp', 'image/webp')],
    ['theme-ana', file('theme-ana', 'ANA CASTELA', FOLDER)],
    ['ana-art', file('ana-art', '201_ANA_CASTELA.png', 'image/png')]
  ]);
  const children = new Map([
    ['root-bolinhas', ['theme-festa', 'theme-empty', 'theme-codex']],
    ['theme-festa', ['art-jpg', 'sub-festa', 'shortcut-art', 'shortcut-folder']],
    ['sub-festa', ['art-tiff', 'art-psd']],
    ['theme-empty', []],
    ['theme-codex', []],
    ['target-folder', ['target-nested-art']],
    ['root-painel', ['theme-ana']],
    ['theme-ana', ['ana-art']]
  ]);
  return {
    async getFile(id) {
      const value = files.get(id);
      if (!value) throw new Error('NOT_FOUND');
      return value;
    },
    async listChildren(id) {
      return (children.get(id) || []).map(childId => files.get(childId));
    }
  };
}

const roots = [
  {
    rootDriveId: 'root-bolinhas', productKey: '50x50', productName: 'Bolinhas 50x50',
    sizeKey: '50X50', scope: 'bolinhas-drive-root', productCardPrefix: 'catalog-bolinhas-product:'
  },
  {
    rootDriveId: 'root-painel', productKey: 'painel-150', productName: 'Painel 150 cm',
    sizeKey: '150X150', scope: 'panel150-drive-root', productCardPrefix: 'catalog-panel150-product:'
  }
];

test('varre recursivamente, resolve atalhos e remove temas vazios', async () => {
  const result = await scanPrivateDriveCatalog({ drive: fakeDrive(), roots });
  const themeNames = result.folders.filter(row => row.depth === 1).map(row => row.name).sort();
  assert.deepEqual(themeNames, ['ANA CASTELA', 'FESTA']);
  assert.equal(result.items.length, 5);
  const shortcut = result.items.find(row => row.driveFileId === 'shortcut-art');
  assert.equal(shortcut?.payload.isShortcut, true);
  assert.ok(result.items.some(row => row.driveFileId === 'target-nested-art'));
  assert.ok(result.items.every(row => row.payload.image.startsWith('/api/catalog-image?id=')));
  assert.ok(result.items.every(row => row.payload.rootVerified === true));
  for (const row of [...result.folders, ...result.items]) {
    for (const field of PRIVATE_FIELDS) assert.equal(Object.hasOwn(row.payload, field), false, `${field} leaked`);
  }
  assert.ok(result.report.issueSummary.some(item => item.code === 'EMPTY_THEME_NOT_PUBLISHED'));
  assert.ok(result.report.issueSummary.some(item => item.code === 'DESIGN_SOURCE_NOT_PUBLICABLE'));
  assert.ok(result.report.issueSummary.some(item => item.code === 'INTERNAL_TEST_ENTRY_SKIPPED'));
  assert.equal(result.report.roots.find(root => root.productKey === 'painel-150').themesPublished, 1);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test('classifica formatos previstos e informa fontes não publicáveis', () => {
  assert.equal(classifyArtwork(file('a-file', 'a.jpg', 'image/jpeg')).accepted, true);
  assert.equal(classifyArtwork(file('b-file', 'b.tif', 'application/octet-stream')).accepted, true);
  assert.equal(classifyArtwork(file('c-file', 'c.pdf', 'application/pdf', { thumbnailLink: 'https://x.test/thumb' })).accepted, true);
  assert.equal(classifyArtwork(file('d-file', 'd.psd', 'image/vnd.adobe.photoshop')).reason, 'DESIGN_SOURCE_NOT_PUBLICABLE');
});

test('extrai código numérico e mantém fallback textual', () => {
  assert.deepEqual(extractArtworkCode('00123_TEMA.png'), { code: '123', sortId: 123, warning: '' });
  assert.equal(extractArtworkCode('ANA CASTELA FINAL.png').warning, 'NON_NUMERIC_ARTWORK_CODE');
});
