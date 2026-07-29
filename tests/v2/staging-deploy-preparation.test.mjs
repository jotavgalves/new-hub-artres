import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareStagingDeployFiles } from '../../scripts/v2/prepare-site-v2-staging-deploy.mjs';

const token = `staging-token-${'a'.repeat(32)}`;
const shadowKey = `sb_secret_${'b'.repeat(56)}`;
const expectedUrl = 'https://kueklnkznwpbobqwugns.supabase.co';

async function fixture({ shadowEnabled = false, url = expectedUrl, publicCheckoutEnabled = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'site-v2-deploy-'));
  const sourcePath = join(directory, 'wrangler.jsonc');
  const rollbackPath = join(directory, 'rollback.jsonc');
  const secretsPath = join(directory, 'secrets.json');
  const source = JSON.stringify({
    vars: {
      STAGING_WRITE_ENABLED: 'true',
      STAGING_LOW_LEVEL_LEDGER_ENABLED: 'false',
      STAGING_PUBLIC_CHECKOUT_ENABLED: publicCheckoutEnabled ? 'true' : 'false',
      SUPABASE_SHADOW_ENABLED: shadowEnabled ? 'true' : 'false',
      SUPABASE_V2_URL: url
    }
  }, null, 2);
  await writeFile(sourcePath, `${source}\n`, 'utf8');

  return {
    directory,
    sourcePath,
    rollbackPath,
    secretsPath,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test('flag sombra desligada não exige credencial e gera rollback seguro', async t => {
  const files = await fixture();
  t.after(files.cleanup);

  const result = await prepareStagingDeployFiles({
    sourcePath: files.sourcePath,
    rollbackPath: files.rollbackPath,
    secretsPath: files.secretsPath,
    stagingApiToken: token
  });

  assert.deepEqual(result, {
    ok: true,
    publicCheckoutEnabled: true,
    shadowEnabled: false,
    shadowCredentialIncluded: false,
    rollbackWritesEnabled: false,
    rollbackPublicCheckoutEnabled: false,
    rollbackShadowEnabled: false
  });

  const secrets = JSON.parse(await readFile(files.secretsPath, 'utf8'));
  const rollback = await readFile(files.rollbackPath, 'utf8');
  assert.deepEqual(secrets, { STAGING_API_TOKEN: token });
  assert.ok(rollback.includes('"STAGING_WRITE_ENABLED": "false"'));
  assert.ok(rollback.includes('"STAGING_PUBLIC_CHECKOUT_ENABLED": "false"'));
  assert.ok(rollback.includes('"SUPABASE_SHADOW_ENABLED": "false"'));
  assert.equal(rollback.includes(token), false);
});

test('flag sombra ligada exige credencial e URL exata', async t => {
  const withoutKey = await fixture({ shadowEnabled: true });
  t.after(withoutKey.cleanup);

  await assert.rejects(
    prepareStagingDeployFiles({
      sourcePath: withoutKey.sourcePath,
      rollbackPath: withoutKey.rollbackPath,
      secretsPath: withoutKey.secretsPath,
      stagingApiToken: token
    }),
    error => error?.code === 'SUPABASE_V2_STAGING_SERVICE_ROLE_KEY_MISSING_OR_SHORT'
  );

  const wrongUrl = await fixture({ shadowEnabled: true, url: 'https://outro-projeto.supabase.co' });
  t.after(wrongUrl.cleanup);

  await assert.rejects(
    prepareStagingDeployFiles({
      sourcePath: wrongUrl.sourcePath,
      rollbackPath: wrongUrl.rollbackPath,
      secretsPath: wrongUrl.secretsPath,
      stagingApiToken: token,
      supabaseServiceRoleKey: shadowKey
    }),
    error => error?.code === 'SUPABASE_V2_STAGING_URL_INVALID'
  );
});

test('flag sombra ligada inclui credencial somente no arquivo temporário e a remove do rollback', async t => {
  const files = await fixture({ shadowEnabled: true });
  t.after(files.cleanup);

  const result = await prepareStagingDeployFiles({
    sourcePath: files.sourcePath,
    rollbackPath: files.rollbackPath,
    secretsPath: files.secretsPath,
    stagingApiToken: token,
    supabaseServiceRoleKey: shadowKey
  });

  assert.equal(result.publicCheckoutEnabled, true);
  assert.equal(result.shadowEnabled, true);
  assert.equal(result.shadowCredentialIncluded, true);
  assert.equal(result.rollbackPublicCheckoutEnabled, false);

  const secrets = JSON.parse(await readFile(files.secretsPath, 'utf8'));
  const rollback = await readFile(files.rollbackPath, 'utf8');
  assert.deepEqual(secrets, {
    STAGING_API_TOKEN: token,
    SUPABASE_V2_SERVICE_ROLE_KEY: shadowKey
  });
  assert.ok(rollback.includes('"STAGING_WRITE_ENABLED": "false"'));
  assert.ok(rollback.includes('"STAGING_PUBLIC_CHECKOUT_ENABLED": "false"'));
  assert.ok(rollback.includes('"SUPABASE_SHADOW_ENABLED": "false"'));
  assert.equal(rollback.includes(shadowKey), false);
});

test('bloqueia ledger técnico, token curto e checkout público não ativo', async t => {
  const files = await fixture();
  t.after(files.cleanup);

  await assert.rejects(
    prepareStagingDeployFiles({
      sourcePath: files.sourcePath,
      rollbackPath: files.rollbackPath,
      secretsPath: files.secretsPath,
      stagingApiToken: 'curto'
    }),
    error => error?.code === 'SITE_V2_STAGING_API_TOKEN_TOO_SHORT'
  );

  const unsafe = (await readFile(files.sourcePath, 'utf8'))
    .replace('"STAGING_LOW_LEVEL_LEDGER_ENABLED": "false"', '"STAGING_LOW_LEVEL_LEDGER_ENABLED": "true"');
  await writeFile(files.sourcePath, unsafe, 'utf8');

  await assert.rejects(
    prepareStagingDeployFiles({
      sourcePath: files.sourcePath,
      rollbackPath: files.rollbackPath,
      secretsPath: files.secretsPath,
      stagingApiToken: token
    }),
    error => error?.code === 'LOW_LEVEL_LEDGER_MUST_REMAIN_DISABLED'
  );

  const disabled = await fixture({ publicCheckoutEnabled: false });
  t.after(disabled.cleanup);
  await assert.rejects(
    prepareStagingDeployFiles({
      sourcePath: disabled.sourcePath,
      rollbackPath: disabled.rollbackPath,
      secretsPath: disabled.secretsPath,
      stagingApiToken: token
    }),
    error => error?.code === 'PUBLIC_CHECKOUT_ACTIVE_FLAG_INVALID'
  );
});
