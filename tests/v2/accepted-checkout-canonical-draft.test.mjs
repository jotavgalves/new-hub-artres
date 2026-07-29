import assert from 'node:assert/strict';
import test from 'node:test';

import { validateAcceptedCheckoutItems } from '../../staging/site-v2-worker/src/accepted-checkout-item-validator.js';
import { priceAcceptedCheckoutDraft } from '../../staging/site-v2-worker/src/accepted-checkout-pricing.js';
import { prepareAcceptedCheckoutCanonicalDraft } from '../../staging/site-v2-worker/src/accepted-checkout-canonical-draft.js';

const catalogItems = [{
  driveFileId: 'drive-file-canonical-001',
  code: '656',
  originalName: '656_ARCO-IRIS_50X50.jpg',
  theme: 'ARCO IRIS',
  subtheme: '',
  productKey: '50x50',
  productName: 'Bolinhas 50x50',
  sizeKey: '50x50'
}];

function body(overrides = {}) {
  return {
    seller: {
      id: 'vendedora-ana',
      label: '  Ana Vendas  '
    },
    customer: {
      name: '  Cliente Teste  ',
      whatsapp: '(81) 99999-9999',
      phone: '(81) 98888-7777'
    },
    total: 0.01,
    items: [{
      driveFileId: 'drive-file-canonical-001',
      productKey: '50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6,
      unitPrice: 0.01,
      medidas: { larguraCm: 50, alturaCm: 50 },
      observacoes: '  Sem margem branca  ',
      personalizacao: { nome: 'Helena', idade: 6 }
    }],
    ...overrides
  };
}

async function build(inputBody = body(), options = {}) {
  const resolved = { catalogVersion: 49, items: catalogItems };
  const validated = validateAcceptedCheckoutItems(inputBody.items, catalogItems);
  const priced = priceAcceptedCheckoutDraft({
    body: inputBody,
    resolved,
    validated,
    env: {}
  });
  return prepareAcceptedCheckoutCanonicalDraft({
    body: inputBody,
    resolved,
    validated,
    priced,
    requestId: 'canonical-draft-request-001',
    submissionCreatedAt: '2026-07-29T12:00:00.000Z',
    ...options
  });
}

test('preserva cliente vendedora medidas observações e personalização no comando', async () => {
  const result = await build();
  const order = result.command.preparedOrder;

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.writesPerformed, false);
  assert.deepEqual(order.seller, {
    id: 'vendedora-ana',
    label: 'Ana Vendas'
  });
  assert.deepEqual(order.customer, {
    name: 'Cliente Teste',
    whatsapp: '81999999999',
    phone: '81988887777'
  });
  assert.deepEqual(order.items[0].details, {
    measurements: { larguraCm: 50, alturaCm: 50 },
    observations: 'Sem margem branca',
    personalization: { nome: 'Helena', idade: 6 }
  });
  assert.equal(order.items[0].unitPrice, 9.75);
  assert.equal(order.pricing.total, 58.5);
  assert.equal(order.integrity.catalogVersion, 49);
  assert.equal(order.source, 'catalog-v2-staging-accepted-preview');
  assert.equal(result.summary.sellerPresent, true);
  assert.equal(result.summary.customerNamePresent, true);
  assert.equal(result.summary.customerWhatsappPresent, true);
  assert.equal(result.summary.measurementsItemCount, 1);
  assert.equal(result.summary.observationsItemCount, 1);
  assert.equal(result.summary.personalizationItemCount, 1);
  assert.equal(result.summary.canonicalFingerprintReady, true);
  assert.equal(result.summary.idempotencyStorageKeyReady, true);
});

test('resumo não contém nome telefone conteúdo dos detalhes nem ID da arte', async () => {
  const result = await build();
  const serialized = JSON.stringify(result.summary);

  assert.equal(serialized.includes('Cliente Teste'), false);
  assert.equal(serialized.includes('81999999999'), false);
  assert.equal(serialized.includes('Helena'), false);
  assert.equal(serialized.includes('Sem margem branca'), false);
  assert.equal(serialized.includes('drive-file-canonical-001'), false);
  assert.equal(serialized.includes(result.command.fingerprint), false);
  assert.equal(serialized.includes(result.command.idempotencyKey), false);
});

test('exige vendedora cliente e WhatsApp válidos', async () => {
  const cases = [
    { body: body({ seller: {} }), code: 'SELLER_REQUIRED' },
    { body: body({ customer: { whatsapp: '81999999999' } }), code: 'CUSTOMER_NAME_REQUIRED' },
    { body: body({ customer: { name: 'Cliente', whatsapp: '123' } }), code: 'CUSTOMER_WHATSAPP_INVALID' }
  ];

  for (const testCase of cases) {
    await assert.rejects(
      build(testCase.body),
      error => error.code === testCase.code
    );
  }
});

test('mesmo conteúdo comercial produz fingerprint estável', async () => {
  const first = await build();
  const second = await build();

  assert.equal(first.command.fingerprint, second.command.fingerprint);
  assert.equal(first.command.idempotencyKey, second.command.idempotencyKey);
  assert.equal(Object.isFrozen(first.command), true);
  assert.equal(Object.isFrozen(first.command.preparedOrder), true);
});

test('submissão usa chave real derivada e metadados de staging sem expor a chave bruta', async () => {
  const rawKey = 'checkout-real-attempt-000000000001';
  const result = await build(body(), {
    idempotencyKey: rawKey,
    source: 'catalog-v2-staging-accepted-synthetic',
    actor: 'staging-checkout-synthetic',
    dryRun: false
  });

  assert.equal(result.dryRun, false);
  assert.match(result.command.idempotencyKey, /^idempotency:v2:[a-f0-9]{64}$/);
  assert.notEqual(result.command.idempotencyKey, rawKey);
  assert.equal(result.command.preparedOrder.source, 'catalog-v2-staging-accepted-synthetic');
  assert.equal(result.command.actor, 'staging-checkout-synthetic');
  assert.equal(JSON.stringify(result.summary).includes(rawKey), false);
  assert.equal(JSON.stringify(result.summary).includes(result.command.idempotencyKey), false);
});
