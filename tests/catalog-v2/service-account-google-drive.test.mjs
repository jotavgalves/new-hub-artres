import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  createServiceAccountAssertion,
  exchangeServiceAccountToken,
  parseServiceAccountCredentials
} from '../../scripts/catalog-v2/service-account-google-drive.mjs';

function credentials() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    type: 'service_account',
    project_id: 'catalog-test',
    private_key_id: 'abc123',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    client_email: 'catalog-reader@catalog-test.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token'
  };
}

test('normaliza credencial e gera JWT RS256 somente leitura', () => {
  const parsed = parseServiceAccountCredentials(JSON.stringify(credentials()));
  assert.equal(parsed.clientEmail, 'catalog-reader@catalog-test.iam.gserviceaccount.com');
  const assertion = createServiceAccountAssertion(parsed, { nowSeconds: 1_800_000_000 });
  const [headerPart, claimsPart, signaturePart] = assertion.split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8'));
  assert.equal(header.alg, 'RS256');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(claims.iat, 1_800_000_000);
  assert.equal(claims.exp, 1_800_003_300);
  assert.ok(signaturePart.length > 100);
});

test('usa o grant type oficial na troca do token', async () => {
  let body = '';
  const result = await exchangeServiceAccountToken(credentials(), {
    fetch: async (_url, init) => {
      body = String(init.body);
      return new Response(JSON.stringify({ access_token: 'x'.repeat(40), expires_in: 3600, token_type: 'Bearer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  assert.match(body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
  assert.equal(result.accessToken.length, 40);
});

test('rejeita e-mail e chave inválidos', () => {
  assert.throws(() => parseServiceAccountCredentials({ client_email: 'x@example.com', private_key: 'abc' }), {
    message: 'GOOGLE_SERVICE_ACCOUNT_EMAIL_INVALID'
  });
});
