import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
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
