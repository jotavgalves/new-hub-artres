import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { handleCheckoutValidationPreview } from '../../staging/site-v2-worker/src/checkout-validation-preview-route.js';

const URL = 'https://staging.example/internal/v2/checkout/validate';
const requestId = 'checkout-validation-test';

function request(options = {}) {
  const headers = new Headers(options.headers || {});
  const body = options.body;
  return new Request(URL, {
    method: options.method || 'POST',
    headers,
    ...(body !== undefined ? { body } : {})
  });
}

async function payload(response) {
  return response.json();
}

test('aceita somente POST JSON', async () => {
  const getResponse = await handleCheckoutValidationPreview(
    request({ method: 'GET' }),
    {},
    requestId
  );
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get('allow'), 'POST');

  const textResponse = await handleCheckoutValidationPreview(
    request({ headers: { 'content-type': 'text/plain' }, body: '{}' }),
    {},
    requestId
  );
  assert.equal(textResponse.status, 415);
  assert.equal((await payload(textResponse)).error, 'CONTENT_TYPE_NOT_JSON');
});

test('rejeita corpo excessivo e JSON inválido antes das dependências', async () => {
  let calls = 0;
  const options = {
    resolveItems: async () => {
      calls += 1;
      return {};
    }
  };

  const oversized = await handleCheckoutValidationPreview(
    request({
      headers: {
        'content-type': 'application/json',
        'content-length': String(128 * 1024 + 1)
      },
      body: '{}'
    }),
    {},
    requestId,
    options
  );
  assert.equal(oversized.status, 413);
  assert.equal((await payload(oversized)).error, 'REQUEST_BODY_TOO_LARGE');

  const invalid = await handleCheckoutValidationPreview(
    request({ headers: { 'content-type': 'application/json' }, body: '{' }),
    {},
    requestId,
    options
  );
  assert.equal(invalid.status, 400);
  assert.equal((await payload(invalid)).error, 'INVALID_JSON');
  assert.equal(calls, 0);
});

test('resolve valida precifica e prepara comando sem escrita ou exposição de dados', async () => {
  let receivedIds;
  let receivedItems;
  let pricingInput;
  let draftInput;
  const response = await handleCheckoutValidationPreview(
    request({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seller: { id: 'vendedora-1', label: 'Ana' },
        customer: { name: 'Cliente que não pode aparecer', whatsapp: '81999999999' },
        total: 0.01,
        items: [{
          driveFileId: 'arquivo-secreto-001',
          productKey: '50x50',
          variantKey: 'default',
          sizeKey: '50x50',
          quantity: 6,
          unitPrice: 0.01,
          observacoes: 'Não pode aparecer'
        }]
      })
    }),
    {},
    requestId,
    {
      resolveItems: async ids => {
        receivedIds = ids;
        return {
          catalogVersion: 49,
          items: [{ driveFileId: 'arquivo-secreto-001', productKey: '50x50' }]
        };
      },
      validateItems: (items, catalogItems) => {
        receivedItems = { items, catalogItems };
        return {
          itemCount: 1,
          productKeys: ['50x50'],
          variantKeys: ['default'],
          sizeKeys: ['50x50'],
          items: [{
            itemId: 'arquivo-secreto-001:50x50:default:50x50',
            driveFileId: 'arquivo-secreto-001',
            productKey: '50x50',
            variantKey: 'default',
            sizeKey: '50x50',
            quantity: 6,
            details: { observations: 'Não pode aparecer' }
          }]
        };
      },
      priceDraft: input => {
        pricingInput = input;
        return {
          authoritative: true,
          quote: {
            items: [{
              driveFileId: 'arquivo-secreto-001',
              productKey: '50x50',
              variantKey: 'default',
              sizeKey: '50x50',
              quantity: 6,
              unitPrice: 9.75,
              lineSubtotal: 58.5,
              details: { observations: 'Não pode aparecer' }
            }],
            pricing: { discountPercent: 0 }
          },
          summary: {
            currency: 'BRL',
            itemCount: 1,
            quantity: 6,
            subtotal: 58.5,
            discountPercent: 0,
            discountAmount: 0,
            total: 58.5,
            catalogVersion: 49,
            configVersion: 9001,
            clientValuesIgnored: true
          },
          warnings: ['CLIENT_ITEM_PRICE_IGNORED', 'CLIENT_ORDER_TOTALS_IGNORED']
        };
      },
      prepareDraft: async input => {
        draftInput = input;
        return {
          ok: true,
          summary: {
            schemaVersion: 2,
            status: 'Novo',
            sellerPresent: true,
            sellerLabelPresent: true,
            customerNamePresent: true,
            customerWhatsappPresent: true,
            customerPhonePresent: true,
            itemCount: 1,
            quantity: 6,
            pricing: {
              currency: 'BRL',
              subtotal: 58.5,
              discountPercent: 0,
              discountAmount: 0,
              total: 58.5,
              calculationVersion: 1
            },
            catalogVersion: 49,
            configVersion: 9001,
            detailsItemCount: 1,
            measurementsItemCount: 0,
            observationsItemCount: 1,
            personalizationItemCount: 0,
            canonicalFingerprintReady: true,
            idempotencyStorageKeyReady: true
          }
        };
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(receivedIds, ['arquivo-secreto-001']);
  assert.equal(receivedItems.items[0].quantity, 6);
  assert.equal(receivedItems.catalogItems.length, 1);
  assert.equal(pricingInput.body.total, 0.01);
  assert.equal(pricingInput.resolved.catalogVersion, 49);
  assert.equal(pricingInput.validated.itemCount, 1);
  assert.equal(draftInput.requestId, requestId);
  assert.equal(draftInput.priced.authoritative, true);

  const result = await payload(response);
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.writesPerformed, false);
  assert.equal(result.authoritativePricing, true);
  assert.equal(result.canonicalDraftReady, true);
  assert.equal(result.orderDraft.customerNamePresent, true);
  assert.equal(result.orderDraft.sellerPresent, true);
  assert.equal(result.orderDraft.observationsItemCount, 1);
  assert.equal(result.pricing.total, 58.5);
  assert.deepEqual(result.warnings, ['CLIENT_ITEM_PRICE_IGNORED', 'CLIENT_ORDER_TOTALS_IGNORED']);

  const text = JSON.stringify(result);
  assert.equal(text.includes('arquivo-secreto-001'), false);
  assert.equal(text.includes('Cliente que não pode aparecer'), false);
  assert.equal(text.includes('Não pode aparecer'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
});

test('erros de contrato preservam apenas código e índice', async () => {
  const response = await handleCheckoutValidationPreview(
    request({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ driveFileId: 'arquivo-secreto-002' }] })
    }),
    {},
    requestId,
    {
      resolveItems: async () => ({ catalogVersion: 49, items: [] }),
      validateItems: () => {
        const error = new Error('ARTWORK_PRODUCT_MISMATCH');
        error.code = 'ARTWORK_PRODUCT_MISMATCH';
        error.itemIndex = 0;
        throw error;
      }
    }
  );

  assert.equal(response.status, 422);
  const result = await payload(response);
  assert.deepEqual(result, {
    ok: false,
    error: 'ARTWORK_PRODUCT_MISMATCH',
    requestId,
    itemIndex: 0
  });
  assert.equal(JSON.stringify(result).includes('arquivo-secreto-002'), false);
});

