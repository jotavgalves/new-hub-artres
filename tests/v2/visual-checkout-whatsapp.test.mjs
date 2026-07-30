import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const whatsapp = require('../../staging/site-v2-worker/public/v2-checkout-whatsapp.js');

test('gera snapshot separado para códigos iguais com produto, variante, tamanho e quantidade canônicos', () => {
  const raw = [
    {
      id: 'drive-bolinhas',
      code: '2657',
      theme: '1 Ano',
      product: '50x50',
      productName: 'Bolinhas 50x50',
      qty: 6,
      details: { measurements: { diameter: '50' } }
    },
    {
      id: 'drive-sacola',
      code: '2657',
      theme: '1 Ano',
      product: 'sacolinha',
      productName: 'Sacolinha personalizada',
      qty: 10,
      details: { size: 'M', observations: 'Alça rosa' }
    }
  ];
  const canonical = [
    {
      driveFileId: 'drive-bolinhas',
      productKey: '50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6,
      details: { measurements: { diameterCm: 50 } }
    },
    {
      driveFileId: 'drive-sacola',
      productKey: 'sacolinha',
      variantKey: 'M',
      sizeKey: 'default',
      quantity: 10,
      details: { observations: 'Alça rosa' }
    }
  ];

  const snapshot = whatsapp.createVisualWhatsAppSnapshot(raw, canonical);

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.length, 2);
  assert.deepEqual(snapshot.map(item => [item.code, item.productKey, item.variantKey, item.sizeKey, item.quantity]), [
    ['2657', '50x50', 'default', '50x50', 6],
    ['2657', 'sacolinha', 'M', 'default', 10]
  ]);
  assert.equal(snapshot[0].sizeLabel, '50x50');
  assert.equal(snapshot[1].variantLabel, 'M');
  assert.equal(snapshot[1].sizeLabel, '');
  assert.deepEqual(snapshot[0].measurements, { diameterCm: 50 });
  assert.equal(snapshot[1].observations, 'Alça rosa');
});

test('gera mensagem com número confirmado, itens separados, variantes, quantidades e medidas completas', () => {
  const items = [
    {
      code: '2657',
      theme: '1 Ano',
      productKey: '50x50',
      productLabel: 'Bolinhas 50x50',
      variantKey: 'default',
      variantLabel: '',
      sizeKey: '50x50',
      sizeLabel: '50x50',
      quantity: 6,
      measurements: { diameterCm: 50 },
      observations: ''
    },
    {
      code: '2657',
      theme: '1 Ano',
      productKey: 'sacolinha',
      productLabel: 'Sacolinha personalizada',
      variantKey: 'M',
      variantLabel: 'M',
      sizeKey: 'default',
      sizeLabel: '',
      quantity: 10,
      measurements: undefined,
      observations: 'Alça rosa'
    },
    {
      code: '4100',
      theme: 'Bosque',
      productKey: 'kit-painel-cilindros',
      productLabel: 'Kit painel e cilindros',
      variantKey: 'com-painel',
      variantLabel: 'Com painel',
      sizeKey: 'grande',
      sizeLabel: 'Grande',
      quantity: 1,
      measurements: {
        cylinders: {
          p: { width: 124, height: 50, cap: 40 },
          m: { width: 143, height: 63, cap: 45 },
          g: { width: 158, height: 86, cap: 50 }
        },
        panel: { diameter: 150 }
      },
      observations: 'Centralizar a arte principal'
    }
  ];

  const message = whatsapp.createVisualWhatsAppMessage({
    orderNumber: 'PED2600123A',
    seller: { id: 'ana', label: 'Ana' },
    items
  });

  assert.match(message, /^Oi, Ana! Meu pedido foi registrado no site\./);
  assert.match(message, /Pedido: PED2600123A/);
  assert.equal((message.match(/Arte #2657/g) || []).length, 2);
  assert.match(message, /1\. Arte #2657 \| Bolinhas 50x50/);
  assert.match(message, /Quantidade: 6 un\./);
  assert.match(message, /Tamanho: 50x50/);
  assert.match(message, /Medidas: Diâmetro: 50 cm/);
  assert.match(message, /2\. Arte #2657 \| Sacolinha personalizada/);
  assert.match(message, /Variante: M/);
  assert.match(message, /Quantidade: 10 un\./);
  assert.match(message, /Observações: Alça rosa/);
  assert.match(message, /3\. Arte #4100 \| Kit painel e cilindros/);
  assert.match(message, /Variante: Com painel/);
  assert.match(message, /Tamanho: Grande/);
  assert.match(message, /Cilindro P: 124 x 50 cm; tampa 40 cm/);
  assert.match(message, /Cilindro M: 143 x 63 cm; tampa 45 cm/);
  assert.match(message, /Cilindro G: 158 x 86 cm; tampa 50 cm/);
  assert.match(message, /Painel: diâmetro 150 cm/);
  assert.match(message, /Observações: Centralizar a arte principal/);
  assert.doesNotMatch(message, /\bdefault\b/);
  assert.doesNotMatch(message, /\[object Object\]/);
});

test('formata aliases retangulares e medidas ainda não definidas', () => {
  assert.deepEqual(
    whatsapp.formatVisualMeasurements({ larguraCm: '100,5', alturaCm: 200 }),
    ['100,5 x 200 cm']
  );
  assert.deepEqual(
    whatsapp.formatVisualMeasurements({ unknown: true }),
    ['A confirmar com a vendedora']
  );
});

test('gera URL somente para telefone e mensagem válidos', () => {
  const message = 'Pedido: PED2600123A\nQuantidade: 6 un.';
  const url = whatsapp.createVisualWhatsAppUrl({
    phone: '+55 (81) 99999-9999',
    message
  });

  assert.equal(url, `https://wa.me/5581999999999?text=${encodeURIComponent(message)}`);
  assert.throws(
    () => whatsapp.createVisualWhatsAppUrl({ phone: '123', message }),
    error => error.code === 'WHATSAPP_PHONE_INVALID'
  );
  assert.throws(
    () => whatsapp.createVisualWhatsAppUrl({ phone: '5581999999999', message: '' }),
    error => error.code === 'WHATSAPP_MESSAGE_REQUIRED'
  );
});

test('falha fechado quando snapshot e mensagem não representam todos os itens', () => {
  assert.throws(
    () => whatsapp.createVisualWhatsAppSnapshot([{}], []),
    error => error.code === 'WHATSAPP_ITEM_SNAPSHOT_INVALID'
  );
  assert.throws(
    () => whatsapp.createVisualWhatsAppMessage({ orderNumber: 'PED1', seller: { label: 'Ana' }, items: [] }),
    error => error.code === 'WHATSAPP_ITEMS_REQUIRED'
  );
});
