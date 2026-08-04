import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

test('segunda tentativa do checkout é marcada para recuperação no servidor', async () => {
  const source = await read('assets/checkout-v3-recovery.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /url\.pathname==='\/api\/orders-v2'/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /count>1/);
  assert.match(source, /X-Checkout-Retry/);
});

test('recuperação local persiste somente confirmação e URL segura, sem dados do cliente', async () => {
  const source = await read('assets/checkout-v3-recovery.js');
  assert.match(source, /sessionStorage\.setItem\(SESSION_KEY/);
  assert.match(source, /localStorage\.setItem\(DURABLE_KEY/);
  assert.match(source, /orderNumber/);
  assert.match(source, /validSellerUrl/);
  assert.doesNotMatch(source, /customerName|customerWhatsapp|CUSTOMER_DRAFT/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^,]+,\s*(?:name|whatsapp|customer)/);
});

test('servidor procura pedido já salvo somente em uma repetição identificada', async () => {
  const source = await read('functions/api/orders-v2.js');
  assert.match(source, /X-Checkout-Retry/);
  assert.match(source, /recoveryRequested/);
  assert.match(source, /findOrderByCheckoutReference/);
  assert.match(source, /raw->customer->>checkoutReference/);
  assert.match(source, /checkoutReference: idempotencyKey/);
  assert.match(source, /action: 'REPLAY'/);
  assert.match(source, /MAX_RECOVERY_ORDERS/);
  assert.doesNotMatch(source, /detail:\s*String\(error/);
  await assert.doesNotReject(() => import(new URL('functions/api/orders-v2.js', ROOT)));
});

test('carregador inicia a recuperação somente depois do checkout visual', async () => {
  const source = await read('assets/catalog-cache-bust.js');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /checkout-v3\.js\?v=20260804-1/);
  assert.match(source, /checkout-v3-recovery\.js\?v=20260804-2/);
  assert.match(source, /script\.addEventListener\('load',loadCheckoutRecovery/);
  assert.match(source, /compat\.addEventListener\('load',loadCheckoutV3/);
});
