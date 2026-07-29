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

test('resolve o catálogo e devolve somente resumo sem escrita', async () => {
  let receivedIds;
  let receivedItems;
  const response = await handleCheckoutValidationPreview(
    request({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customer: { name: 'Cliente que não pode aparecer' },
        items: [{
          driveFileId: 'arquivo-secreto-001',
          productKey: '50x50',
          variantKey: 'default',
          sizeKey: '50x50',
          quantity: 6
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
          sizeKeys: ['50x50']
        };
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(receivedIds, ['arquivo-secreto-001']);
  assert.equal(receivedItems.items[0].quantity, 6);
  assert.equal(receivedItems.catalogItems.length, 1);

  const result = await payload(response);
  assert.deepEqual(result, {
    ok: true,
    dryRun: true,
    writesPerformed: false,
    requestId,
    catalogVersion: 49,
    itemCount: 1,
    productKeys: ['50x50'],
    variantKeys: ['default'],
    sizeKeys: ['50x50']
  });

  const text = JSON.stringify(result);
  assert.equal(text.includes('arquivo-secreto-001'), false);
  assert.equal(text.includes('Cliente que não pode aparecer'), false);
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
