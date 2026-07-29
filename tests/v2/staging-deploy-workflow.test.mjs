import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/deploy-site-v2-staging.yml', import.meta.url);
const preparationUrl = new URL('../../scripts/v2/prepare-site-v2-staging-deploy.mjs', import.meta.url);
const smokeUrl = new URL('./run-staging-synthetic-remote-smoke.mjs', import.meta.url);
const smokeWrapperUrl = new URL('./run-staging-synthetic-remote-smoke-with-code.mjs', import.meta.url);
const shadowSmokeUrl = new URL('./run-staging-supabase-shadow-remote-smoke.mjs', import.meta.url);
const acceptedCatalogSmokeUrl = new URL('./run-staging-accepted-catalog-remote-smoke.mjs', import.meta.url);
const wranglerUrl = new URL('../../wrangler.site-v2-staging.jsonc', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');
const preparation = await readFile(preparationUrl, 'utf8');
const smoke = await readFile(smokeUrl, 'utf8');
const smokeWrapper = await readFile(smokeWrapperUrl, 'utf8');
const shadowSmoke = await readFile(shadowSmokeUrl, 'utf8');
const acceptedCatalogSmoke = await readFile(acceptedCatalogSmokeUrl, 'utf8');
const wrangler = await readFile(wranglerUrl, 'utf8');

test('deploy automático reage somente a mudanças V2 incorporadas à main e mantém contingência manual', () => {
  assert.ok(workflow.includes('push:'));
  assert.ok(workflow.includes('branches:'));
  assert.ok(workflow.includes('- main'));
  assert.ok(workflow.includes("- 'index.html'"));
  assert.ok(workflow.includes("- 'assets/**'"));
  assert.ok(workflow.includes("- 'src/v2/**'"));
  assert.ok(workflow.includes("- 'scripts/v2/**'"));
  assert.ok(workflow.includes("- 'scripts/catalog-v2/**'"));
  assert.ok(workflow.includes("- 'staging/site-v2-worker/**'"));
  assert.ok(workflow.includes("- 'supabase/migrations/**'"));
  assert.ok(workflow.includes("- 'wrangler.site-v2-staging.jsonc'"));
  assert.ok(workflow.includes("- 'tests/v2/run-staging-synthetic-remote-smoke.mjs'"));
  assert.ok(workflow.includes("- 'tests/v2/run-staging-synthetic-remote-smoke-with-code.mjs'"));
  assert.ok(workflow.includes("- 'tests/v2/run-staging-supabase-shadow-remote-smoke.mjs'"));
  assert.ok(workflow.includes("- 'tests/v2/run-staging-accepted-catalog-remote-smoke.mjs'"));
  assert.ok(workflow.includes("- '.github/workflows/deploy-site-v2-staging.yml'"));
  assert.ok(workflow.includes("- '.github/workflows/catalog-v2-auto-accept.yml'"));
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
  assert.equal(workflow.includes('needs: validate-confirmation'), false);
});

test('usa ambiente protegido e concorrência exclusiva', () => {
  assert.ok(workflow.includes('environment: site-v2-staging'));
  assert.ok(workflow.includes('group: site-v2-staging-deploy'));
  assert.ok(workflow.includes('cancel-in-progress: false'));
});

test('actions críticas usam SHA imutável e checkout sem credencial persistida', () => {
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40}/);
  assert.ok(workflow.includes('persist-credentials: false'));
  assert.equal(workflow.includes('actions/checkout@v4'), false);
  assert.equal(workflow.includes('actions/setup-node@v4'), false);
});

