import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  MARKER,
  preserveVisualCheckoutItem,
  canonicalVisualMeasurements,
  canonicalVisualObservations,
  canonicalVisualSeller
} = require('../../staging/site-v2-worker/public/v2-checkout-context.js');

test('preserva a vendedora selecionada com identidade e rótulo canônicos', () => {
  assert.equal(MARKER, 'site-v2-visual-checkout-context-v1');
  assert.deepEqual(
    canonicalVisualSeller('ana', {
      ana: { label: 'Ana', phone: '5581999999999' }
    }),
    { id: 'ana', label: 'Ana' }
  );
  assert.deepEqual(
    canonicalVisualSeller({ sellerId: 'dayane', name: 'Dayane Silva' }, {}),
    { id: 'dayane', label: 'Dayane Silva' }
  );
  assert.equal(canonicalVisualSeller('', {}), null);
});

test('converte medidas retangulares legadas em bloco canônico sem perder os campos originais', () => {
  const item = {
    id: 'drive-lateral-001',
    product: 'lateral',
    qty: 1,
    details: {
      width: '1,50',
      height: '2,00',
      unit: 'm',
      customized: true,
      unknown: false,
      observacoes: 'Sem margem branca'
    }
  };

  preserveVisualCheckoutItem(item);

  assert.deepEqual(item.details.measurements, {
    width: '1,50',
    height: '2,00',
    unit: 'm',
    unknown: false,
    customized: true
  });
  assert.equal(item.details.observations, 'Sem margem branca');
  assert.equal(item.details.width, '1,50');
  assert.equal(item.details.height, '2,00');
  assert.equal(item.details.observacoes, 'Sem margem branca');
});

test('preserva medidas completas de kits e observações existentes no item', () => {
  const item = {
    driveFileId: 'drive-kit-001',
    productKey: 'kit-painel-cilindros',
    quantity: 1,
    observations: 'Confirmar acabamento com a cliente',
    details: {
      cylinders: {
        p: { width: '124', height: '50', cap: '40' },
        m: { width: '143', height: '63', cap: '45' },
        g: { width: '158', height: '86', cap: '50' }
      },
      panel: { diameter: '150' },
      unknown: false,
      customized: true
    }
  };

  preserveVisualCheckoutItem(item);

  assert.deepEqual(item.details.measurements, {
    cylinders: {
      p: { width: '124', height: '50', cap: '40' },
      m: { width: '143', height: '63', cap: '45' },
      g: { width: '158', height: '86', cap: '50' }
    },
    panel: { diameter: '150' },
    unknown: false,
    customized: true
  });
  assert.equal(item.details.observations, 'Confirmar acabamento com a cliente');
});

test('chaves canônicas explícitas prevalecem sobre aliases e campos legados', () => {
  const item = {
    measurements: { widthCm: 90, heightCm: 180 },
    observacoes: 'alias do item',
    details: {
      measurements: { widthCm: 100, heightCm: 200 },
      observations: 'canônica',
      width: '999',
      height: '999',
      medidas: { widthCm: 80 }
    }
  };

  assert.deepEqual(canonicalVisualMeasurements(item, item.details), {
    widthCm: 100,
    heightCm: 200
  });
  assert.equal(canonicalVisualObservations(item, item.details), 'canônica');

  preserveVisualCheckoutItem(item);
  assert.deepEqual(item.details.measurements, { widthCm: 100, heightCm: 200 });
  assert.equal(item.details.observations, 'canônica');
});

test('não cria blocos vazios quando não existem medidas ou observações', () => {
  const item = { id: 'drive-50-001', product: '50x50', qty: 6, details: {} };
  preserveVisualCheckoutItem(item);
  assert.deepEqual(item.details, {});
});
