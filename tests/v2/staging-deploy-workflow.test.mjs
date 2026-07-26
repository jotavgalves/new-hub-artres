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

test('exige credenciais distintas e nunca as grava em arquivo', () => {
  assert.ok(workflow.includes('secrets.CLOUDFLARE_API_TOKEN'));
  assert.ok(workflow.includes('secrets.CLOUDFLARE_ACCOUNT_ID'));
  assert.ok(workflow.includes('secrets.SITE_V2_STAGING_API_TOKEN'));
  assert.ok(workflow.includes('secret put STAGING_API_TOKEN'));
  assert.equal(/STAGING_API_TOKEN:\s*['"][^$]/.test(workflow), false);
});

test('publica exclusivamente o arquivo de configuração de staging', () => {
  const deployCommands = workflow.match(/npx --yes wrangler@4\.114\.0 deploy[\s\S]*?(?=\n\s{6}- name:|$)/g) || [];
  assert.ok(deployCommands.length >= 2);
  for (const command of deployCommands) {
    assert.ok(command.includes('--config wrangler.site-v2-staging.jsonc'));
  }
  assert.equal(workflow.includes('wrangler.toml'), false);
  assert.equal(workflow.includes('wrangler.jsonc'), false);
  assert.equal(workflow.includes('--env production'), false);
});

test('valida testes e bundle antes do deploy real', () => {
  const testsIndex = workflow.indexOf('node --test tests/v2/*.test.mjs');
  const dryRunIndex = workflow.indexOf('--dry-run');
  const deployNameIndex = workflow.indexOf('Publicar Worker com escrita desabilitada');

  assert.ok(testsIndex >= 0);
  assert.ok(dryRunIndex > testsIndex);
  assert.ok(deployNameIndex > dryRunIndex);
});

test('o próprio workflow declara que a escrita continua desabilitada', () => {
  assert.ok(workflow.includes('Publicar Worker com escrita desabilitada'));
  assert.ok(workflow.includes('Escrita: desabilitada'));
  assert.equal(workflow.includes('STAGING_WRITE_ENABLED=true'), false);
});
