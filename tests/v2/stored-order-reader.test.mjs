import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptOrderForV2 } from '../../src/v2/orders/legacy-adapter.mjs';
import {
  MAX_STORED_ORDER_BYTES,
  parseStoredOrderJson,
  readStoredOrderForCompatibility
} from '../../src/v2/orders/stored-order-reader.mjs';

const legacyOrder = {
  id: 'PED2600001A',
  createdAt: '2026-07-26T18:00:00.000Z',
  status: 'Novo',
  seller: { id: 'ana', label: 'Ana' },
  customer: { name: 'Cliente', whatsapp: '5581999999999' },
  totals: { subtotal: 58.5, total: 58.5 },
  items: [{
    code: '2657',
    theme: '1 ANO',
    product: '50x50',
    productName: 'Bolinhas 50x50',
    qty: 6,
    image: 'https://example.test/2657.jpg'
  }]
};

test('lê pedido direto sem alterar o registro de origem', () => {
  const source = structuredClone(legacyOrder);
  const before = structuredClone(source);
  const result = readStoredOrderForCompatibility(source);

  assert.equal(result.storageMode, 'direct');
  assert.equal(result.order.orderNumber, 'PED2600001A');
  assert.equal(result.order.items.length, 1);
  assert.equal(result.order.items[0].code, '2657');
  assert.deepEqual(source, before);
  assert.equal(Object.isFrozen(result.order), true);
});

test('lê JSON integral salvo em ORDER:<orderNumber> no KV', () => {
  const result = readStoredOrderForCompatibility(JSON.stringify(legacyOrder));
  const adapted = adaptOrderForV2(result.order);

  assert.equal(result.storageMode, 'kv-json');
  assert.equal(adapted.orderNumber, 'PED2600001A');
  assert.equal(adapted.compatibilityMode, 'adapted-legacy');
  assert.equal(adapted.items[0].identityStatus, 'unresolved-legacy');
  assert.equal(adapted.items[0].driveFileId, '');
});

test('lê orders.raw do Supabase e respeita status atualizado da linha', () => {
  const result = readStoredOrderForCompatibility({
    order_number: 'PED2600001A',
    status: 'Em produção',
    created_at: '2026-07-26T18:00:00.000Z',
    updated_at: '2026-07-27T12:00:00.000Z',
    raw: JSON.stringify(legacyOrder)
  });

  assert.equal(result.storageMode, 'supabase-raw');
  assert.equal(result.order.orderNumber, 'PED2600001A');
  assert.equal(result.order.status, 'Em produção');
  assert.equal(result.order.updatedAt, '2026-07-27T12:00:00.000Z');
  assert.equal(result.order.items[0].productName, 'Bolinhas 50x50');
  assert.deepEqual(result.warnings, []);
});

test('lê linha de orders e order_items quando raw não existe', () => {
  const result = readStoredOrderForCompatibility({
    order_number: 'PED2600002A',
    status: 'Novo',
    created_at: '2026-07-26T19:00:00.000Z',
    seller_id: 'ana',
    seller_name: 'Ana',
    customer_name: 'Cliente Antigo',
    customer_whatsapp: '5581999999999',
    subtotal: 156,
    total: 156,
    order_items: [
      {
        code: '2657',
        theme: '1 ANO',
        product: '50x50',
        product_name: 'Bolinhas 50x50',
        quantity: 6
      },
      {
        code: '2657',
        theme: '1 ANO',
        product: 'sacolinha',
        product_name: 'Sacolinha de Festa',
        quantity: 10,
        details_json: '{"size":"P","observations":"Alça rosa"}'
      }
    ]
  });
  const adapted = adaptOrderForV2(result.order);

  assert.equal(result.storageMode, 'supabase-rows');
  assert.ok(result.warnings.includes('LEGACY_ITEMS_READ_FROM_ROWS'));
  assert.equal(adapted.orderNumber, 'PED2600002A');
  assert.equal(adapted.seller.name, 'Ana');
  assert.equal(adapted.customer.name, 'Cliente Antigo');
  assert.equal(adapted.items.length, 2);
  assert.equal(adapted.items[0].code, adapted.items[1].code);
  assert.notEqual(adapted.items[0].itemId, adapted.items[1].itemId);
  assert.equal(adapted.qty, 16);
  assert.deepEqual(adapted.items[1].details, { size: 'P', observations: 'Alça rosa' });
});

test('raw inválido usa linhas separadas sem apagar o aviso', () => {
  const result = readStoredOrderForCompatibility({
    order_number: 'PED2600003A',
    raw: '{json-invalido',
    order_items: [{ code: '4100', product: 'painel', product_name: 'Painel', quantity: 1 }]
  });

  assert.equal(result.storageMode, 'supabase-rows');
  assert.ok(result.warnings.includes('LEGACY_RAW_INVALID_JSON'));
  assert.ok(result.warnings.includes('LEGACY_RAW_FALLBACK_USED'));
  assert.ok(result.warnings.includes('LEGACY_ITEMS_READ_FROM_ROWS'));
  assert.equal(result.order.items[0].code, '4100');
});

test('lê envelope de API sem alterar o pedido interno', () => {
  const result = readStoredOrderForCompatibility({
    ok: true,
    order: legacyOrder
  });

  assert.equal(result.order.orderNumber, 'PED2600001A');
  assert.equal(result.order.items[0].quantity, 6);
});

test('rejeita JSON superior ao limite e conteúdo que não seja objeto', () => {
  assert.throws(
    () => parseStoredOrderJson('[]'),
    error => error.code === 'STORED_ORDER_JSON_OBJECT_REQUIRED'
  );
  assert.throws(
    () => parseStoredOrderJson('{invalido'),
    error => error.code === 'STORED_ORDER_JSON_INVALID'
  );
  assert.throws(
    () => parseStoredOrderJson(JSON.stringify({ value: 'x'.repeat(MAX_STORED_ORDER_BYTES) })),
    error => error.code === 'STORED_ORDER_JSON_TOO_LARGE'
  );
  assert.throws(
    () => readStoredOrderForCompatibility([]),
    error => error.code === 'STORED_ORDER_TYPE_INVALID'
  );
});
