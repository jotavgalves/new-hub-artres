import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const smoke = await readFile(
  new URL('./run-staging-accepted-catalog-remote-smoke.mjs', import.meta.url),
  'utf8'
);

test('smoke do catálogo aguarda propagação estável antes da navegação', () => {
  assert.ok(smoke.includes('waitForAcceptedCatalogDeployment'));
  assert.ok(smoke.includes('PROPAGATION_MAX_ATTEMPTS = 180'));
  assert.ok(smoke.includes('PROPAGATION_INTERVAL_MS = 1000'));
  assert.ok(smoke.includes('REQUIRED_STABLE_RESPONSES = 3'));
  assert.ok(smoke.includes('consecutive >= REQUIRED_STABLE_RESPONSES'));
  assert.ok(smoke.includes("event: 'staging-accepted-catalog-stable-probe'"));
  assert.ok(smoke.includes("event: 'staging-accepted-catalog-propagation-retry'"));
  assert.ok(smoke.includes("throw smokeError(lastCode === 'STAGING_ACCEPTED_CATALOG_PROPAGATION_PENDING'"));
});

test('sondagem exige design atual, catálogo aceito e ponte legada desativada', () => {
  assert.ok(smoke.includes('Escolha suas Artes \\| Armazém Festa e Eventos'));
  assert.ok(smoke.includes('health?.acceptedCatalog?.enabled !== true'));
  assert.ok(smoke.includes('health?.acceptedCatalog?.configured !== true'));
  assert.ok(smoke.includes('health?.catalogReadonlyBridge?.enabled !== false'));
  assert.ok(smoke.includes('Number(metadata.routeCount) >= 1'));
  assert.ok(smoke.includes('Number(metadata.folderCount) >= 1'));
  assert.ok(smoke.includes('Number(metadata.itemCount) >= 1'));
});

test('página inicial aceita somente redirecionamento interno e limitado', () => {
  assert.ok(smoke.includes('fetchHomeText'));
  assert.ok(smoke.includes('HOME_MAX_REDIRECTS = 3'));
  assert.ok(smoke.includes("redirect: 'manual'"));
  assert.ok(smoke.includes('next.origin !== STAGING_URL'));
  assert.ok(smoke.includes('STAGING_HOME_REDIRECT_EXTERNAL'));
  assert.ok(smoke.includes('STAGING_HOME_REDIRECT_LIMIT'));
  assert.ok(smoke.includes("next.pathname.startsWith('/api/')"));
});
