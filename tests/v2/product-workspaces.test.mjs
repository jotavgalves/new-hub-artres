import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const workspaces = require('../../staging/site-v2-worker/public/v2-product-workspaces.js');

test('define somente os dois espaços de produto aprovados para o lançamento', () => {
  assert.deepEqual(Object.keys(workspaces.WORKSPACES), ['bolinhas', 'painel-150']);
  assert.equal(workspaces.WORKSPACES.bolinhas.productKey, '50x50');
  assert.equal(workspaces.WORKSPACES['painel-150'].productKey, 'painel-150');
  assert.equal(workspaces.resolveWorkspace('50x50').id, 'bolinhas');
  assert.equal(workspaces.resolveWorkspace('painel').id, 'painel-150');
  assert.equal(workspaces.resolveWorkspace('produto-inexistente'), null);
});

test('aplica o produto ativo em todas as leituras do catálogo sem alterar o objeto original', () => {
  const original = Object.freeze({ mode: 'items', folderId: 'folder-1', product: 'nome-antigo' });
  const bolinhas = workspaces.scopeCatalogParams(original, 'bolinhas');
  const painel = workspaces.scopeCatalogParams(original, 'painel-150');

  assert.deepEqual(original, { mode: 'items', folderId: 'folder-1', product: 'nome-antigo' });
  assert.deepEqual(bolinhas, { mode: 'items', folderId: 'folder-1', product: '50x50' });
  assert.deepEqual(painel, { mode: 'items', folderId: 'folder-1', product: 'painel-150' });
  assert.equal(workspaces.scopeCatalogParams({ mode: 'health' }, 'bolinhas').product, undefined);
});

test('reconhece itens do catálogo e do carrinho pelo produto correto', () => {
  assert.equal(workspaces.productMatches({ product: '50x50' }, '50x50'), true);
  assert.equal(workspaces.productMatches({ productKey: 'painel-150' }, 'painel-150'), true);
  assert.equal(workspaces.productMatches({ product: 'painel-150' }, '50x50'), false);
  assert.equal(workspaces.workspaceForProduct('50x50').id, 'bolinhas');
  assert.equal(workspaces.workspaceForProduct('painel-150').id, 'painel-150');
});

test('parâmetro da URL prevalece sobre a seleção anterior da sessão', () => {
  assert.equal(workspaces.resolveInitialWorkspace({
    search: '?produto=painel-150',
    sessionValue: 'bolinhas'
  }).id, 'painel-150');
  assert.equal(workspaces.resolveInitialWorkspace({
    search: '?ana=&product=50x50',
    sessionValue: ''
  }).id, 'bolinhas');
  assert.equal(workspaces.resolveInitialWorkspace({
    search: '',
    sessionValue: 'painel'
  }).id, 'painel-150');
});

test('módulo não limpa nem substitui o armazenamento do carrinho compartilhado', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-product-workspaces.js', 'utf8');

  assert.match(source, /Mesmo carrinho para os dois produtos/);
  assert.match(source, /getCartQuantity/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /LEGACY_PLACE_KEY/);
  assert.doesNotMatch(source, /armazemHubCartV2/);
  assert.doesNotMatch(source, /localStorage\?\.clear|localStorage\.clear/);
  assert.doesNotMatch(source, /removeItem\([^)]*(cart|STORAGE)/i);
});

test('módulo contém escolha inicial, abas acessíveis e transição sem recarregar a página', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-product-workspaces.js', 'utf8');

  assert.match(source, /role=\"dialog\" aria-modal=\"true\"/);
  assert.match(source, /role=\"tablist\"/);
  assert.match(source, /aria-selected/);
  assert.match(source, /loadThemes/);
  assert.match(source, /scrollIntoView/);
  assert.doesNotMatch(source, /location\.reload|location\.assign|location\.replace/);
});

test('módulo filtra fallback visual e troca de aba antes de localizar item do outro produto', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-product-workspaces.js', 'utf8');
  const preparation = await readFile('scripts/v2/prepare-site-v2-static-assets.mjs', 'utf8');

  assert.match(source, /wrapProductRenderer/);
  assert.match(source, /wrapItemFilter/);
  assert.match(source, /wrapCartLocator/);
  assert.match(source, /activate\(target\.id, \{ reload: false/);
  assert.match(preparation, /filterProducts:productKey/);
  assert.match(preparation, /getCartItemProduct:id=>entry\(id\)\?\.product/);
  assert.match(preparation, /setLocateItem:next=>\{locateItem=next\}/);
});
