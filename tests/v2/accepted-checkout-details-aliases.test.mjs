import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAcceptedCheckoutItems } from '../../staging/site-v2-worker/src/accepted-checkout-item-validator.js';

const catalog = [{
  driveFileId: 'drive-file-details-001',
  code: '656',
  originalName: '656_ARCO-IRIS_50X50.jpg',
  theme: 'ARCO IRIS',
  subtheme: '',
  productKey: '50x50',
  productName: 'Bolinhas 50x50',
  sizeKey: '50x50'
}];

test('normaliza aliases legados para chaves canônicas de detalhes', () => {
  const result = validateAcceptedCheckoutItems([{
    driveFileId: 'drive-file-details-001',
    productKey: '50x50',
    variantKey: 'default',
    sizeKey: '50x50',
    quantity: 6,
    medidas: { larguraCm: 50, alturaCm: 50 },
    observacoes: '  Fundo sem margem  ',
    personalizacao: { nome: 'Helena', idade: 6 },
    details: { acabamento: 'fosco' }
  }], catalog);

  assert.deepEqual(result.items[0].details, {
    acabamento: 'fosco',
    measurements: { larguraCm: 50, alturaCm: 50 },
    observations: '  Fundo sem margem  ',
    personalization: { nome: 'Helena', idade: 6 }
  });
  assert.equal('medidas' in result.items[0].details, false);
  assert.equal('observacoes' in result.items[0].details, false);
  assert.equal('personalizacao' in result.items[0].details, false);
  assert.equal(Object.isFrozen(result.items[0].details), true);
});

test('chaves canônicas explícitas prevalecem sobre aliases', () => {
  const result = validateAcceptedCheckoutItems([{
    driveFileId: 'drive-file-details-001',
    productKey: '50x50',
    variantKey: 'default',
    sizeKey: '50x50',
    quantity: 6,
    medidas: { larguraCm: 10 },
    observacoes: 'alias',
    personalizacao: { nome: 'Alias' },
    details: {
      measurements: { larguraCm: 50 },
      observations: 'canônica',
      personalization: { nome: 'Canônico' }
    }
  }], catalog);

  assert.deepEqual(result.items[0].details.measurements, { larguraCm: 50 });
  assert.equal(result.items[0].details.observations, 'canônica');
  assert.deepEqual(result.items[0].details.personalization, { nome: 'Canônico' });
});
