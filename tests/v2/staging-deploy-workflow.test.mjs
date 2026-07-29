import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/deploy-site-v2-staging.yml', import.meta.url);
const preparationUrl = new URL('../../scripts/v2/prepare-site-v2-staging-deploy.mjs', import.meta.url);
const smokeUrl = new URL('./run-staging-synthetic-remote-smoke.mjs', import.meta.url);
const smokeWrapperUrl = new URL('./run-staging-synthetic-remote-smoke-with-code.mjs', import.meta.url);
const shadowSmokeUrl = new URL('./run-staging-supabase-shadow-remote-smoke.mjs', import.meta.url);
const acceptedCatalogSmokeUrl = new URL('./run-staging-accepted-catalog-remote-smoke.mjs', import.meta.url);
const publicCheckoutSmokeUrl = new URL('./run-staging-public-checkout-remote-smoke.mjs', import.meta.url);
const wranglerUrl = new URL('../../wrangler.site-v2-staging.jsonc', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');
const preparation = await readFile(preparationUrl, 'utf8');
const smoke = await readFile(smokeUrl, 'utf8');
const smokeWrapper = await readFile(smokeWrapperUrl, 'utf8');
const shadowSmoke = await readFile(shadowSmokeUrl, 'utf8');
const acceptedCatalogSmoke = await readFile(acceptedCatalogSmokeUrl, 'utf8');
const publicCheckoutSmoke = await readFile(publicCheckoutSmokeUrl, 'utf8');
const wrangler = await readFile(wranglerUrl, 'utf8');

test('deploy automático reage somente a mudanças V2 incorporadas à main e mantém contingência manual', () => {
  assert.ok(workflow.includes('push:'));
  assert.ok(workflow.includes('branches:'));
  assert.ok(workflow.includes('- main'));
  for (const path of [
    "- 'index.html'",
    "- 'assets/**'",
    "- 'src/v2/**'",
    "- 'scripts/v2/**'",
    "- 'scripts/catalog-v2/**'",
    "- 'staging/site-v2-worker/**'",
    "- 'supabase/migrations/**'",
    "- 'wrangler.site-v2-staging.jsonc'",
    "- 'tests/v2/run-staging-public-checkout-remote-smoke.mjs'",
    "- '.github/workflows/deploy-site-v2-staging.yml'",
    "- '.github/workflows/catalog-v2-auto-accept.yml'"
  ]) assert.ok(workflow.includes(path));
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.equal(/^\s+pull_request:/m.test(workflow), false);
  assert.equal(/^\s+schedule:/m.test(workflow), false);
  assert.equal(/^\s+workflow_run:/m.test(workflow), false);
});

test('autoriza automaticamente apenas push na main e exige frase no modo manual', () => {
  assert.ok(workflow.includes('EVENT_NAME: ${{ github.event_name }}'));
  assert.ok(workflow.includes('REF_NAME: ${{ github.ref_name }}'));
  assert.ok(workflow.includes('CONFIRMACAO: ${{ inputs.confirmacao || \'\' }}'));
  assert.ok(workflow.includes('[ "$EVENT_NAME" = "push" ] && [ "$REF_NAME" = "main" ]'));
  assert.ok(workflow.includes('[ "$EVENT_NAME" = "workflow_dispatch" ]'));
  assert.ok(workflow.includes('[ "$CONFIRMACAO" = "PUBLICAR STAGING V2" ]'));
  assert.ok(workflow.includes('needs: authorize-deploy'));
  assert.ok(workflow.includes('Digite PUBLICAR STAGING V2 para confirmar'));
});

test('usa ambiente protegido concorrência exclusiva e actions imutáveis', () => {
  assert.ok(workflow.includes('environment: site-v2-staging'));
  assert.ok(workflow.includes('group: site-v2-staging-deploy'));
  assert.ok(workflow.includes('cancel-in-progress: false'));
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
  assert.ok(workflow.includes('persist-credentials: false'));
});

test('ativação exige credenciais sem valores literais', () => {
  assert.ok(workflow.includes('secrets.CLOUDFLARE_API_TOKEN'));
  assert.ok(workflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'));
  assert.ok(workflow.includes('secrets.SITE_V2_STAGING_API_TOKEN'));
  assert.ok(workflow.includes('secrets.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY'));
  assert.ok(preparation.includes('SITE_V2_STAGING_API_TOKEN_TOO_SHORT'));
  assert.ok(preparation.includes('SUPABASE_V2_STAGING_SERVICE_ROLE_KEY_MISSING_OR_SHORT'));
  assert.equal(workflow.includes('local-staging-token-0123456789abcdef'), false);
  assert.equal(workflow.includes('sb_secret_'), false);
  assert.equal(workflow.includes('eyJhbGciOi'), false);
  assert.equal(shadowSmoke.includes('sb_secret_'), false);
});

test('preparação cria rollback de checkout escrita e sombra e remove temporários', () => {
  assert.ok(workflow.includes('STAGING_SECRETS_FILE: /tmp/site-v2-staging-secrets.json'));
  assert.ok(workflow.includes('ROLLBACK_CONFIG_FILE: wrangler.site-v2-staging.rollback.runtime.jsonc'));
  assert.ok(workflow.includes('node scripts/v2/prepare-site-v2-staging-deploy.mjs'));
  assert.ok(preparation.includes('STAGING_WRITE_ENABLED'));
  assert.ok(preparation.includes('STAGING_PUBLIC_CHECKOUT_ENABLED'));
  assert.ok(preparation.includes('SUPABASE_SHADOW_ENABLED'));
  assert.ok(preparation.includes('rollbackPublicCheckoutEnabled: false'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('rm -f "$STAGING_SECRETS_FILE" "$ROLLBACK_CONFIG_FILE" "$CATALOG_REPORT_FILE"'));
});

test('valida catálogo testes assets e bundles antes do deploy real', () => {
  const preparationIndex = workflow.indexOf('node scripts/v2/prepare-site-v2-staging-deploy.mjs');
  const testsIndex = workflow.indexOf('node --test tests/v2/*.test.mjs tests/catalog-v2/*.test.mjs');
  const catalogAcceptIndex = workflow.indexOf('node scripts/catalog-v2/publish-accepted-catalog-v2.mjs');
  const assetPreparationIndex = workflow.indexOf('node scripts/v2/prepare-site-v2-static-assets.mjs');
  const activeDryRunIndex = workflow.indexOf('Validar bundle ativo sem publicar');
  const rollbackDryRunIndex = workflow.indexOf('Validar bundle de rollback sem publicar');
  const deployIndex = workflow.indexOf('Publicar Worker, design atual e catálogo aceito');

  assert.ok(preparationIndex >= 0);
  assert.ok(testsIndex > preparationIndex);
  assert.ok(catalogAcceptIndex > testsIndex);
  assert.ok(assetPreparationIndex > catalogAcceptIndex);
  assert.ok(activeDryRunIndex > assetPreparationIndex);
  assert.ok(rollbackDryRunIndex > activeDryRunIndex);
  assert.ok(deployIndex > rollbackDryRunIndex);
  assert.ok(workflow.includes('--config wrangler.site-v2-staging.jsonc'));
  assert.ok(workflow.includes('--config "$ROLLBACK_CONFIG_FILE"'));
  assert.equal(workflow.includes('--env production'), false);
});

test('deploy mantém catálogo aceito checkout visual e sombra no staging', () => {
  assert.ok(workflow.includes('staging-v2-visual-checkout'));
  assert.ok(workflow.includes('Checkout público V2: ativo somente no staging'));
  assert.ok(workflow.includes('design público atual com bridge de checkout injetado somente na cópia de staging'));
  assert.ok(workflow.includes('Projeção Supabase sombra: habilitada e validada'));
  assert.ok(workflow.includes('Rota técnica do ledger: desabilitada'));
  assert.ok(acceptedCatalogSmoke.includes("new URL('/api/catalog-meta', STAGING_URL)"));
  assert.ok(wrangler.includes('"STAGING_PUBLIC_CHECKOUT_ENABLED": "true"'));
  assert.ok(wrangler.includes('"SUPABASE_SHADOW_ENABLED": "true"'));
  assert.ok(wrangler.includes('"CATALOG_ACCEPTED_ENABLED": "true"'));
  assert.ok(wrangler.includes('"directory": "./staging/site-v2-public"'));
});

test('smoke público valida bridge origem criação replay e ausência de segredos', () => {
  assert.ok(workflow.includes('node tests/v2/run-staging-public-checkout-remote-smoke.mjs'));
  assert.ok(publicCheckoutSmoke.includes('v2-checkout-bridge.js'));
  assert.ok(publicCheckoutSmoke.includes("new URL('/api/orders/v2', STAGING_URL)"));
  assert.ok(publicCheckoutSmoke.includes("created.payload?.action !== 'CREATED'"));
  assert.ok(publicCheckoutSmoke.includes("replay.payload?.action !== 'REPLAY'"));
  assert.ok(publicCheckoutSmoke.includes('PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED'));
  assert.ok(publicCheckoutSmoke.includes('productionChanged: false'));
  assert.equal(publicCheckoutSmoke.includes('STAGING_API_TOKEN'), false);
});

test('smoke técnico cria repete e inspeciona pedido sintético', () => {
  assert.ok(workflow.includes('node tests/v2/run-staging-synthetic-remote-smoke-with-code.mjs'));
  assert.ok(workflow.includes('GITHUB_RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}-retry2"'));
  assert.ok(smokeWrapper.includes('publicFailureCode'));
  assert.ok(smoke.includes("first?.action === 'CREATED'"));
  assert.ok(smoke.includes("replay?.action === 'REPLAY'"));
  assert.ok(smoke.includes('first?.pricing?.total === 58.5'));
  assert.ok(smoke.includes("event?.eventType === 'order.created.v2'"));
});

test('smoke da sombra confirma projeção única e dados redigidos', () => {
  assert.ok(workflow.includes('node tests/v2/run-staging-supabase-shadow-remote-smoke.mjs'));
  assert.ok(shadowSmoke.includes("supabaseShadow?.enabled === true"));
  assert.ok(shadowSmoke.includes("first?.action === 'CREATED'"));
  assert.ok(shadowSmoke.includes("replay?.action === 'REPLAY'"));
  assert.ok(shadowSmoke.includes("order?.customer?.redacted === true"));
  assert.ok(shadowSmoke.includes('duplicateCount === 1'));
  assert.equal(shadowSmoke.includes('console.log(serviceRoleKey)'), false);
});

test('falha posterior ao deploy aciona rollback triplo', () => {
  assert.ok(workflow.includes('id: deploy'));
  assert.ok(workflow.includes('id: catalog-smoke'));
  assert.ok(workflow.includes('id: shadow-smoke'));
  assert.ok(workflow.includes("if: failure() && steps.deploy.outcome == 'success'"));
  assert.ok(workflow.includes('Rollback automático: checkout, escrita e sombra do staging desativados'));
  assert.ok(workflow.includes('staging-checkout-writes-shadow-disabled-rollback'));
  assert.ok(workflow.includes('--config "$ROLLBACK_CONFIG_FILE"'));
});

test('workflow não referencia recursos protegidos de produção', () => {
  assert.ok(workflow.includes('CATALOG_LEGACY_BASE_URL: https://new-hub-artres.pages.dev'));
  assert.equal((workflow.match(/https:\/\/new-hub-artres\.pages\.dev/g) || []).length, 1);
  assert.equal(workflow.includes('CONFIG_KV'), false);
  assert.equal(workflow.includes('ADMIN_SECRET_KEY'), false);
  assert.equal(workflow.includes('environment: production'), false);
  assert.equal(workflow.includes('SUPABASE_PRODUCTION'), false);
  assert.equal(workflow.includes('routes:'), false);
});
