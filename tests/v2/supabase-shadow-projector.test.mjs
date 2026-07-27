import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSupabaseOrderProjection,
  projectOrderToSupabase,
  scheduleSupabaseShadowProjection,
  supabaseShadowStatus
} from '../../staging/site-v2-worker/src/supabase-shadow-projector.js';

const serviceRoleKey = `sb_secret_${'a'.repeat(56)}`;
const idempotencyKey = `idempotency:v2:${'b'.repeat(64)}`;
const fingerprint = 'c'.repeat(64);
const submissionCreatedAt = '2026-07-27T19:45:00.000Z';

function fixture() {
  const order = {
    schemaVersion: 2,
    orderNumber: 'PED2600001A',
    orderCode: 'PED2600001A',
    displayId: 'PED2600001A',
    status: 'Novo',
    seller: { id: 'staging-synthetic', label: 'Staging Synthetic' },
    customer: { name: 'Cliente Sintético', whatsapp: '5581999999999', phone: '5581999999999' },
    items: [{
      itemId: 'staging-artwork-2657:round-50x50:default:50x50',
      driveFileId: 'staging-artwork-2657',
      code: '2657',
      originalName: 'Arte sintética 2657',
      theme: 'Staging',
      subtheme: 'Validação',
      productKey: 'round-50x50',
      productName: 'Painel redondo 50x50',
      variantKey: 'default',
      sizeKey: '50x50',
      quantity: 6,
      unitPrice: 9.75,
      lineSubtotal: 58.5,
      details: {}
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
    integrity: {
      catalogVersion: 9001,
      configVersion: 9001,
      productRegistryVersion: 1,
      requestItemCount: 1,
      canonicalItemCount: 1
    },
    source: 'catalog-v2-staging-synthetic',
    createdAt: submissionCreatedAt,
    updatedAt: submissionCreatedAt
  };

  return {
    env: {
      SUPABASE_SHADOW_ENABLED: 'true',
      SUPABASE_V2_URL: 'https://kueklnkznwpbobqwugns.supabase.co',
      SUPABASE_V2_SERVICE_ROLE_KEY: serviceRoleKey,
      SUPABASE_SHADOW_TIMEOUT_MS: '3500'
    },
    command: {
      idempotencyKey,
      fingerprint,
      submissionCreatedAt,
      requestId: 'shadow-test-request',
      actor: 'staging-synthetic'
    },
    result: {
      orderNumber: order.orderNumber,
      order
    }
  };
}

test('modo sombra permanece desativado e não configurado sem segredo', () => {
  assert.deepEqual(
    supabaseShadowStatus({
      SUPABASE_SHADOW_ENABLED: 'false',
      SUPABASE_V2_URL: 'https://kueklnkznwpbobqwugns.supabase.co'
    }),
    {
      enabled: false,
      configured: false,
      mode: 'best-effort',
      target: 'supabase-v2-staging'
    }
  );
});

test('projeção usa somente chave de idempotência derivada e evento determinístico', () => {
  const { command, result } = fixture();
  const projection = buildSupabaseOrderProjection({ command, result });

  assert.equal(projection.contractVersion, 1);
  assert.equal(projection.eventId, 'shadow:order.created.v2:PED2600001A');
  assert.equal(projection.eventType, 'order.created.v2');
  assert.equal(projection.idempotencyKey, idempotencyKey);
  assert.equal(projection.fingerprint, fingerprint);
  assert.equal(projection.order, result.order);
  assert.equal(JSON.stringify(projection).includes('chave-bruta-do-cliente'), false);
});

test('RPC recebe payload canônico e credencial somente em headers', async () => {
  const { env, command, result } = fixture();
  let captured;

  const projected = await projectOrderToSupabase({
    env,
    command,
    result,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({
        ok: true,
        action: 'CREATED',
        replayed: false,
        orderNumber: result.orderNumber
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  assert.equal(captured.url, 'https://kueklnkznwpbobqwugns.supabase.co/rest/v1/rpc/armazem_v2_project_order_v1');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, `Bearer ${serviceRoleKey}`);
  assert.equal(captured.options.headers.apikey, serviceRoleKey);

  const requestBody = JSON.parse(captured.options.body);
  assert.equal(requestBody.p_projection.order.orderNumber, result.orderNumber);
  assert.equal(requestBody.p_projection.idempotencyKey, idempotencyKey);
  assert.equal(captured.options.body.includes(serviceRoleKey), false);
  assert.equal(projected.ok, true);
  assert.equal(projected.action, 'CREATED');
});

test('agendamento desativado não cria tarefa nem chama rede', () => {
  const { command, result } = fixture();
  let waitUntilCalled = false;
  let fetchCalled = false;

  const scheduled = scheduleSupabaseShadowProjection({
    ctx: { waitUntil() { waitUntilCalled = true; } },
    env: { SUPABASE_SHADOW_ENABLED: 'false' },
    command,
    result,
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('UNEXPECTED_FETCH');
    }
  });

  assert.deepEqual(scheduled, { scheduled: false, state: 'disabled' });
  assert.equal(waitUntilCalled, false);
  assert.equal(fetchCalled, false);
});

test('falha da projeção é absorvida pela tarefa e não expõe segredo', async () => {
  const { env, command, result } = fixture();
  let backgroundTask;
  const logs = [];

  const scheduled = scheduleSupabaseShadowProjection({
    ctx: { waitUntil(task) { backgroundTask = task; } },
    env,
    command,
    result,
    fetchImpl: async () => new Response('{"message":"indisponível"}', { status: 503 }),
    logger: {
      log(message) { logs.push(message); },
      error(message) { logs.push(message); }
    }
  });

  assert.deepEqual(scheduled, { scheduled: true, state: 'scheduled' });
  const backgroundResult = await backgroundTask;
  assert.equal(backgroundResult.ok, false);
  assert.equal(backgroundResult.code, 'SUPABASE_SHADOW_HTTP_503');
  assert.ok(logs.some(message => message.includes('supabase-shadow-projection-failed')));
  assert.ok(logs.some(message => message.includes('SUPABASE_SHADOW_HTTP_503')));
  assert.equal(logs.join('\n').includes(serviceRoleKey), false);
  assert.equal(logs.join('\n').includes(result.order.customer.name), false);
  assert.equal(logs.join('\n').includes(result.order.customer.whatsapp), false);
});

test('resposta acima de 64 KiB é rejeitada sem carregar conteúdo ilimitado', async () => {
  const { env, command, result } = fixture();

  await assert.rejects(
    projectOrderToSupabase({
      env,
      command,
      result,
      fetchImpl: async () => new Response('x', {
        status: 200,
        headers: { 'Content-Length': String(64 * 1024 + 1) }
      })
    }),
    error => error?.code === 'SUPABASE_SHADOW_RESPONSE_TOO_LARGE'
  );
});
