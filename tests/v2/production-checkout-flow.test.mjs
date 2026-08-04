import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

const CHECKOUT_ASSET = 'assets/production-checkout-flow-v2.js';

test('checkout oficial possui conferência, identificação, registro e sucesso na mesma interface', async () => {
  const source = await read(CHECKOUT_ASSET);
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /Confira suas artes/);
  assert.match(source, /Como podemos falar com você/);
  assert.match(source, /Registrando seu pedido/);
  assert.match(source, /Pedido registrado/);
  assert.match(source, /O WhatsApp não abriu/);
  assert.match(source, /checkoutFlowItems/);
  assert.match(source, /item\.quantity/);
  assert.match(source, /item\.productName/);
  assert.match(source, /item\.image/);
});

test('novo fluxo intercepta o checkout antigo e não abre aba branca durante o registro', async () => {
  const source = await read(CHECKOUT_ASSET);
  assert.match(source, /window\.addEventListener\('click',interceptCheckout,true\)/);
  assert.match(source, /stopImmediatePropagation/);
  assert.doesNotMatch(source, /window\.open\('',\s*'_blank'/);
  assert.doesNotMatch(source, /document\.body\.textContent='Registrando seu pedido/);
  assert.match(source, /showRegistering\('Validando suas artes'/);
  assert.match(source, /showRegistering\('Verificando a tentativa anterior'/);
});

test('falha antes da confirmação repete a mesma chave e falha do WhatsApp não envia novo POST', async () => {
  const source = await read(CHECKOUT_ASSET);
  assert.match(source, /submission\.idempotencyKey=await idempotency\(submission\.intent\)/);
  assert.match(source, /day:new Date\(\)\.toISOString\(\)\.slice\(0,10\)/);
  assert.match(source, /'Idempotency-Key':submission\.idempotencyKey/);
  assert.match(source, /data-retry/);
  assert.match(source, /submitIntent\(\)/);
  assert.match(source, /data-open-whatsapp/);
  assert.match(source, /persistAccepted/);
  assert.match(source, /ACCEPTED_TTL=12\*60\*60\*1000/);
  const whatsappSection = source.slice(source.indexOf('function openAcceptedWhatsapp'), source.indexOf('function showPostAcceptanceFailure'));
  assert.doesNotMatch(whatsappSection, /fetch\(/);
  assert.match(whatsappSection, /window\.open\(url,'_blank'\)/);
  assert.doesNotMatch(whatsappSection, /'noopener'/);
});

test('API recupera pedido salvo pela referência do checkout antes de criar outro', async () => {
  const source = await read('functions/api/orders-v2.js');
  assert.match(source, /findOrderByCheckoutReference/);
  assert.match(source, /checkoutReference: idempotencyKey/);
  assert.match(source, /raw->customer->>checkoutReference/);
  assert.match(source, /ORDER_PREFIX/);
  assert.match(source, /action: 'REPLAY'/);
  assert.match(source, /recovered/);
  assert.doesNotMatch(source, /detail:\s*String\(error/);
  await assert.doesNotReject(() => import(new URL('functions/api/orders-v2.js', ROOT)));
});

test('carregador publica o novo fluxo somente após produção e compatibilidade', async () => {
  const source = await read('assets/catalog-cache-bust.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /production-checkout-flow-v2\.js\?v=20260804-2/);
  assert.match(source, /productionV2CompatScript/);
  assert.match(source, /compat\.addEventListener\('load',loadCheckoutFlow/);
  assert.match(source, /else loadCheckoutFlow\(\)/);
});
