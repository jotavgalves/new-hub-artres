import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeQuoteWarnings } from '../../src/v2/orders/atomic-command.mjs';

test('remove identificadores dos avisos de preço enviados ao cliente', () => {
  assert.deepEqual(
    sanitizeQuoteWarnings([
      'CLIENT_ITEM_PRICE_IGNORED:staging-artwork-2657',
      'CLIENT_ORDER_TOTALS_IGNORED',
      'CLIENT_ITEM_PRICE_IGNORED:outro-arquivo'
    ]),
    ['CLIENT_ITEM_PRICE_IGNORED', 'CLIENT_ORDER_TOTALS_IGNORED']
  );
});

test('descarta avisos inválidos e não aceita entrada não enumerável', () => {
  assert.deepEqual(sanitizeQuoteWarnings(['ok', 'CLIENT_TOTAL_IGNORED', 'CLIENT TOTAL']), ['CLIENT_TOTAL_IGNORED']);
  assert.deepEqual(sanitizeQuoteWarnings('CLIENT_TOTAL_IGNORED'), []);
});
