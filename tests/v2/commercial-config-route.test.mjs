import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_COMMERCIAL_CONFIG, commercialConfigUpdatePayload } from '../../src/v2/products/commercial-config.mjs';
import {
  handleAdminCommercialConfig,
  handlePublicCommercialConfig,
  loadActiveCommercialConfig
} from '../../staging/site-v2-worker/src/commercial-config-route.js';

function fixture() {
  let current = DEFAULT_COMMERCIAL_CONFIG;
  const history = [{ version: 1, actor: 'system-default', requestId: 'initial', createdAt: '2026-07-30T12:00:00.000Z' }];
  const stub = {
    async getCommercialConfig() { return current; },
    async listCommercialConfigHistory(limit) { return history.slice(0, limit); },
    async updateCommercialConfig(input) {
      if (input.expectedVersion !== current.version) {
        const error = new Error('COMMERCIAL_CONFIG_VERSION_CONFLICT');
        error.code = 'COMMERCIAL_CONFIG_VERSION_CONFLICT';
        error.currentVersion = current.version;
        throw error;
      }
      current = commercialConfigUpdatePayload(current, input.config, {
        version: current.version + 1,
        updatedAt: input.updatedAt,
        updatedBy: input.actor
      });
      history.unshift({ version: current.version, actor: input.actor, requestId: input.requestId, createdAt: input.updatedAt });
      return current;
    }
  };
  return {
    env: { ORDER_LEDGER: { getByName(name) { assert.equal(name, 'commercial-config-v1'); return stub; } } },
    current: () => current
  };
}

test('rota pública expõe somente configuração sanitizada', async () => {
  const { env } = fixture();
  const response = await handlePublicCommercialConfig(
    new Request('https://staging.example/api/commercial-config'), env, 'public-config'
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.requestId, 'public-config');
  assert.equal(payload.config.version, 1);
  assert.deepEqual(Object.keys(payload.config.products), ['50x50', 'painel-150']);
  assert.equal(payload.config.products['50x50'].unitPrice, 9.75);
  assert.equal(response.headers.get('etag'), '"commercial-config-v1"');
  assert.equal(Object.hasOwn(payload.config, 'updatedBy'), false);
  assert.equal(Object.hasOwn(payload.config, 'actor'), false);
  assert.equal(Object.hasOwn(payload.config, 'requestId'), false);
  assert.equal(JSON.stringify(payload.config).includes('system-default'), false);
});

test('rota administrativa atualiza com expectedVersion e rejeita versão obsoleta', async () => {
  const { env } = fixture();
  const body = {
    expectedVersion: 1,
    config: {
      products: {
        '50x50': { unitPrice: 10.25, minimum: 6, step: 2, initialQuantity: 6 },
        'painel-150': { unitPrice: 65, minimum: 1, step: 1, initialQuantity: 1 }
      }
    }
  };
  const update = await handleAdminCommercialConfig(new Request(
    'https://staging.example/internal/v2/admin/commercial-config',
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  ), env, 'admin-update');
  const updated = await update.json();

  assert.equal(update.status, 200);
  assert.equal(updated.config.version, 2);
  assert.equal(updated.config.products['50x50'].unitPrice, 10.25);

  const stale = await handleAdminCommercialConfig(new Request(
    'https://staging.example/internal/v2/admin/commercial-config',
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  ), env, 'admin-stale');
  const stalePayload = await stale.json();
  assert.equal(stale.status, 409);
  assert.equal(stalePayload.error, 'COMMERCIAL_CONFIG_VERSION_CONFLICT');
  assert.equal(stalePayload.currentVersion, 2);
});

test('loader produz snapshot de cálculo na mesma versão', async () => {
  const { env } = fixture();
  const loaded = await loadActiveCommercialConfig(env, { catalogVersion: 49 });
  assert.equal(loaded.config.version, 1);
  assert.equal(loaded.productSnapshot.metadata.configVersion, 1);
  assert.equal(loaded.productSnapshot.metadata.catalogVersion, 49);
});
