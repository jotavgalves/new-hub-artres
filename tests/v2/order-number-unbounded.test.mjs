import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatOrderNumberV2, parseOrderNumberV2 } from '../../src/v2/orders/order-number.mjs';
const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');
async function production() {
  const source = await read('functions/api/_order_numbers.js');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}`);
}
test('PED continua após Z com AA, AB e AAA', async () => {
  const current = await production();
  for (const [sequence, expected] of [[1,'PED2600001A'],[260000,'PED2610000Z'],[260001,'PED2600001AA'],[270001,'PED2600001AB'],[7020001,'PED2600001AAA']]) {
    assert.equal(current.formatOrderNumber('26', sequence), expected);
    assert.equal(current.parseOrderNumber(expected)?.sequence, sequence);
    assert.equal(formatOrderNumberV2('2026-08-05T10:00:00.000Z', sequence), expected);
    assert.equal(parseOrderNumberV2(expected)?.sequence, sequence);
  }
});
test('geradores e validadores ativos não mantêm teto de uma letra', async () => {
  const active = [
    'functions/api/_order_numbers.js',
    'src/v2/orders/order-number.mjs',
    'staging/site-v2-worker/src/order-ledger-do.js',
    'supabase/contracts/order-projection-v1.schema.json',
    'supabase/migrations/20260727193000_armazem_v2_projection_foundation.sql'
  ];
  for (const path of active) {
    const source = await read(path);
    assert.doesNotMatch(source, /ORDER_SEQUENCE_CAPACITY_EXCEEDED/);
    assert.match(source, /\[A-Z\]\+/);
  }
  const upgrade = await read('supabase/migrations/20260805073000_remove_ped_annual_capacity.sql');
  assert.match(upgrade, /\^PED\[0-9\]\{7\}\[A-Z\]\+\$/);
  assert.match(upgrade, /replace\(v_definition/);
});
