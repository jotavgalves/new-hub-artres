import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

test('checkout produtivo usa fluxo visual em três etapas', async () => {
  const source = await read('assets/checkout-v3.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /Confira suas artes/);
  assert.match(source, /Como podemos falar com você/);
  assert.match(source, /Registrando seu pedido/);
  assert.match(source, /Pedido registrado/);
  assert.match(source, /review-customer-processing/);
});

test('checkout intercepta antes do listener legado e mantém carrinho único', async () => {
  const source = await read('assets/checkout-v3.js');
  assert.match(source, /window\.addEventListener\('click',interceptCheckout,true\)/);
  assert.match(source, /stopImmediatePropagation/);
  assert.match(source, /safeCart\(\)\.map/);
  assert.match(source, /driveFileId/);
  assert.match(source, /productKey/);
  assert.match(source, /variantKey/);
  assert.match(source, /sizeKey/);
});

test('falha de rede repete com a mesma chave sem abrir popup antecipado', async () => {
  const source = await read('assets/checkout-v3.js');
  assert.match(source, /postWithRetry\(pending\.intent,pending\.key\)/);
  assert.match(source, /'Idempotency-Key':key/);
  assert.match(source, /for\(var attempt=0;attempt<2;attempt\+=1\)/);
  assert.match(source, /REPLAY/);
  assert.doesNotMatch(source, /window\.open\('',\s*'_blank'\)/);
  assert.match(source, /Abrir WhatsApp/);
});

test('carregador publica o checkout V3 depois da camada de compatibilidade', async () => {
  const source = await read('assets/catalog-cache-bust.js');
  assert.match(source, /productionV2CompatScript/);
  assert.match(source, /cartReconcileV1Script/);
  assert.match(source, /checkoutV3Script/);
  assert.match(source, /checkout-v3\.js\?v=\d{8}-\d+/);
  assert.match(source, /compat\.addEventListener\('load',loadCartReconcile/);
  assert.match(source, /script\.addEventListener\('load',loadCheckoutV3/);
});
