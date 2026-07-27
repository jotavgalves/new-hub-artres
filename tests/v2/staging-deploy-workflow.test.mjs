import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../../.github/workflows/deploy-site-v2-staging.yml', import.meta.url);
const workflow = await readFile(workflowUrl, 'utf8');

test('deploy só pode ser iniciado manualmente', () => {
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.equal(/^\s+push:/m.test(workflow), false);
  assert.equal(/^\s+pull_request:/m.test(workflow), false);
  assert.equal(/^\s+schedule:/m.test(workflow), false);
  assert.equal(/^\s+workflow_run:/m.test(workflow), false);
});

test('exige confirmação textual específica para escrita sintética', () => {
  assert.ok(workflow.includes('Digite PUBLICAR STAGING SINTETICO para confirmar'));
  assert.ok(workflow.includes('"PUBLICAR STAGING SINTETICO"'));
  assert.ok(workflow.includes('needs: validate-confirmation'));
  assert.equal(workflow.includes('"PUBLICAR STAGING"'), false);
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

test('exige credenciais distintas e nunca contém valor literal', () => {
  assert.ok(workflow.includes('secrets.CLOUDFLARE_API_TOKEN'));
  assert.ok(workflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'));
  assert.ok(workflow.includes('secrets.SITE_V2_STAGING_API_TOKEN'));
  assert.ok(workflow.includes('SITE_V2_STAGING_API_TOKEN_TOO_SHORT'));
  assert.equal(workflow.includes('local-staging-token-0123456789abcdef'), false);
  assert.equal(workflow.includes('CLOUDFLARE_API_TOKEN="'), false);
});

test('secret e configuração de rollback são temporários e removidos sempre', () => {
  assert.ok(workflow.includes('STAGING_SECRETS_FILE: /tmp/site-v2-staging-secrets.json'));
  assert.ok(workflow.includes('ROLLBACK_CONFIG_FILE: wrangler.site-v2-staging.rollback.runtime.jsonc'));
  assert.ok(workflow.includes('umask 077'));
  assert.ok(workflow.includes('JSON.stringify({ STAGING_API_TOKEN: token })'));
  assert.ok(workflow.includes('"STAGING_WRITE_ENABLED": "false"'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('rm -f "$STAGING_SECRETS_FILE" "$ROLLBACK_CONFIG_FILE"'));
  assert.equal(workflow.includes('secret put STAGING_API_TOKEN'), false);
});

test('valida bundles ativo e de rollback antes do deploy real', () => {
  const testsIndex = workflow.indexOf('node --test tests/v2/*.test.mjs');
  const activeDryRunIndex = workflow.indexOf('Validar bundle ativo sem publicar');
  const rollbackDryRunIndex = workflow.indexOf('Validar bundle de rollback sem publicar');
  const deployIndex = workflow.indexOf('Publicar Worker com escrita exclusivamente sintética');

  assert.ok(testsIndex >= 0);
  assert.ok(activeDryRunIndex > testsIndex);
  assert.ok(rollbackDryRunIndex > activeDryRunIndex);
  assert.ok(deployIndex > rollbackDryRunIndex);
  assert.ok(workflow.includes('--config wrangler.site-v2-staging.jsonc'));
  assert.ok(workflow.includes('--config "$ROLLBACK_CONFIG_FILE"'));
  assert.equal(workflow.includes('wrangler.toml'), false);
  assert.equal(workflow.includes('--env production'), false);
});

test('deploy ativo declara escrita sintética e mantém rota técnica desligada', () => {
  assert.ok(workflow.includes('staging-synthetic-writes-enabled'));
  assert.ok(workflow.includes('Escrita comercial: habilitada somente para catálogo sintético'));
  assert.ok(workflow.includes('Rota técnica do ledger: desabilitada'));
  assert.ok(workflow.includes('synthetic-staging-only'));
  assert.ok(workflow.includes('catalogVersion === 9001'));
  assert.ok(workflow.includes("lowLevel?.error === 'LOW_LEVEL_LEDGER_DISABLED'"));
});

test('smoke remoto cria, repete e inspeciona somente pedido sintético', () => {
  assert.ok(workflow.includes('staging-artwork-2657'));
  assert.ok(workflow.includes("first?.action === 'CREATED'"));
  assert.ok(workflow.includes("replay?.action === 'REPLAY'"));
  assert.ok(workflow.includes('first?.pricing?.total === 58.5'));
  assert.ok(workflow.includes('customer?.redacted === true'));
  assert.ok(workflow.includes("event?.eventType === 'order.created.v2'"));
  assert.ok(workflow.includes('CLIENT_ITEM_PRICE_IGNORED:staging-artwork-2657'));
  assert.ok(workflow.includes('CLIENT_ORDER_TOTALS_IGNORED'));
});

test('falha posterior ao deploy aciona rollback automático para escrita desativada', () => {
  assert.ok(workflow.includes("id: deploy"));
  assert.ok(workflow.includes("if: failure() && steps.deploy.outcome == 'success'"));
  assert.ok(workflow.includes('Rollback automático: escrita do staging desativada'));
  assert.ok(workflow.includes('staging-writes-disabled-automatic-rollback'));
  assert.ok(workflow.includes('--config "$ROLLBACK_CONFIG_FILE"'));
});

test('workflow não referencia recursos ou rotas do site público atual', () => {
  assert.equal(workflow.includes('new-hub-artres.pages.dev'), false);
  assert.equal(workflow.includes('CONFIG_KV'), false);
  assert.equal(workflow.includes('SUPABASE'), false);
  assert.equal(workflow.includes('ADMIN_SECRET_KEY'), false);
});
