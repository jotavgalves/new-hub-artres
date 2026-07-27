import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ACTIVE_WRITE_FLAG = '"STAGING_WRITE_ENABLED": "true"';
const SAFE_WRITE_FLAG = '"STAGING_WRITE_ENABLED": "false"';
const SHADOW_ACTIVE_FLAG = '"SUPABASE_SHADOW_ENABLED": "true"';
const SHADOW_SAFE_FLAG = '"SUPABASE_SHADOW_ENABLED": "false"';
const LOW_LEVEL_SAFE_FLAG = '"STAGING_LOW_LEVEL_LEDGER_ENABLED": "false"';
const EXPECTED_SUPABASE_URL = 'https://kueklnkznwpbobqwugns.supabase.co';

export async function prepareStagingDeployFiles(options = {}) {
  const sourcePath = String(options.sourcePath || 'wrangler.site-v2-staging.jsonc');
  const rollbackPath = requiredPath(options.rollbackPath, 'ROLLBACK_CONFIG_FILE_REQUIRED');
  const secretsPath = requiredPath(options.secretsPath, 'STAGING_SECRETS_FILE_REQUIRED');
  const stagingApiToken = String(options.stagingApiToken || '');
  const supabaseServiceRoleKey = String(options.supabaseServiceRoleKey || '');
  const expectedSupabaseUrl = String(options.expectedSupabaseUrl || EXPECTED_SUPABASE_URL);

  if (stagingApiToken.length < 32) throw deployConfigError('SITE_V2_STAGING_API_TOKEN_TOO_SHORT');

  const source = await readFile(sourcePath, 'utf8');
  if (countOccurrences(source, ACTIVE_WRITE_FLAG) !== 1) {
    throw deployConfigError('ACTIVE_WRITE_FLAG_INVALID');
  }
  if (!source.includes(LOW_LEVEL_SAFE_FLAG)) {
    throw deployConfigError('LOW_LEVEL_LEDGER_MUST_REMAIN_DISABLED');
  }

  const shadowEnabled = source.includes(SHADOW_ACTIVE_FLAG);
  const shadowDisabled = source.includes(SHADOW_SAFE_FLAG);
  if (shadowEnabled === shadowDisabled) throw deployConfigError('SUPABASE_SHADOW_FLAG_INVALID');

  if (shadowEnabled) {
    if (supabaseServiceRoleKey.length < 32) {
      throw deployConfigError('SUPABASE_V2_STAGING_SERVICE_ROLE_KEY_MISSING_OR_SHORT');
    }
    if (!source.includes(`"SUPABASE_V2_URL": "${expectedSupabaseUrl}"`)) {
      throw deployConfigError('SUPABASE_V2_STAGING_URL_INVALID');
    }
  }

  const secrets = { STAGING_API_TOKEN: stagingApiToken };
  if (supabaseServiceRoleKey) secrets.SUPABASE_V2_SERVICE_ROLE_KEY = supabaseServiceRoleKey;

  let rollbackSource = source.replace(ACTIVE_WRITE_FLAG, SAFE_WRITE_FLAG);
  if (rollbackSource.includes(SHADOW_ACTIVE_FLAG)) {
    rollbackSource = rollbackSource.replace(SHADOW_ACTIVE_FLAG, SHADOW_SAFE_FLAG);
  }

  await writePrivateFile(secretsPath, `${JSON.stringify(secrets)}\n`);
  await writePrivateFile(rollbackPath, rollbackSource);

  return Object.freeze({
    ok: true,
    shadowEnabled,
    shadowCredentialIncluded: Boolean(supabaseServiceRoleKey),
    rollbackWritesEnabled: false,
    rollbackShadowEnabled: false
  });
}

async function main() {
  const result = await prepareStagingDeployFiles({
    sourcePath: process.env.STAGING_CONFIG_FILE || 'wrangler.site-v2-staging.jsonc',
    rollbackPath: process.env.ROLLBACK_CONFIG_FILE,
    secretsPath: process.env.STAGING_SECRETS_FILE,
    stagingApiToken: process.env.SITE_V2_STAGING_API_TOKEN,
    supabaseServiceRoleKey: process.env.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function requiredPath(value, code) {
  const text = String(value || '').trim();
  if (!text) throw deployConfigError(code);
  return text;
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

async function writePrivateFile(path, content) {
  await writeFile(path, content, { mode: 0o600 });
}

function deployConfigError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    const code = String(error?.code || 'STAGING_DEPLOY_PREPARATION_FAILED')
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 100) || 'STAGING_DEPLOY_PREPARATION_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
