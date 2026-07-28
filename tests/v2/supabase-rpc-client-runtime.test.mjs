import test from 'node:test';
import assert from 'node:assert/strict';

import { SupabaseRpcClient } from '../../src/v2/persistence/supabase-rpc-client.mjs';

const serviceKey = `sb_secret_${'a'.repeat(56)}`;

test('cliente RPC não chama fetch como método da própria instância', async () => {
  let receiver;
  let requestedUrl = '';

  function receiverSensitiveFetch(url) {
    receiver = this;
    requestedUrl = String(url);
    if (receiver !== globalThis) throw new TypeError('ILLEGAL_FETCH_RECEIVER');

    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      action: 'CREATED',
      replayed: false,
      orderNumber: 'PED2600001A'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
  }

  const client = new SupabaseRpcClient({
    url: 'https://kueklnkznwpbobqwugns.supabase.co',
    serviceKey,
    fetch: receiverSensitiveFetch,
    timeoutMs: 1000
  });

  const result = await client.call('armazem_v2_project_order_v1', {
    p_projection: { contractVersion: 1 }
  });

  assert.equal(receiver, globalThis);
  assert.equal(
    requestedUrl,
    'https://kueklnkznwpbobqwugns.supabase.co/rest/v1/rpc/armazem_v2_project_order_v1'
  );
  assert.equal(result.ok, true);
  assert.equal(result.orderNumber, 'PED2600001A');
});

test('cliente RPC continua limitando e sanitizando falhas remotas', async () => {
  const client = new SupabaseRpcClient({
    url: 'https://kueklnkznwpbobqwugns.supabase.co',
    serviceKey,
    fetch: async () => new Response(JSON.stringify({
      code: '42501',
      message: `negado ${serviceKey}`
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    })
  });

  await assert.rejects(
    client.call('armazem_v2_project_order_v1', { p_projection: {} }),
    error => {
      assert.equal(error?.code, 'SUPABASE_RPC_REQUEST_FAILED');
      assert.equal(error?.status, 403);
      assert.equal(error?.remoteCode, '42501');
      assert.equal(error?.remoteMessage.includes(serviceKey), false);
      assert.equal(error?.remoteMessage.includes('[REDACTED]'), true);
      return true;
    }
  );
});
