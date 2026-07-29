import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { handleAcceptedCheckoutSubmit } from '../../staging/site-v2-worker/src/accepted-checkout-submit-route.js';

const URL = 'https://staging.example/internal/v2/checkout/submit';
const requestId = 'checkout-submit-route-test';

function request(body, options = {}) {
  const headers = new Headers({
    'content-type': 'application/json',
    'idempotency-key': options.idempotencyKey || 'checkout-submit-attempt-000000000001',
    ...(options.headers || {})
  });
  return new Request(URL, {
    method: options.method || 'POST',
    headers,
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
  });
}

function validBody(overrides = {}) {
  return {
    submissionCreatedAt: new Date().toISOString(),
    seller: { id: 'seller-test', label: 'Vendedora Teste' },
    customer: {
      name: 'Cliente Privado',
      whatsapp: '81999999999',
      phone: '81988887777'
    },
    items: [{
      driveFileId: 'private-artwork-id',
      productKey: '50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6,
      observations: 'Conteúdo privado'
    }],
    ...overrides
  };
}

function pipelineOptions(ledger, extra = {}) {
  return {
    ledger,
    resolveItems: async ids => ({
      catalogVersion: 49,
      items: ids.map(id => ({ driveFileId: id, productKey: '50x50' }))
    }),
    validateItems: items => ({
      itemCount: items.length,
      items: items.map(item => ({
        itemId: `${item.driveFileId}:50x50:default:50x50`,
        driveFileId: item.driveFileId,
        productKey: '50x50',
        variantKey: 'default',
        sizeKey: '50x50',
        quantity: item.quantity,
        details: { observations: item.observations }
      }))
    }),
    priceDraft: ({ resolved, validated }) => ({
      authoritative: true,
      warnings: ['CLIENT_ITEM_PRICE_IGNORED'],
      quote: {
        items: validated.items.map(item => ({
          ...item,
          unitPrice: 9.75,
          lineSubtotal: 58.5
        })),
        pricing: {
          currency: 'BRL',
          subtotal: 58.5,
          discountPercent: 0,
          discountAmount: 0,
          total: 58.5,
          calculationVersion: 1
        },
        integrity: { catalogVersion: resolved.catalogVersion }
      }
    }),
    prepareDraft: async input => {
      assert.equal(input.idempotencyKey.length >= 16, true);
      assert.equal(input.source, 'catalog-v2-staging-accepted-synthetic');
      assert.equal(input.actor, 'staging-checkout-synthetic');
      assert.equal(input.dryRun, false);
      return {
        command: {
          idempotencyKey: `idempotency:v2:${'a'.repeat(64)}`,
          fingerprint: extra.fingerprint || 'b'.repeat(64),
          submissionCreatedAt: input.submissionCreatedAt,
          requestId: input.requestId,
          actor: input.actor,
          preparedOrder: {
            schemaVersion: 2,
            status: 'Novo',
            seller: { id: 'seller-test', label: 'Vendedora Teste' },
            customer: {
              name: 'Cliente Privado',
              whatsapp: '81999999999',
              phone: '81988887777'
            },
            items: [{
              itemId: 'private-artwork-id:50x50:default:50x50',
              driveFileId: 'private-artwork-id',
              productKey: '50x50',
              variantKey: 'default',
              sizeKey: '50x50',
              quantity: 6,
              unitPrice: 9.75,
              lineSubtotal: 58.5,
              details: { observations: 'Conteúdo privado' }
            }],
            qty: 6,
            pricing: {
              currency: 'BRL',
              subtotal: 58.5,
              discountPercent: 0,
              discountAmount: 0,
              total: 58.5,
              calculationVersion: 1
            },
            integrity: { catalogVersion: 49 }
          }
        }
      };
    },
    ...extra
  };
}

function memoryLedger() {
  const records = new Map();
  let sequence = 120;
  return {
    async submit(command) {
      const existing = records.get(command.idempotencyKey);
      if (existing) {
        if (existing.fingerprint !== command.fingerprint) {
          const error = new Error('IDEMPOTENCY_KEY_CONFLICT');
          error.code = 'IDEMPOTENCY_KEY_CONFLICT';
          throw error;
        }
        return {
          action: 'REPLAY',
          replayed: true,
          orderNumber: existing.orderNumber,
          order: existing.order
        };
      }

      sequence += 1;
      const orderNumber = `PED26${String(sequence).padStart(5, '0')}A`;
      const order = {
        ...command.preparedOrder,
        orderNumber,
        orderCode: orderNumber,
        displayId: orderNumber
      };
      records.set(command.idempotencyKey, {
        fingerprint: command.fingerprint,
        orderNumber,
        order
      });
      return { action: 'CREATED', replayed: false, orderNumber, order };
    }
  };
}

async function payload(response) {
  return response.json();
}

