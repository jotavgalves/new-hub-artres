import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
const compileAsScript = source => new Function(
  source
    .replace(/^import .*;\s*$/gm, '')
    .replace(/\bexport\s+(?=(?:async\s+)?function\b)/g, '')
);

test('retry do checkout usa índice direto e nunca varre até 500 pedidos no KV', async () => {
  const source = await read('functions/api/orders-v2.js');
  assert.doesNotThrow(() => compileAsScript(source));
  assert.match(source, /CHECKOUT_REF_PREFIX\s*=\s*'ORDER_CHECKOUT_REF:'/);
  assert.match(source, /CONFIG_KV\.get\(CHECKOUT_REF_PREFIX \+ wanted\)/);
  assert.match(source, /CONFIG_KV\.get\(ORDER_PREFIX \+ indexedOrderNumber, 'json'\)/);
  assert.doesNotMatch(source, /MAX_RECOVERY_ORDERS/);
  assert.doesNotMatch(source, /CONFIG_KV\.list\(/);
});

test('registro cria índice de recuperação e persiste Supabase e KV em paralelo', async () => {
  const source = await read('functions/api/orders.js');
  assert.doesNotThrow(() => compileAsScript(source));
  assert.match(source, /CHECKOUT_REF_PREFIX\s*=\s*"ORDER_CHECKOUT_REF:"/);
  assert.match(source, /Promise\.all\(\[supabaseTask, kvTask\]\)/);
  assert.match(source, /Promise\.allSettled\(writes\)/);
  assert.match(source, /expirationTtl:\s*86400/);
  assert.match(source, /cleanCheckoutReference/);
});

test('orders-v2 reaproveita a configuração já carregada no mesmo checkout', async () => {
  const v2 = await read('functions/api/orders-v2.js');
  const legacy = await read('functions/api/orders.js');
  assert.match(v2, /checkoutConfig: config/);
  assert.match(legacy, /context\.checkoutConfig/);
  assert.match(legacy, /\(await loadConfig\(context\.env\)\)\.config/);
});
