import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

async function importSource(path) {
  const source = await read(path);
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}-${Math.random()}`);
}

test('checkout preserva a confirmação quando o cliente volta do WhatsApp', async () => {
  const recovery = await read('assets/checkout-v3-recovery.js');
  const loader = await read('assets/catalog-cache-bust.js');

  assert.doesNotThrow(() => new Function(recovery));
  assert.match(loader, /checkout-v3-recovery\.js\?v=20260804-2/);
  assert.match(recovery, /addEventListener\('click',handleSellerSend,true\)/);
  assert.match(recovery, /event\.preventDefault\(\)/);
  assert.match(recovery, /event\.stopImmediatePropagation\(\)/);
  assert.match(recovery, /window\.open\(url,'_blank'\)/);
  assert.doesNotMatch(recovery, /location\.(?:assign|replace)\s*\(/);
  assert.match(recovery, /addEventListener\('pageshow'/);
  assert.match(recovery, /visibilityState==='visible'/);
  assert.match(recovery, /restoreRecentSuccess/);
  assert.match(recovery, /checkoutV3Recovered/);
  assert.match(recovery, /sessionStorage\.setItem\(SESSION_KEY/);
  assert.match(recovery, /localStorage\.setItem\(DURABLE_KEY/);
  assert.match(recovery, /Você pode enviar novamente para a vendedora sem gerar outro número/);
});

test('recuperação mantém o retry idempotente do pedido', async () => {
  const recovery = await read('assets/checkout-v3-recovery.js');
  assert.match(recovery, /Idempotency-Key/);
  assert.match(recovery, /attempts\.get\(key\)/);
  assert.match(recovery, /X-Checkout-Retry/);
  assert.match(recovery, /count>1/);
});

test('formato PED antigo continua válido e o fallback concorrente fica único', async () => {
  const orderNumbers = await importSource('functions/api/_order_numbers.js');
  const createdAt = '2026-08-04T20:00:00.000Z';

  assert.equal(orderNumbers.formatOrderNumber('26', 1), 'PED2600001A');
  assert.deepEqual(
    orderNumbers.parseOrderNumber('PED2600001A'),
    { yy: '26', sequence: 1, suffix: '', normalized: 'PED2600001A' }
  );

  const env = {
    CONFIG_KV: {
      get: async () => '1',
      put: async () => undefined
    }
  };
  const generated = await Promise.all(
    Array.from({ length: 24 }, () => orderNumbers.nextOrderNumber(env, createdAt))
  );

  generated.forEach(number => {
    assert.match(number, /^PED2600001A-[A-F0-9]{12}$/);
    const parsed = orderNumbers.parseOrderNumber(number);
    assert.equal(parsed?.yy, '26');
    assert.equal(parsed?.sequence, 1);
    assert.equal(parsed?.normalized, number);
  });
  assert.equal(new Set(generated).size, generated.length);
});

test('hidratação não remove o sufixo de segurança do pedido', async () => {
  const orderNumbers = await importSource('functions/api/_order_numbers.js');
  const order = {
    id: 'PED2600042A-0123456789AB',
    orderNumber: 'PED2600042A-0123456789AB',
    createdAt: '2026-08-04T20:00:00.000Z'
  };
  orderNumbers.hydrateOrderNumbers([order]);
  assert.equal(order.orderNumber, 'PED2600042A-0123456789AB');
  assert.equal(order.orderCode, order.orderNumber);
  assert.equal(order.displayId, order.orderNumber);
});
