import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSiteV2StagingDeployComment } from '../../scripts/v2/post-site-v2-staging-deploy-status.mjs';

test('relatório de deploy confirma validações sem expor dados sensíveis', () => {
  const body = buildSiteV2StagingDeployComment({
    workflowStatus: 'success',
    catalogAccept: 'success',
    deploy: 'success',
    catalogSmoke: 'success',
    remoteSmoke: 'success',
    shadowSmoke: 'success',
    rollback: 'skipped',
    commit: 'fd6fad95b87cf12a19431cdc30cc9e281b359247',
    token: 'segredo-que-nao-pode-aparecer',
    customer: 'Cliente Particular',
    order: { phone: '81999999999' }
  });

  assert.match(body, /Resultado final: \*\*sucesso\*\*/);
  assert.match(body, /Commit: `fd6fad95b87c`/);
  assert.match(body, /Design e catálogo aceito: \*\*success\*\*/);
  assert.match(body, /produção pública não foi alterada/i);
  assert.doesNotMatch(body, /segredo-que-nao-pode-aparecer/);
  assert.doesNotMatch(body, /Cliente Particular/);
  assert.doesNotMatch(body, /81999999999/);
});

test('falha inclui somente código público e sanitizado do smoke', () => {
  const body = buildSiteV2StagingDeployComment({
    workflowStatus: 'failure',
    catalogSmoke: 'failure',
    catalogSmokeError: 'STAGING_HOME_REDIRECT_EXTERNAL',
    token: 'nao-pode-vazar'
  });

  assert.match(body, /Código do smoke do catálogo: `STAGING_HOME_REDIRECT_EXTERNAL`/);
  assert.doesNotMatch(body, /nao-pode-vazar/);
});

test('resultado desconhecido é sanitizado e não inventa sucesso', () => {
  const body = buildSiteV2StagingDeployComment({
    workflowStatus: 'qualquer-coisa',
    deploy: '<script>alert(1)</script>',
    catalogSmokeError: '<script>erro</script>',
    commit: 'nao-e-sha'
  });

  assert.match(body, /Resultado final: \*\*unknown\*\*/);
  assert.match(body, /Publicação do Worker: \*\*unknown\*\*/);
  assert.match(body, /Commit: `desconhecido`/);
  assert.doesNotMatch(body, /Código do smoke do catálogo/);
  assert.doesNotMatch(body, /<script>/);
});
