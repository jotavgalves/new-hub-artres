import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptedCatalogCheckoutResolverStatus,
  resolveAcceptedCatalogCheckoutItems
} from '../../staging/site-v2-worker/src/accepted-catalog-checkout-resolver.js';

const SECRET = 'service-role-key-for-checkout-tests-000000000000';
const ENV = {
  CATALOG_ACCEPTED_ENABLED: 'true',
  SUPABASE_V2_URL: 'https://staging-project.supabase.co',
  SUPABASE_V2_SERVICE_ROLE_KEY: SECRET,
  CATALOG_ACCEPTED_TIMEOUT_MS: '5000'
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('status exige flag e credencial exclusivamente no servidor', () => {
  assert.deepEqual(acceptedCatalogCheckoutResolverStatus({}), {
    enabled: false,
    configured: false,
    source: 'catalog-v2-accepted-checkout'
  });
  assert.deepEqual(acceptedCatalogCheckoutResolverStatus(ENV), {
    enabled: true,
    configured: true,
    source: 'catalog-v2-accepted-checkout'
  });
});

test('rejeita lista vazia, excessiva e ID inválido antes da rede', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return response({});
  };

  await assert.rejects(
    resolveAcceptedCatalogCheckoutItems([], ENV, { fetch }),
    error => error.code === 'ORDER_ITEMS_REQUIRED'
  );
  await assert.rejects(
    resolveAcceptedCatalogCheckoutItems(Array.from({ length: 201 }, (_, index) => `file-${index}`), ENV, { fetch }),
    error => error.code === 'ORDER_ITEMS_LIMIT_EXCEEDED'
  );
  await assert.rejects(
    resolveAcceptedCatalogCheckoutItems([''], ENV, { fetch }),
    error => error.code === 'DRIVE_FILE_ID_INVALID'
  );
  assert.equal(calls, 0);
});

test('deduplica IDs para a RPC e devolve itens canônicos congelados', async () => {
  let sentBody;
  let sentUrl;
  let receiver;
  const fetch = async function (url, init) {
    receiver = this;
    sentUrl = url;
    sentBody = JSON.parse(init.body);
    assert.equal(init.headers.apikey, SECRET);
    assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
    return response({
      ok: true,
      catalogVersion: 49,
      requestedCount: 2,
      requestedUniqueCount: 2,
      resolvedCount: 2,
      items: [
        {
          id: 'file-2',
          code: '0002',
          originalName: '0002_TEMA.png',
          theme: 'Tema',
          product: '50x50',
          productName: 'Bolinhas 50x50',
          size: '50x50'
        },
        {
          driveFileId: 'file-1',
          code: '0001',
          originalName: '0001_TEMA.png',
          theme: 'Tema',
          productKey: '50x50',
          productName: 'Bolinhas 50x50',
          sizeKey: '50x50'
        }
      ]
    });
  };

  const result = await resolveAcceptedCatalogCheckoutItems(
    ['file-2', 'file-1', 'file-2'],
    ENV,
    { fetch }
  );

  assert.equal(receiver, globalThis);
  assert.equal(sentUrl, 'https://staging-project.supabase.co/rest/v1/rpc/armazem_v2_catalog_checkout_items_v1');
  assert.deepEqual(sentBody, { p_drive_file_ids: ['file-2', 'file-1'] });
  assert.equal(result.catalogVersion, 49);
  assert.equal(result.requestedCount, 3);
  assert.equal(result.requestedUniqueCount, 2);
  assert.equal(result.resolvedCount, 2);
  assert.deepEqual(result.items.map(item => item.driveFileId), ['file-2', 'file-1']);
  assert.equal(result.items[0].productKey, '50x50');
  assert.equal(result.items[0].sizeKey, '50x50');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.items[0]), true);
});

test('falha de resolução não expõe o ID ausente na mensagem', async () => {
  const fetch = async () => response({
    ok: true,
    catalogVersion: 49,
    requestedCount: 2,
    requestedUniqueCount: 2,
    resolvedCount: 1,
    items: [{
      driveFileId: 'file-present',
      productKey: '50x50',
      code: '0001',
      sizeKey: '50x50'
    }]
  });

  await assert.rejects(
    resolveAcceptedCatalogCheckoutItems(['file-present', 'file-secret-missing'], ENV, { fetch }),
    error => {
      assert.equal(error.code, 'ARTWORK_NOT_FOUND');
      assert.equal(error.missingCount, 1);
      assert.equal(error.message.includes('file-secret-missing'), false);
      return true;
    }
  );
});

test('rejeita item não solicitado, duplicado ou sem produto', async () => {
  const cases = [
    {
      payload: {
        ok: true,
        catalogVersion: 49,
        requestedUniqueCount: 1,
        resolvedCount: 1,
        items: [{ driveFileId: 'other-file', productKey: '50x50' }]
      },
      code: 'CATALOG_CHECKOUT_UNREQUESTED_ITEM'
    },
    {
      payload: {
        ok: true,
        catalogVersion: 49,
        requestedUniqueCount: 1,
        resolvedCount: 2,
        items: [
          { driveFileId: 'file-1', productKey: '50x50' },
          { driveFileId: 'file-1', productKey: '50x50' }
        ]
      },
      code: 'CATALOG_CHECKOUT_DUPLICATED_ITEM'
    },
    {
      payload: {
        ok: true,
        catalogVersion: 49,
        requestedUniqueCount: 1,
        resolvedCount: 1,
        items: [{ driveFileId: 'file-1' }]
      },
      code: 'CATALOG_PRODUCT_NOT_CONFIGURED'
    }
  ];

  for (const testCase of cases) {
    await assert.rejects(
      resolveAcceptedCatalogCheckoutItems(
        ['file-1'],
        ENV,
        { fetch: async () => response(testCase.payload) }
      ),
      error => error.code === testCase.code
    );
  }
});

test('mapeia falhas remotas para códigos públicos sanitizados', async () => {
  await assert.rejects(
    resolveAcceptedCatalogCheckoutItems(
      ['file-1'],
      ENV,
      {
        fetch: async () => response({
          message: `erro remoto contendo ${SECRET}`
        }, 500)
      }
    ),
    error => {
      assert.equal(error.code, 'CATALOG_CHECKOUT_RPC_500');
      assert.equal(error.message.includes(SECRET), false);
      return true;
    }
  );
});
