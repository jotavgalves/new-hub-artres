import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const commercial = require('../../staging/site-v2-worker/public/v2-commercial-config.js');

const validConfig = {
  schemaVersion: 1,
  version: 3,
  currency: 'BRL',
  effectiveDiscountPercent: 5,
  products: {
    '50x50': {
      label: 'Bolinhas 50x50', enabled: true, unitPrice: 10.25,
      quantity: { minimum: 6, step: 2, initial: 6, scope: 'cart-product-total' }
    },
    'painel-150': {
      label: 'Painel redondo 150 cm', enabled: true, unitPrice: 65,
      quantity: { minimum: 1, step: 1, initial: 1, scope: 'item' }
    }
  },
  updatedAt: '2026-07-30T18:00:00.000Z'
};

test('valida contrato público dos dois produtos', () => {
  const config = commercial.validatePublicConfig(validConfig);
  assert.equal(config.version, 3);
  assert.equal(config.products['50x50'].unitPrice, 10.25);
  assert.equal(config.products['painel-150'].quantity.scope, 'item');
  assert.throws(
    () => commercial.validatePublicConfig({ ...validConfig, products: { '50x50': validConfig.products['50x50'] } }),
    error => error.code === 'COMMERCIAL_CONFIG_PRODUCT_INVALID:painel-150'
  );
});

test('aceita desconto zero como configuração comercial válida', () => {
  const config = commercial.validatePublicConfig({
    ...validConfig,
    version: 4,
    effectiveDiscountPercent: 0
  });
  assert.equal(config.effectiveDiscountPercent, 0);
});

test('busca endpoint público sem cache e rejeita resposta inválida', async () => {
  const calls = [];
  const config = await commercial.fetchCommercialConfig(async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, config: validConfig }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });

  assert.equal(config.version, 3);
  assert.equal(calls[0].url, '/api/commercial-config');
  assert.equal(calls[0].init.cache, 'no-store');

  await assert.rejects(
    commercial.fetchCommercialConfig(async () => new Response('{}', { status: 503 })),
    error => error.code === 'HTTP_503'
  );
});

test('asset altera funções comerciais sem guardar preços no navegador', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-commercial-config.js', 'utf8');

  assert.match(source, /getProductConfig/);
  assert.match(source, /setPrice/);
  assert.match(source, /setDiscount/);
  assert.match(source, /setRule50/);
  assert.match(source, /setRenderCart/);
  assert.match(source, /fetchCommercialConfig/);
  assert.match(source, /let hooksWrapped = false/);
  assert.match(source, /if \(!hooksWrapped\) \{/);
  assert.match(source, /hooksWrapped = true/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(source, /unitPrice\s*:\s*9\.75|unitPrice\s*:\s*59\.90/);
});

test('desconto zero remove toda a apresentação promocional legada', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-commercial-config.js', 'utf8');

  assert.match(source, /hooks\.renderCart\(\);\s*patchCommercialCopy\(root\?\.document\)/);
  assert.match(source, /line\.style\.display = hasDiscount \? '' : 'none'/);
  assert.match(source, /setText\(label, hasDiscount \? 'Total com desconto' : 'Total'\)/);
  assert.match(source, /setText\(link, hasDiscount \? `Enviar pedido com \$\{percentText\} OFF` : 'Enviar pedido'\)/);
  assert.match(source, /card\.style\.display = hasDiscount \? '' : 'none'/);
  assert.match(source, /observeCommercialCopy/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /Seu pedido ainda está vazio[\s\S]+adicione as artes que mais gostar/);
  assert.doesNotMatch(source, /line\.hidden = percent <= 0/);
});

test('configuração zero oculta visualmente desconto e usa total neutro', async () => {
  const source = await readFile('staging/site-v2-worker/public/v2-commercial-config.js', 'utf8');
  const subtitle = element('10% de desconto');
  const promoPill = element('10% OFF por aqui');
  const promoTitle = element('Escolha suas artes com desconto');
  const promoText = element('O desconto de 10% é aplicado automaticamente.');
  const caption = element('Toque na arte; o desconto de 10% entra automaticamente.');
  const discountSpan = element('10% OFF por aqui');
  const discountSmall = element('O desconto entra automaticamente.');
  const discountCard = element('', { span: discountSpan, small: discountSmall });
  const discountLabel = element('Desconto por aqui 10%');
  const discountLine = element('', { span: discountLabel });
  const totalLabel = element('Total com desconto');
  const total = element('', { span: totalLabel });
  const whatsapp = element('Enviar pedido com 10% OFF');
  const emptyCart = element('');
  emptyCart.innerHTML = '<b>Seu pedido ainda está vazio</b>O desconto de 10% será aplicado.';
  const ruleCard = element('Perfeito. Sua seleção está pronta para enviar com 10% de desconto por aqui.');

  const singles = new Map([
    ['.subtitle strong', subtitle],
    ['.promoPill', promoPill],
    ['.promo h3', promoTitle],
    ['.promo p:last-child', promoText],
    ['#viewCaption', caption]
  ]);
  const multiples = new Map([
    ['.discountCard', [discountCard]],
    ['.totalLine', [discountLine]],
    ['.total', [total]],
    ['.wa', [whatsapp]],
    ['.emptyCart', [emptyCart]],
    ['.ruleCard', [ruleCard]]
  ]);
  const document = {
    body: {},
    documentElement: { setAttribute() {} },
    querySelector(selector) { return singles.get(selector) || null; },
    querySelectorAll(selector) { return multiples.get(selector) || []; }
  };
  const context = { module: { exports: {} }, exports: {}, document, Response };
  context.globalThis = context;
  runInNewContext(source, context, { filename: 'v2-commercial-config.js' });
  const api = context.module.exports;

  let cartRule = () => ({ ok: true, msg: 'Perfeito. Sua seleção está pronta para enviar com 10% de desconto por aqui.' });
  await api.start({
    fetch: async () => Response.json({
      ok: true,
      config: { ...validConfig, version: 5, effectiveDiscountPercent: 0 }
    }),
    getProductConfig: () => () => ({}),
    setProductConfig() {},
    getPrice: () => () => 0,
    setPrice() {},
    setDiscount() {},
    getGross: () => 129.55,
    getRule50: () => () => null,
    setRule50() {},
    getCartRule: () => cartRule,
    setCartRule(next) { cartRule = next; },
    getRenderCart: () => () => {},
    setRenderCart() {},
    renderCart() {},
    getCartItems: () => []
  });

  assert.equal(discountCard.style.display, 'none');
  assert.equal(discountLine.style.display, 'none');
  assert.equal(totalLabel.textContent, 'Total');
  assert.equal(whatsapp.textContent, 'Enviar pedido');
  assert.equal(subtitle.textContent, 'valores atualizados');
  assert.doesNotMatch(emptyCart.innerHTML, /desconto|10%/i);
  assert.doesNotMatch(cartRule().msg, /desconto|10%/i);
});

function element(text = '', children = {}) {
  return {
    textContent: text,
    innerHTML: text,
    style: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector(selector) { return children[selector] || null; }
  };
}