test('ativação exige credenciais base e segredo sombra sem valor literal', () => {
  assert.ok(workflow.includes('secrets.CLOUDFLARE_API_TOKEN'));
  assert.ok(workflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'));
  assert.ok(workflow.includes('secrets.SITE_V2_STAGING_API_TOKEN'));
  assert.ok(workflow.includes('secrets.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY'));
  assert.ok(workflow.includes('SUPABASE_V2_URL: https://kueklnkznwpbobqwugns.supabase.co'));
  assert.ok(workflow.includes('SITE_V2_STAGING_API_TOKEN SUPABASE_V2_STAGING_SERVICE_ROLE_KEY'));
  assert.ok(preparation.includes('SITE_V2_STAGING_API_TOKEN_TOO_SHORT'));
  assert.ok(preparation.includes('SUPABASE_V2_STAGING_SERVICE_ROLE_KEY_MISSING_OR_SHORT'));
  assert.equal(workflow.includes('local-staging-token-0123456789abcdef'), false);
  assert.equal(workflow.includes('CLOUDFLARE_API_TOKEN="'), false);
  assert.equal(workflow.includes('sb_secret_'), false);
  assert.equal(workflow.includes('eyJhbGciOi'), false);
  assert.equal(preparation.includes('sb_secret_'), false);
  assert.equal(preparation.includes('eyJhbGciOi'), false);
  assert.equal(shadowSmoke.includes('sb_secret_'), false);
  assert.equal(shadowSmoke.includes('eyJhbGciOi'), false);
});

test('preparação de secrets e rollback é testável, temporária e removida sempre', () => {
  assert.ok(workflow.includes('STAGING_SECRETS_FILE: /tmp/site-v2-staging-secrets.json'));
  assert.ok(workflow.includes('ROLLBACK_CONFIG_FILE: wrangler.site-v2-staging.rollback.runtime.jsonc'));
  assert.ok(workflow.includes('CATALOG_REPORT_FILE: /tmp/catalog-v2-deploy-accept-report.json'));
  assert.ok(workflow.includes('umask 077'));
  assert.ok(workflow.includes('node scripts/v2/prepare-site-v2-staging-deploy.mjs'));
  assert.ok(preparation.includes('const secrets = { STAGING_API_TOKEN: stagingApiToken };'));
  assert.ok(preparation.includes('secrets.SUPABASE_V2_SERVICE_ROLE_KEY = supabaseServiceRoleKey'));
  assert.ok(preparation.includes('writePrivateFile(secretsPath'));
  assert.ok(preparation.includes('STAGING_WRITE_ENABLED'));
  assert.ok(preparation.includes('SUPABASE_SHADOW_ENABLED'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('rm -f "$STAGING_SECRETS_FILE" "$ROLLBACK_CONFIG_FILE" "$CATALOG_REPORT_FILE"'));
  assert.equal(workflow.includes('secret put STAGING_API_TOKEN'), false);
});

test('valida catálogo, testes e bundles ativo e de rollback antes do deploy real', () => {
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
  assert.equal(workflow.includes('wrangler.toml'), false);
  assert.equal(workflow.includes('--env production'), false);
});

test('deploy mantém pedidos sintéticos, catálogo aceito somente leitura e sombra habilitada', () => {
  assert.ok(workflow.includes('staging-v2-accepted-catalog'));
  assert.ok(workflow.includes('Escrita comercial: habilitada somente para pedidos sintéticos'));
  assert.ok(workflow.includes('Catálogo: versão aceita no Supabase de staging, somente leitura'));
  assert.ok(workflow.includes('Rota técnica do ledger: desabilitada'));
  assert.ok(workflow.includes('Projeção Supabase sombra: habilitada e validada por pedido sintético'));
  assert.ok(workflow.includes('Painel: /admin'));
  assert.ok(smoke.includes("result.payload?.catalog === 'synthetic-staging-only'"));
  assert.ok(smoke.includes('catalogVersion === 9001'));
  assert.ok(smoke.includes("lowLevelResult.payload?.error === 'LOW_LEVEL_LEDGER_DISABLED'"));
  assert.ok(acceptedCatalogSmoke.includes("new URL('/api/catalog-meta', STAGING_URL)"));
  assert.ok(acceptedCatalogSmoke.includes("catalogRequest('themes')"));
  assert.ok(acceptedCatalogSmoke.includes("catalogRequest('products'"));
  assert.ok(acceptedCatalogSmoke.includes("catalogRequest('items'"));
  assert.ok(wrangler.includes('"main": "staging/site-v2-worker/src/index-shadow.js"'));
  assert.ok(wrangler.includes('"SUPABASE_SHADOW_ENABLED": "true"'));
  assert.ok(wrangler.includes('"CATALOG_ACCEPTED_ENABLED": "true"'));
  assert.ok(wrangler.includes('"directory": "./staging/site-v2-public"'));
  assert.equal(wrangler.includes('"SUPABASE_SHADOW_ENABLED": "false"'), false);
});

test('smoke remoto cria, repete e inspeciona somente pedido sintético', () => {
  assert.ok(workflow.includes('node tests/v2/run-staging-synthetic-remote-smoke-with-code.mjs'));
  assert.ok(workflow.includes('GITHUB_RUN_ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}-retry2"'));
  assert.ok(workflow.includes('REMOTE_SMOKE_ERROR_CODE'));
  assert.ok(smokeWrapper.includes("await import(`./run-staging-synthetic-remote-smoke.mjs?invocation="));
  assert.ok(smokeWrapper.includes('publicFailureCode'));
  assert.ok(smoke.includes('staging-artwork-2657'));
  assert.ok(smoke.includes("first?.action === 'CREATED'"));
  assert.ok(smoke.includes("replay?.action === 'REPLAY'"));
  assert.ok(smoke.includes('first?.pricing?.total === 58.5'));
  assert.ok(smoke.includes('customer?.redacted === true'));
  assert.ok(smoke.includes("event?.eventType === 'order.created.v2'"));
  assert.ok(smoke.includes('CLIENT_ITEM_PRICE_IGNORED:staging-artwork-2657'));
  assert.ok(smoke.includes('CLIENT_ORDER_TOTALS_IGNORED'));
});

test('smoke da sombra confirma health, projeção única e dados redigidos no Supabase', () => {
  assert.ok(workflow.includes('node tests/v2/run-staging-supabase-shadow-remote-smoke.mjs'));
  assert.ok(shadowSmoke.includes("supabaseShadow?.enabled === true"));
  assert.ok(shadowSmoke.includes("supabaseShadow?.configured === true"));
  assert.ok(shadowSmoke.includes("supabaseRpc('armazem_v2_projection_health_v1')"));
  assert.ok(shadowSmoke.includes("supabaseRpc('armazem_v2_list_orders_redacted_v1'"));
  assert.ok(shadowSmoke.includes("first?.action === 'CREATED'"));
  assert.ok(shadowSmoke.includes("replay?.action === 'REPLAY'"));
  assert.ok(shadowSmoke.includes("order?.customer?.redacted === true"));
  assert.ok(shadowSmoke.includes('duplicateCount === 1'));
  assert.ok(shadowSmoke.includes('SUPABASE_CUSTOMER_NAME_EXPOSED'));
  assert.ok(shadowSmoke.includes('SUPABASE_CUSTOMER_PHONE_EXPOSED'));
  assert.ok(shadowSmoke.includes('SUPABASE_SERVICE_KEY_EXPOSED'));
  assert.ok(shadowSmoke.includes('Authorization: `Bearer ${serviceRoleKey}`'));
  assert.equal(shadowSmoke.includes('console.log(serviceRoleKey)'), false);
});

test('smoke remoto valida painel e API administrativa somente leitura', () => {
  assert.ok(smoke.includes("`${base}/admin?rolloutProbe="));
  assert.ok(smoke.includes("adminPageResult.text.includes('Pedidos sintéticos')"));
  assert.ok(smoke.includes("adminPageResult.text.includes('SOMENTE LEITURA')"));
  assert.ok(smoke.includes("`${base}/internal/v2/admin/orders?limit=100`"));
  assert.ok(smoke.includes('adminResult.payload?.readOnly === true'));
  assert.ok(smoke.includes("adminOrder?.customer?.redacted === true"));
  assert.ok(smoke.includes('ADMIN_CUSTOMER_NAME_EXPOSED'));
  assert.ok(smoke.includes('ADMIN_CUSTOMER_PHONE_EXPOSED'));
  assert.ok(smoke.includes('adminPostResult.response.status === 405'));
  assert.ok(smoke.includes("adminPostResult.payload?.error === 'METHOD_NOT_ALLOWED'"));
});

test('smoke aguarda propagação estável e repete somente respostas transitórias conhecidas', () => {
  assert.ok(smoke.includes('waitForStableActiveDeployment'));
  assert.ok(smoke.includes('consecutive >= 3'));
  assert.ok(smoke.includes("transientErrors: ['STAGING_WRITES_DISABLED']"));
  assert.ok(smoke.includes('transientStatuses: [404]'));
  assert.ok(smoke.includes('transientStatuses.has(response.status)'));
  assert.ok(smoke.includes("event: 'staging-rollout-transient-retry'"));
  assert.ok(smoke.includes("event: 'staging-rollout-static-retry'"));
  assert.ok(smoke.includes("statusError('REPLAY', replayResult)"));
  assert.ok(smoke.includes('`${label}_STATUS_${result.response.status}_ERROR_${safeCode(result.payload?.error)}`'));
});

test('falha posterior ao deploy aciona rollback automático para escrita e sombra desativadas', () => {
  assert.ok(workflow.includes('id: deploy'));
  assert.ok(workflow.includes('id: catalog-smoke'));
  assert.ok(workflow.includes('id: shadow-smoke'));
  assert.ok(workflow.includes("if: failure() && steps.deploy.outcome == 'success'"));
  assert.ok(workflow.includes('Rollback automático: escrita e sombra do staging desativadas'));
  assert.ok(workflow.includes('staging-writes-disabled-automatic-rollback'));
  assert.ok(workflow.includes('--config "$ROLLBACK_CONFIG_FILE"'));
});

test('workflow lê somente a API pública aprovada e não referencia recursos de produção protegidos', () => {
  assert.ok(workflow.includes('CATALOG_LEGACY_BASE_URL: https://new-hub-artres.pages.dev'));
  assert.equal((workflow.match(/https:\/\/new-hub-artres\.pages\.dev/g) || []).length, 1);
  assert.equal(workflow.includes('CONFIG_KV'), false);
  assert.equal(workflow.includes('ADMIN_SECRET_KEY'), false);
  assert.equal(workflow.includes('environment: production'), false);
  assert.equal(workflow.includes('SUPABASE_PRODUCTION'), false);
  assert.equal(workflow.includes('routes:'), false);
});
