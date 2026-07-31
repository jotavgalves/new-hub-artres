import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

const BOLINHAS_ROOT = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';
const PANEL_ROOT = '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-';

test('frontend produtivo compila e ativa os dois produtos no site oficial', async () => {
  const source = await read('assets/production-v2.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /\/api\/catalog-v2/);
  assert.match(source, /\/api\/commercial-config/);
  assert.match(source, /\/api\/orders-v2/);
  assert.match(source, /'50x50'/);
  assert.match(source, /'painel-150'/);
  assert.match(source, /Painel 150 cm/);
  assert.doesNotMatch(source, /synthetic|staging-only|jvgacontato\.workers\.dev/i);
});

test('carregador público injeta a promoção somente após o site iniciar', async () => {
  const source = await read('assets/catalog-cache-bust.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /window\.addEventListener\('load', loadProductionV2/);
  assert.match(source, /\/assets\/production-v2\.js/);
  assert.match(source, /\/assets\/production-v2-compat\.js/);
  assert.match(source, /catalog-index-v3-products/);
});

test('catálogo produtivo exige produto e limita todas as consultas à raiz correspondente', async () => {
  const source = await read('functions/api/catalog-v2.js');
  assert.match(source, new RegExp(BOLINHAS_ROOT));
  assert.match(source, new RegExp(PANEL_ROOT));
  assert.match(source, /root_drive_id/);
  assert.match(source, /PRODUTO_INVALIDO/);
  assert.match(source, /rootVerified: true/g);
  assert.doesNotMatch(source, /staging|synthetic/i);
  await assert.doesNotReject(() => import(new URL('functions/api/catalog-v2.js', ROOT)));
});

test('checkout produtivo recalcula preço e rejeita produto incompatível com o Drive', async () => {
  const source = await read('functions/api/orders-v2.js');
  assert.match(source, new RegExp(BOLINHAS_ROOT));
  assert.match(source, new RegExp(PANEL_ROOT));
  assert.match(source, /ARTE_PRODUTO_INCOMPATIVEL/);
  assert.match(source, /validateQuantities/);
  assert.match(source, /commercial\.products\[item\.product\]\.unitPrice/);
  assert.doesNotMatch(source, /staging|synthetic/i);
  await assert.doesNotReject(() => import(new URL('functions/api/orders-v2.js', ROOT)));
});

test('configuração comercial persiste Painel 150 e raízes protegidas no KV real', async () => {
  const source = await read('functions/api/commercial-config.js');
  assert.match(source, /saveConfig/);
  assert.match(source, /unitPrice: 59\.9/);
  assert.match(source, new RegExp(BOLINHAS_ROOT));
  assert.match(source, new RegExp(PANEL_ROOT));
  assert.match(source, /commercialVersion/);
  await assert.doesNotReject(() => import(new URL('functions/api/commercial-config.js', ROOT)));
});

test('admin real controla preço e quantidade dos dois produtos e preserva raízes', async () => {
  const [products, loader, cache] = await Promise.all([
    read('assets/admin-products-v2.js'),
    read('assets/admin-ui-fix.js'),
    read('assets/admin-sales-cache-real.js')
  ]);
  assert.doesNotThrow(() => new Function(products));
  assert.match(products, /Quantidade mínima/);
  assert.match(products, /Quantidade inicial/);
  assert.match(products, /Preço unitário/);
  assert.match(products, new RegExp(BOLINHAS_ROOT));
  assert.match(products, new RegExp(PANEL_ROOT));
  assert.match(loader, /admin-products-v2\.js/);
  assert.match(loader, /admin-sales-cache-real\.js/);
  assert.match(cache, /customers-indexed/);
  assert.match(cache, /orders-indexed/);
});

test('desconto zero e checkout antigo não reaparecem visualmente', async () => {
  const [production, compat] = await Promise.all([
    read('assets/production-v2.js'),
    read('assets/production-v2-compat.js')
  ]);
  assert.match(production, /hasDiscount\?'Total com desconto':'Total'/);
  assert.match(production, /hasDiscount\?'Enviar pedido com '/);
  assert.match(production, /style\.setProperty\('display',hasDiscount\?'':'none','important'\)/);
  assert.match(compat, /link\.setAttribute\('href','#'\)/);
  assert.doesNotThrow(() => new Function(compat));
});
