import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCatalogBridgeActive } from '../../scripts/catalog-v2/wait-for-staging-catalog-bridge-active.mjs';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('aguarda versões antigas até a ponte ativa ficar visível', async () => {
  let calls = 0;
  const sleeps = [];
  const result = await waitForCatalogBridgeActive({
    stagingUrl: 'https://staging.example.com',
    maxAttempts: 5,
    intervalMs: 100,
    sleep: async ms => sleeps.push(ms),
    fetch: async function(url, init) {
      assert.equal(this, globalThis);
      calls += 1;
      assert.equal(new URL(url).pathname, '/health');
      assert.equal(init.method, 'GET');
      assert.deepEqual(init.headers, { Accept: 'application/json' });
      if (calls < 3) {
        return jsonResponse({
          ok: true,
          catalogReadonlyBridge: { enabled: false, configured: false }
        });
      }
      return jsonResponse({
        ok: true,
        catalogReadonlyBridge: { enabled: true, configured: true }
      });
    }
  });

  assert.deepEqual(result, {
    ok: true,
    active: true,
    configured: true,
    attempts: 3
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [100, 100]);
});

test('tolera falha transitória de rede sem expor detalhes', async () => {
  let calls = 0;
  const result = await waitForCatalogBridgeActive({
    stagingUrl: 'https://staging.example.com',
    maxAttempts: 3,
    intervalMs: 100,
    sleep: async () => {},
    fetch: async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket with sensitive details');
      return jsonResponse({
        ok: true,
        catalogReadonlyBridge: { enabled: true, configured: true }
      });
    }
  });

  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});

test('encerra com código genérico após o limite de tentativas', async () => {
  let calls = 0;
  await assert.rejects(
    waitForCatalogBridgeActive({
      stagingUrl: 'https://staging.example.com',
      maxAttempts: 3,
      intervalMs: 100,
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        return jsonResponse({
          ok: true,
          catalogReadonlyBridge: { enabled: false, configured: false }
        });
      }
    }),
    error => {
      assert.equal(error?.code, 'CATALOG_BRIDGE_ACTIVATION_TIMEOUT');
      assert.equal(error?.lastState, 'disabled');
      assert.equal(error?.attempts, 3);
      assert.equal(String(error).includes('staging.example.com'), false);
      return true;
    }
  );
  assert.equal(calls, 3);
});
