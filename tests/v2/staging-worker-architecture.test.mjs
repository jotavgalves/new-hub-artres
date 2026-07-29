import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const configUrl = new URL('wrangler.site-v2-staging.jsonc', root);
const wrapperUrl = new URL('staging/site-v2-worker/src/index-shadow.js', root);
const workerUrl = new URL('staging/site-v2-worker/src/index.js', root);
const ledgerUrl = new URL('staging/site-v2-worker/src/order-ledger-do.js', root);
const fixtureUrl = new URL('staging/site-v2-worker/src/staging-catalog-fixture.js', root);
const atomicCommandUrl = new URL('src/v2/orders/atomic-command.mjs', root);

const configText = await readFile(configUrl, 'utf8');
const config = JSON.parse(configText);
const wrapperSource = await readFile(wrapperUrl, 'utf8');
const workerSource = await readFile(workerUrl, 'utf8');
const ledgerSource = await readFile(ledgerUrl, 'utf8');
const fixtureSource = await readFile(fixtureUrl, 'utf8');
const atomicCommandSource = await readFile(atomicCommandUrl, 'utf8');

test('configuração é exclusivamente de staging, habilita checkout escrita e sombra sem rota de produção', () => {
  assert.equal(config.name, 'new-hub-artres-v2-staging');
  assert.equal(config.main, 'staging/site-v2-worker/src/index-shadow.js');
  assert.equal(config.compatibility_date, '2026-07-26');
  assert.ok(config.compatibility_flags.includes('nodejs_compat'));
  assert.equal(config.vars.ENVIRONMENT, 'staging');
  assert.equal(config.vars.STAGING_WRITE_ENABLED, 'true');
  assert.equal(config.vars.STAGING_LOW_LEVEL_LEDGER_ENABLED, 'false');
  assert.equal(config.vars.STAGING_PUBLIC_CHECKOUT_ENABLED, 'true');
  assert.equal(
    config.vars.PUBLIC_CHECKOUT_ALLOWED_ORIGINS,
    'https://new-hub-artres-v2-staging.jvgacontato.workers.dev'
  );
  assert.equal(config.vars.SUPABASE_SHADOW_ENABLED, 'true');
  assert.equal(config.vars.SUPABASE_V2_URL, 'https://kueklnkznwpbobqwugns.supabase.co');
  assert.equal(config.vars.SUPABASE_SHADOW_TIMEOUT_MS, '3500');
  assert.equal(config.routes, undefined);
  assert.equal(config.env, undefined);
  assert.equal(config.workers_dev, true);
});

test('rate limit existe somente como binding isolado do checkout de staging', () => {
  assert.deepEqual(config.ratelimits, [
    {
      name: 'PUBLIC_CHECKOUT_ATTEMPT_RATE_LIMITER',
      namespace_id: '2026072901',
      simple: { limit: 8, period: 60 }
    }
  ]);
  assert.match(config.ratelimits[0].namespace_id, /^[0-9]{1,10}$/);
  assert.equal(config.ratelimits[0].name.includes('PRODUCTION'), false);
});

test('entrypoint sombra usa o Worker consolidado preserva Durable Object e projeta checkout público', () => {
  assert.ok(wrapperSource.includes("import { fetchStagingWorker, OrderLedger } from './index.js';"));
  assert.ok(wrapperSource.includes('export { OrderLedger };'));
  assert.ok(wrapperSource.includes('await fetchStagingWorker(request, env, ctx, hooks)'));
  assert.ok(wrapperSource.includes('handlePublicCheckoutRoute(request, env, requestId, {'));
  assert.ok(wrapperSource.includes('scheduleSupabaseShadowProjection'));
  assert.ok(workerSource.includes('export async function fetchStagingWorker'));
  assert.equal(wrapperSource.includes('markOutboxDelivered'), false);
  assert.ok(ledgerSource.includes("'order.created.v2'"));
  assert.ok(fixtureSource.includes('STAGING_PRODUCT_SNAPSHOT'));
  assert.ok(atomicCommandSource.includes('createAtomicLedgerCommandV2'));
  assert.ok(atomicCommandSource.includes('createOrderIntentFingerprint'));
});