test('aceita somente POST JSON com chave e data de tentativa válidas', async () => {
  const getResponse = await handleAcceptedCheckoutSubmit(
    request(undefined, { method: 'GET' }),
    {},
    requestId
  );
  assert.equal(getResponse.status, 405);

  const textResponse = await handleAcceptedCheckoutSubmit(
    request('{}', { headers: { 'content-type': 'text/plain' } }),
    {},
    requestId
  );
  assert.equal(textResponse.status, 415);

  const shortKey = await handleAcceptedCheckoutSubmit(
    request(validBody(), { idempotencyKey: 'curta' }),
    {},
    requestId
  );
  assert.equal(shortKey.status, 422);
  assert.equal((await payload(shortKey)).error, 'IDEMPOTENCY_KEY_INVALID');

  const missingDate = await handleAcceptedCheckoutSubmit(
    request(validBody({ submissionCreatedAt: '' })),
    {},
    requestId
  );
  assert.equal(missingDate.status, 422);
  assert.equal((await payload(missingDate)).error, 'SUBMISSION_CREATED_AT_INVALID');
});

test('cria uma vez e reproduz o mesmo pedido com a mesma tentativa', async () => {
  const ledger = memoryLedger();
  const committed = [];
  const options = pipelineOptions(ledger, {
    onOrderCommitted(payload) {
      committed.push(payload);
    }
  });
  const body = validBody();

  const createdResponse = await handleAcceptedCheckoutSubmit(
    request(body),
    {},
    requestId,
    options
  );
  const replayResponse = await handleAcceptedCheckoutSubmit(
    request(body),
    {},
    requestId,
    options
  );

  assert.equal(createdResponse.status, 201);
  assert.equal(replayResponse.status, 200);
  const created = await payload(createdResponse);
  const replay = await payload(replayResponse);

  assert.equal(created.action, 'CREATED');
  assert.equal(created.replayed, false);
  assert.equal(replay.action, 'REPLAY');
  assert.equal(replay.replayed, true);
  assert.equal(created.orderNumber, replay.orderNumber);
  assert.match(created.orderNumber, /^PED26\d{5}A$/);
  assert.equal(created.pricing.total, 58.5);
  assert.equal(created.catalogVersion, 49);
  assert.equal(created.canonicalDetailsPreserved, true);
  assert.equal(created.customerPreserved, true);
  assert.equal(created.sellerPreserved, true);
  assert.equal(committed.length, 2);
  assert.equal(committed[0].result.action, 'CREATED');
  assert.equal(committed[1].result.action, 'REPLAY');

  for (const responsePayload of [created, replay]) {
    const serialized = JSON.stringify(responsePayload);
    assert.equal(serialized.includes('Cliente Privado'), false);
    assert.equal(serialized.includes('81999999999'), false);
    assert.equal(serialized.includes('private-artwork-id'), false);
    assert.equal(serialized.includes('Conteúdo privado'), false);
    assert.equal(serialized.includes('idempotency:v2:'), false);
  }
});

test('mesma chave com fingerprint diferente retorna conflito 409', async () => {
  const ledger = memoryLedger();
  const firstOptions = pipelineOptions(ledger, { fingerprint: 'b'.repeat(64) });
  const conflictingOptions = pipelineOptions(ledger, { fingerprint: 'c'.repeat(64) });
  const body = validBody();

  const created = await handleAcceptedCheckoutSubmit(
    request(body),
    {},
    requestId,
    firstOptions
  );
  assert.equal(created.status, 201);

  const conflict = await handleAcceptedCheckoutSubmit(
    request(body),
    {},
    requestId,
    conflictingOptions
  );
  assert.equal(conflict.status, 409);
  assert.deepEqual(await payload(conflict), {
    ok: false,
    error: 'IDEMPOTENCY_KEY_CONFLICT',
    requestId
  });
});

test('entrypoint exige token antes de alcançar a submissão', async () => {
  const entrypoint = await readFile('staging/site-v2-worker/src/index-shadow.js', 'utf8');
  const routeIndex = entrypoint.indexOf("url.pathname === CHECKOUT_SUBMIT_ROUTE");
  const tokenIndex = entrypoint.indexOf('constantTimeEqualSecrets', routeIndex);
  const handlerIndex = entrypoint.indexOf('handleAcceptedCheckoutSubmit(request, env, requestId', routeIndex);

  assert.match(entrypoint, /const CHECKOUT_SUBMIT_ROUTE = '\/internal\/v2\/checkout\/submit';/);
  assert.ok(routeIndex >= 0);
  assert.ok(tokenIndex > routeIndex);
  assert.ok(handlerIndex > tokenIndex);
  assert.match(entrypoint.slice(routeIndex, handlerIndex), /STAGING_TOKEN_INVALID/);
  assert.match(entrypoint.slice(handlerIndex), /scheduleSupabaseShadowProjection/);
});
