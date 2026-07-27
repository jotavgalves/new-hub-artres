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

test('exige confirmação textual exata antes da publicação', () => {
  assert.ok(workflow.includes('Digite PUBLICAR STAGING para confirmar'));
  assert.ok(workflow.includes('"PUBLICAR STAGING"'));
  assert.ok(workflow.includes('needs: validate-confirmation'));
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

test('secret do Worker é enviado junto com o deploy e removido depois', () => {
  assert.ok(workflow.includes('STAGING_SECRETS_FILE: /tmp/site-v2-staging-secrets.json'));
  assert.ok(workflow.includes('umask 077'));
  assert.ok(workflow.includes('JSON.stringify({ STAGING_API_TOKEN: token })'));
  assert.ok(workflow.includes('--secrets-file "$STAGING_SECRETS_FILE"'));
  assert.ok(workflow.includes('if: always()'));
  assert.ok(workflow.includes('rm -f "$STAGING_SECRETS_FILE"'));
  assert.equal(workflow.includes('secret put STAGING_API_TOKEN'), false);
});

test('publica exclusivamente o arquivo de configuração de staging em modo estrito', () => {
  const deployCommands = workflow.match(/npx --yes wrangler@4\.114\.0 deploy[\s\S]*?(?=\n\s{6}- name:|$)/g) || [];
  assert.ok(deployCommands.length >= 2);
  for (const command of deployCommands) {
    assert.ok(command.includes('--config wrangler.site-v2-staging.jsonc'));
    assert.ok(command.includes('--strict'));
    assert.ok(command.includes('--secrets-file "$STAGING_SECRETS_FILE"'));
  }
  assert.equal(workflow.includes('wrangler.toml'), false);
  assert.equal(workflow.includes('--env production'), false);
});

test('valida testes e bundle antes do deploy real', () => {
  const testsIndex = workflow.indexOf('node --test tests/v2/*.test.mjs');
  const dryRunIndex = workflow.indexOf('--dry-run');
  const deployNameIndex = workflow.indexOf('Publicar Worker, migration e secret com escrita desabilitada');

  assert.ok(testsIndex >= 0);
  assert.ok(dryRunIndex > testsIndex);
  assert.ok(deployNameIndex > dryRunIndex);
});

test('o próprio workflow declara que a escrita continua desabilitada', () => {
  assert.ok(workflow.includes('com escrita desabilitada'));
  assert.ok(workflow.includes('Escrita: desabilitada'));
  assert.equal(workflow.includes('STAGING_WRITE_ENABLED=true'), false);
});
