import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertBindings,
  compareEnvironmentIsolation,
  inspectBindingPresence
} from '../../src/v2/platform/bindings.mjs';

function completeStagingEnv() {
  return {
    ASSETS: { fetch() {} },
    CONFIG_KV: { get() {}, put() {} },
    ARTS_SUPABASE_URL: 'https://catalog.example.test',
    ARTS_SUPABASE_SERVICE_KEY: 'catalog-staging-key',
    SUPABASE_URL: 'https://orders.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'orders-staging-key',
    ADMIN_SECRET_KEY: 'admin-staging-secret',
    ARMAZEM_DESKTOP_TOKEN: 'desktop-staging-token'
  };
}

test('perfil público exige assets, KV e Supabase específico do catálogo', () => {
  const report = inspectBindingPresence({
    ASSETS: {},
    CONFIG_KV: {},
    ARTS_SUPABASE_URL: 'catalog-url',
    ARTS_SUPABASE_SERVICE_KEY: 'catalog-key'
  }, 'public');

  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.exposesValues, false);
  assert.equal(report.groups.catalogSupabaseUrl.matchedAlias, 'ARTS_SUPABASE_URL');
});

test('perfil staging exige todas as integrações isoláveis', () => {
  const report = inspectBindingPresence({ ASSETS: {}, CONFIG_KV: {} }, 'staging');

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('BINDING_GROUP_MISSING:catalogSupabaseUrl'));
  assert.ok(report.errors.includes('BINDING_GROUP_MISSING:ordersSupabaseUrl'));
  assert.ok(report.errors.includes('BINDING_GROUP_MISSING:adminSecret'));
  assert.ok(report.errors.includes('BINDING_GROUP_MISSING:productionToken'));
});

test('staging completo com aliases preferidos é aceito', () => {
  const report = assertBindings(completeStagingEnv(), 'staging');

  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.equal(report.groups.productionToken.matchedAlias, 'ARMAZEM_DESKTOP_TOKEN');
  assert.equal(report.groups.catalogSupabaseKey.usesPreferredAlias, true);
});

test('aliases genéricos compartilhados geram advertência', () => {
  const report = inspectBindingPresence({
    ASSETS: {},
    CONFIG_KV: {},
    SUPABASE_REST_URL: 'shared-url',
    SUPABASE_SERVICE_ROLE_KEY: 'shared-key',
    ADMIN_SECRET_KEY: 'admin'
  }, 'admin');

  assert.equal(report.ok, true);
  assert.ok(report.warnings.includes('CATALOG_AND_ORDERS_SHARE_GENERIC_URL_ALIAS'));
  assert.ok(report.warnings.includes('CATALOG_AND_ORDERS_SHARE_GENERIC_SERVICE_KEY_ALIAS'));
  assert.ok(report.warnings.includes('NON_PREFERRED_ALIAS:catalogSupabaseUrl:SUPABASE_REST_URL'));
});

test('perfil desconhecido falha explicitamente', () => {
  assert.throws(
    () => inspectBindingPresence({}, 'desconhecido'),
    error => error && error.code === 'ENVIRONMENT_PROFILE_UNKNOWN'
  );
});

test('detecta reutilização perigosa entre produção e staging sem expor valores', () => {
  const sharedKv = { get() {}, put() {} };
  const production = {
    CONFIG_KV: sharedKv,
    ADMIN_SECRET_KEY: 'same-admin-secret',
    ARMAZEM_DESKTOP_TOKEN: 'same-token',
    ARTS_SUPABASE_URL: 'same-catalog-url'
  };
  const staging = {
    CONFIG_KV: sharedKv,
    ADMIN_SECRET_KEY: 'same-admin-secret',
    ARMAZEM_DESKTOP_TOKEN: 'same-token',
    ARTS_SUPABASE_URL: 'same-catalog-url'
  };

  const report = compareEnvironmentIsolation(production, staging);

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('STAGING_REUSES_PRODUCTION_BINDING:CONFIG_KV'));
  assert.ok(report.errors.includes('STAGING_REUSES_PRODUCTION_BINDING:ADMIN_SECRET_KEY'));
  assert.ok(report.errors.includes('STAGING_REUSES_PRODUCTION_BINDING:ARMAZEM_DESKTOP_TOKEN'));
  assert.ok(report.warnings.includes('STAGING_REUSES_PRODUCTION_VALUE:ARTS_SUPABASE_URL'));
  assert.equal(report.exposesValues, false);
});

test('ambientes totalmente separados não geram bloqueio', () => {
  const production = completeStagingEnv();
  const staging = {
    ASSETS: { fetch() {} },
    CONFIG_KV: { get() {}, put() {} },
    ARTS_SUPABASE_URL: 'https://catalog-stage-2.example.test',
    ARTS_SUPABASE_SERVICE_KEY: 'catalog-stage-2-key',
    SUPABASE_URL: 'https://orders-stage-2.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'orders-stage-2-key',
    ADMIN_SECRET_KEY: 'admin-stage-2-secret',
    ARMAZEM_DESKTOP_TOKEN: 'desktop-stage-2-token'
  };

  const report = compareEnvironmentIsolation(production, staging);

  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
});