test('erro de quantidade calculado pelo servidor retorna somente código público', async () => {
  const response = await handleCheckoutValidationPreview(
    request({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ driveFileId: 'arquivo-secreto-003', quantity: 7 }] })
    }),
    {},
    requestId,
    {
      resolveItems: async () => ({ catalogVersion: 49, items: [{}] }),
      validateItems: () => ({ itemCount: 1, productKeys: [], variantKeys: [], sizeKeys: [], items: [{}] }),
      priceDraft: () => {
        const error = new Error('ORDER_QUANTITY_RULES_INVALID');
        error.code = 'ORDER_QUANTITY_RULES_INVALID';
        error.details = [{ itemId: 'arquivo-secreto-003' }];
        throw error;
      }
    }
  );

  assert.equal(response.status, 422);
  const result = await payload(response);
  assert.deepEqual(result, {
    ok: false,
    error: 'ORDER_QUANTITY_RULES_INVALID',
    requestId
  });
  assert.equal(JSON.stringify(result).includes('arquivo-secreto-003'), false);
});

test('entrypoint protege a rota interna com token antes do handler', async () => {
  const entrypoint = await readFile('staging/site-v2-worker/src/index-shadow.js', 'utf8');
  const routeIndex = entrypoint.indexOf("url.pathname === CHECKOUT_VALIDATION_ROUTE");
  const tokenIndex = entrypoint.indexOf('constantTimeEqualSecrets', routeIndex);
  const handlerIndex = entrypoint.indexOf('handleCheckoutValidationPreview(request, env, requestId)', routeIndex);

  assert.match(entrypoint, /const CHECKOUT_VALIDATION_ROUTE = '\/internal\/v2\/checkout\/validate';/);
  assert.ok(routeIndex >= 0);
  assert.ok(tokenIndex > routeIndex);
  assert.ok(handlerIndex > tokenIndex);
  assert.match(entrypoint.slice(routeIndex, handlerIndex), /STAGING_TOKEN_INVALID/);
});
