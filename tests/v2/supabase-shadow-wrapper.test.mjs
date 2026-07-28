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
const projector = await readFile(
  new URL('../../staging/site-v2-worker/src/supabase-shadow-projector.js', import.meta.url),
  'utf8'
);
const wrangler = await readFile(
  new URL('../../wrangler.site-v2-staging.jsonc', import.meta.url),
  'utf8'
);

test('invólucro preserva Worker e Durable Object consolidados', () => {
  assert.ok(wrapper.includes("import { fetchStagingWorker, OrderLedger } from './index.js';"));
  assert.ok(wrapper.includes('export { OrderLedger };'));
  assert.ok(wrapper.includes('const response = await fetchStagingWorker(request, env, ctx, hooks);'));
  assert.ok(wrangler.includes('"main": "staging/site-v2-worker/src/index-shadow.js"'));
  assert.ok(wrangler.includes('"class_name": "OrderLedger"'));
  assert.equal(baseWorker.includes('SUPABASE_V2_SERVICE_ROLE_KEY'), false);
  assert.equal(baseWorker.includes('projectOrderToSupabase'), false);
});

test('pedido é concluído no ledger antes do hook de projeção', () => {
  const submitIndex = baseWorker.indexOf('const result = await ledgerStub(env, command.submissionCreatedAt).submit(command);');
  const hookIndex = baseWorker.indexOf('notifyOrderCommitted(hooks, { command, result, requestId }, ctx);');
  const responseIndex = baseWorker.indexOf('submissionResponseView(result, requestId, command.quoteWarnings)', hookIndex);

  assert.ok(submitIndex >= 0);
  assert.ok(hookIndex > submitIndex);
  assert.ok(responseIndex > hookIndex);
  assert.ok(wrapper.includes('scheduleSupabaseShadowProjection({'));
  assert.ok(projector.includes("if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);"));
  assert.equal(wrapper.includes('markOutboxDelivered'), false);
});

test('projeção recebe diretamente comando e resultado canônicos, sem reconstrução ou releitura', () => {
  assert.ok(wrapper.includes('onOrderCommitted({ command, result })'));
  assert.ok(wrapper.includes('command,'));
  assert.ok(wrapper.includes('result,'));
  assert.equal(wrapper.includes('request.clone()'), false);
  assert.equal(wrapper.includes('submissionRequest'), false);
  assert.equal(wrapper.includes('submissionBodyTask'), false);
  assert.equal(wrapper.includes('createAtomicLedgerCommandV2'), false);
  assert.equal(wrapper.includes('.getOrder('), false);
  assert.equal(wrapper.includes('STAGING_CATALOG_ITEMS'), false);
});

test('hook genérico não pode transformar falha sombra em falha do pedido', () => {
  assert.ok(baseWorker.includes('function notifyOrderCommitted(hooks, payload, ctx)'));
  assert.ok(baseWorker.includes("typeof hooks.onOrderCommitted === 'function'"));
  assert.ok(baseWorker.includes("code: 'ORDER_COMMITTED_HOOK_FAILED'"));
  assert.equal(baseWorker.includes('await callback(payload)'), false);
});

test('health informa modo sombra ativo sem revelar URL ou credencial', () => {
  assert.ok(wrapper.includes('supabaseShadow: shadowStatus'));
  assert.ok(wrapper.includes('response.clone().json()'));
  assert.ok(wrangler.includes('"SUPABASE_SHADOW_ENABLED": "true"'));
  assert.ok(wrangler.includes('"SUPABASE_V2_URL": "https://kueklnkznwpbobqwugns.supabase.co"'));
  assert.equal(wrangler.includes('SUPABASE_V2_SERVICE_ROLE_KEY'), false);
  assert.equal(wrapper.includes('sb_secret_'), false);
  assert.equal(wrapper.includes('eyJhbGciOi'), false);
});

test('logs sombra não incluem cliente, corpo ou segredo', () => {
  const sources = `${wrapper}\n${baseWorker}`;
  const logBlocks = sources.match(/console\.(?:log|error)\(JSON\.stringify\([\s\S]*?\)\);/g) || [];
  const serialized = logBlocks.join('\n');
  assert.equal(serialized.includes('customer'), false);
  assert.equal(serialized.includes('whatsapp'), false);
  assert.equal(serialized.includes('serviceRoleKey'), false);
  assert.equal(serialized.includes('SUPABASE_V2_SERVICE_ROLE_KEY'), false);
});
