import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProjectionEventKey,
  SupabaseOrderProjection
} from '../../src/v2/persistence/supabase-order-projection.mjs';

function createdEvent(overrides = {}) {
  return {
    id: 1,
    eventType: 'order.created.v2',
    aggregateId: 'PED2600001A',
    status: 'pending',
    createdAt: '2026-07-26T21:00:00.000Z',
    payload: {
      schemaVersion: 1,
      orderNumber: 'PED2600001A',
      order: {
        schemaVersion: 2,
        orderNumber: 'PED2600001A',
        orderCode: 'PED2600001A',
        displayId: 'PED2600001A',
        createdAt: '2026-07-26T21:00:00.000Z',
        updatedAt: '2026-07-26T21:00:00.000Z',
        status: 'Novo',
        items: [],
        pricing: { currency: 'BRL', subtotal: 58.5, total: 58.5 }
      }
    },
    ...overrides
  };
}

function fakeResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return payload === undefined ? '' : JSON.stringify(payload);
    }
  };
}

test('chave global do evento inclui tipo, pedido e ID local', () => {
  assert.equal(
    createProjectionEventKey(createdEvent()),
    'order.created.v2:PED2600001A:1'
  );
  assert.equal(
    createProjectionEventKey(createdEvent({ id: 1, aggregateId: 'PED2700001A' })),
    'order.created.v2:PED2700001A:1'
  );
});

test('projeção de criação usa uma única RPC com chave secreta no servidor', async () => {
  const calls = [];
  const secret = 'service-secret-key-0123456789abcdef';
  const projection = new SupabaseOrderProjection({
    url: 'https://project-ref.supabase.co',
    serviceKey: secret,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse(200, {
        action: 'PROJECTED',
        order_number: 'PED2600001A'
      });
    }
  });

  const result = await projection.projectOrderCreated(createdEvent());

  assert.deepEqual(result, {
    action: 'PROJECTED',
    projected: true,
    orderNumber: 'PED2600001A'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://project-ref.supabase.co/rest/v1/rpc/project_order_created_v2');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.apikey, secret);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(calls[0].options.headers['Content-Profile'], 'public');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.p_event_key, 'order.created.v2:PED2600001A:1');
  assert.equal(body.p_order_number, 'PED2600001A');
  assert.equal(body.p_order.orderNumber, 'PED2600001A');
});

test('resposta booleana false é tratada como replay idempotente', async () => {
  const projection = new SupabaseOrderProjection({
    url: 'https://project-ref.supabase.co/rest/v1',
    serviceKey: 'service-secret-key-0123456789abcdef',
    fetch: async () => fakeResponse(200, false)
  });

  assert.deepEqual(await projection.projectOrderCreated(createdEvent()), {
    action: 'REPLAY',
    projected: false
  });
});

test('projeção de status usa RPC separada', async () => {
  const calls = [];
  const projection = new SupabaseOrderProjection({
    url: 'https://project-ref.supabase.co',
    serviceKey: 'service-secret-key-0123456789abcdef',
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse(200, { action: 'PROJECTED', order_number: 'PED2600001A' });
    }
  });

  const result = await projection.projectOrderStatusChanged({
    id: 2,
    eventType: 'order.status-changed.v2',
    aggregateId: 'PED2600001A',
    createdAt: '2026-07-26T21:05:00.000Z',
    status: 'pending',
    payload: {
      status: 'Separado',
      updatedAt: '2026-07-26T21:05:00.000Z'
    }
  });

  assert.equal(result.action, 'PROJECTED');
  assert.equal(calls[0].url, 'https://project-ref.supabase.co/rest/v1/rpc/project_order_status_changed_v2');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.p_event_key, 'order.status-changed.v2:PED2600001A:2');
  assert.equal(body.p_status, 'Separado');
});

test('health sem probe não faz chamada externa', async () => {
  let calls = 0;
  const projection = new SupabaseOrderProjection({
    url: 'https://project-ref.supabase.co',
    serviceKey: 'service-secret-key-0123456789abcdef',
    fetch: async () => {
      calls += 1;
      return fakeResponse(200, { ok: true });
    }
  });

  const result = await projection.health();
  assert.equal(result.ok, true);
  assert.equal(result.probed, false);
  assert.equal(calls, 0);
});

test('health com probe usa função específica', async () => {
  const calls = [];
  const projection = new SupabaseOrderProjection({
    url: 'https://project-ref.supabase.co',
    serviceKey: 'service-secret-key-0123456789abcdef',
    fetch: async (url) => {
      calls.push(url);
      return fakeResponse(200, { ok: true, schema_version: 1 });
    }
  });

  const result = await projection.health({ probe: true });
  assert.equal(result.ok, true);
  assert.equal(result.probed, true);
  assert.equal(calls[0], 'https://project-ref.supabase.co/rest/v1/rpc/order_projection_health_v2');
});

test('erro remoto é sanitizado sem incluir chave secreta ou corpo integral', async () => {
  const secret = 'service-secret-key-0123456789abcdef';
  const projection = new SupabaseOrderProjection({
    url: 'https://project-ref.supabase.co',
    serviceKey: secret,
    fetch: async () => fakeResponse(409, {
      code: '23505',
      message: `duplicate key ${secret}`,
      details: { large: 'object' }
    })
  });

  await assert.rejects(
    () => projection.projectOrderCreated(createdEvent()),
    error => {
      assert.equal(error.code, 'SUPABASE_PROJECTION_REQUEST_FAILED');
      assert.equal(error.status, 409);
      assert.equal(error.remoteCode, '23505');
      assert.equal(Object.hasOwn(error, 'request'), false);
      assert.equal(Object.hasOwn(error, 'body'), false);
      return true;
    }
  );
});

test('rejeita URL sem HTTPS, chave curta e evento incompatível', async () => {
  assert.throws(
    () => new SupabaseOrderProjection({ url: 'http://project.local', serviceKey: 'a'.repeat(30) }),
    error => error && error.code === 'SUPABASE_URL_INVALID'
  );
  assert.throws(
    () => new SupabaseOrderProjection({ url: 'https://project.supabase.co', serviceKey: 'curta' }),
    error => error && error.code === 'SUPABASE_SECRET_KEY_INVALID'
  );

  const projection = new SupabaseOrderProjection({
    url: 'https://project.supabase.co',
    serviceKey: 'service-secret-key-0123456789abcdef',
    fetch: async () => fakeResponse(200, true)
  });

  await assert.rejects(
    () => projection.projectOrderCreated({
      ...createdEvent(),
      eventType: 'order.status-changed.v2'
    }),
    error => error && error.code === 'PROJECTION_EVENT_TYPE_MISMATCH'
  );
});
