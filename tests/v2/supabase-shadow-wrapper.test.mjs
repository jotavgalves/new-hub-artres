import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapper = await readFile(
  new URL('../../staging/site-v2-worker/src/index-shadow.js', import.meta.url),
  'utf8'
);
const baseWorker = await readFile(
  new URL('../../staging/site-v2-worker/src/index.js', import.meta.url),
  'utf8'
);
const wrangler = await readFile(
  new URL('../../wrangler.site-v2-staging.jsonc', import.meta.url),
  'utf8'
);

test('invólucro preserva Worker e Durable Object consolidados', () => {
  assert.ok(wrapper.includes("import baseWorker, { OrderLedger } from './index.js';"));
  assert.ok(wrapper.includes('export { OrderLedger };'));
  assert.ok(wrapper.includes('const response = await baseWorker.fetch(request, env, ctx);'));
  assert.ok(wrangler.includes('"main": "staging/site-v2-worker/src/index-shadow.js"'));
  assert.ok(wrangler.includes('"class_name": "OrderLedger"'));
  assert.equal(baseWorker.includes('SUPABASE_V2_SERVICE_ROLE_KEY'), false);
  assert.equal(baseWorker.includes('projectOrderToSupabase'), false);
});

test('pedido é concluído no ledger antes da projeção assíncrona', () => {
  const baseFetchIndex = wrapper.indexOf('await baseWorker.fetch(request, env, ctx)');
  const scheduleIndex = wrapper.indexOf('ctx.waitUntil(task)');
  const returnIndex = wrapper.lastIndexOf('return response;');

  assert.ok(baseFetchIndex >= 0);
  assert.ok(scheduleIndex > baseFetchIndex);
  assert.ok(returnIndex > scheduleIndex);
  assert.equal(wrapper.includes('await projectSuccessfulSubmission'), false);
  assert.equal(wrapper.includes('markOutboxDelivered'), false);
});

test('projeção roda somente após resposta CREATED ou REPLAY bem-sucedida', () => {
  assert.ok(wrapper.includes("url.pathname === '/internal/v2/orders/submit'"));
  assert.ok(wrapper.includes("request.method === 'POST'"));
  assert.ok(wrapper.includes('response.status === 200 || response.status === 201'));
  assert.ok(wrapper.includes('shadowStatus.enabled'));
  assert.ok(wrapper.includes('shadowStatus.configured'));
  assert.ok(wrapper.includes('ledgerStub(env, command.submissionCreatedAt).getOrder(orderNumber)'));
});

test('health informa modo sombra sem revelar URL ou credencial', () => {
  assert.ok(wrapper.includes('supabaseShadow: shadowStatus'));
  assert.ok(wrangler.includes('"SUPABASE_SHADOW_ENABLED": "false"'));
  assert.ok(wrangler.includes('"SUPABASE_V2_URL": "https://kueklnkznwpbobqwugns.supabase.co"'));
  assert.equal(wrangler.includes('SUPABASE_V2_SERVICE_ROLE_KEY'), false);
  assert.equal(wrapper.includes('sb_secret_'), false);
  assert.equal(wrapper.includes('eyJhbGciOi'), false);
});

test('logs sombra não incluem cliente, corpo ou segredo', () => {
  const logBlocks = wrapper.match(/console\.(?:log|error)\(JSON\.stringify\([\s\S]*?\)\);/g) || [];
  const serialized = logBlocks.join('\n');
  assert.equal(serialized.includes('customer'), false);
  assert.equal(serialized.includes('whatsapp'), false);
  assert.equal(serialized.includes('serviceRoleKey'), false);
  assert.equal(serialized.includes('SUPABASE_V2_SERVICE_ROLE_KEY'), false);
});
