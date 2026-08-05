import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatOrderNumberV2,
  parseOrderNumberV2
} from '../../src/v2/orders/order-number.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, ROOT), 'utf8');

async function importProductionNumbers() {
  const source = await read('functions/api/_order_numbers.js');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

test('numeração PED ultrapassa Z usando blocos AA, AB e AAA', async () => {
  const production = await importProductionNumbers();
  const cases = [
    [1, 'PED2600001A'],
    [260000, 'PED2610000Z'],
    [260001, 'PED2600001AA'],
    [270001, 'PED2600001AB'],
    [7020001, 'PED2600001AAA']
  ];

  for (const [sequence, expected] of cases) {
    assert.equal(production.formatOrderNumber('26', sequence), expected);
    assert.equal(production.parseOrderNumber(expected)?.sequence, sequence);
    assert.equal(formatOrderNumberV2('2026-08-05T10:00:00.000Z', sequence), expected);
    assert.equal(parseOrderNumberV2(expected)?.sequence, sequence);
  }
});

test('não existe o erro de capacidade anual de 26 blocos', async () => {
  const source = await read('src/v2/orders/order-number.mjs');
  assert.doesNotMatch(source, /ORDER_SEQUENCE_CAPACITY_EXCEEDED/);
  assert.match(source, /\[A-Z\]\+/);
});

test('ledger, contrato e projeção aceitam blocos com mais de uma letra', async () => {
  const ledger = await read('staging/site-v2-worker/src/order-ledger-do.js');
  const contract = await read('supabase/contracts/order-projection-v1.schema.json');
  const foundation = await read('supabase/migrations/20260727193000_armazem_v2_projection_foundation.sql');
  const upgrade = await read('supabase/migrations/20260805073000_remove_ped_annual_capacity.sql');

  assert.match(ledger, /\[A-Z\]\+\$/);
  assert.match(contract, /\^PED\[0-9\]\{7\}\[A-Z\]\+\$/);
  assert.match(foundation, /\^PED\[0-9\]\{7\}\[A-Z\]\+\$/);
  assert.match(upgrade, /armazem_v2_orders_number_format/);
  assert.match(upgrade, /armazem_v2_project_order_v1/);
});
