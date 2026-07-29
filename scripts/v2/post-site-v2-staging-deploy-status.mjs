import { pathToFileURL } from 'node:url';

const ALLOWED_OUTCOMES = new Set(['success', 'failure', 'cancelled', 'skipped', 'unknown']);

export function buildSiteV2StagingDeployComment(input = {}) {
  const status = sanitizeStatus(input);
  const success = status.workflow === 'success' &&
    status.deploy === 'success' &&
    status.catalogSmoke === 'success' &&
    status.remoteSmoke === 'success' &&
    status.shadowSmoke === 'success';

  const lines = [
    '### Publicação do Site V2 Staging',
    '',
    `- Resultado final: **${success ? 'sucesso' : status.workflow}**`,
    `- Commit: \`${status.commit}\``,
    `- Aceitação do catálogo: **${status.catalogAccept}**`,
    `- Publicação do Worker: **${status.deploy}**`,
    `- Design e catálogo aceito: **${status.catalogSmoke}**`,
    `- Pedido sintético, replay e bloqueios: **${status.remoteSmoke}**`,
    `- Projeção sombra no Supabase: **${status.shadowSmoke}**`,
    `- Rollback automático: **${status.rollback}**`,
    ''
  ];

  if (success) {
    lines.push('O staging foi publicado e passou pelas validações remotas. A produção pública não foi alterada.');
  } else {
    lines.push('A publicação não concluiu todas as validações. Quando o Worker chegou a ser publicado, o rollback automático permaneceu responsável por desativar escrita e projeção sombra.');
  }

  lines.push('', 'Nenhum token, credencial, dado de cliente ou conteúdo de pedido foi incluído neste relatório.');
  return lines.join('\n');
}

export async function postSiteV2StagingDeployStatus(options = {}) {
  const token = String(options.token || '').trim();
  const repository = String(options.repository || '').trim();
  const issueNumber = Number.parseInt(options.issueNumber, 10);
  const fetchImpl = options.fetch || globalThis.fetch;

  if (token.length < 20) throw statusError('GITHUB_TOKEN_MISSING_OR_SHORT');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw statusError('GITHUB_REPOSITORY_INVALID');
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw statusError('TRACKING_ISSUE_NUMBER_INVALID');
  if (typeof fetchImpl !== 'function') throw statusError('FETCH_REQUIRED');

  const body = buildSiteV2StagingDeployComment(options);
  const url = new URL(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`);
  const response = await Reflect.apply(fetchImpl, globalThis, [url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'site-v2-staging-deploy-status'
    },
    body: JSON.stringify({ body })
  }]);

  if (!response.ok) throw statusError(`GITHUB_COMMENT_HTTP_${response.status}`);
  return Object.freeze({ ok: true, posted: true, issueNumber });
}

function sanitizeStatus(input) {
  return Object.freeze({
    workflow: outcome(input.workflow || input.workflowStatus),
    catalogAccept: outcome(input.catalogAccept),
    deploy: outcome(input.deploy),
    catalogSmoke: outcome(input.catalogSmoke),
    remoteSmoke: outcome(input.remoteSmoke),
    shadowSmoke: outcome(input.shadowSmoke),
    rollback: outcome(input.rollback),
    commit: commitSha(input.commit)
  });
}

function outcome(value) {
  const normalized = String(value || 'unknown').trim().toLowerCase();
  return ALLOWED_OUTCOMES.has(normalized) ? normalized : 'unknown';
}

function commitSha(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{7,40}$/.test(normalized) ? normalized.slice(0, 12) : 'desconhecido';
}

function statusError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  const result = await postSiteV2StagingDeployStatus({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    issueNumber: process.env.TRACKING_ISSUE_NUMBER,
    workflowStatus: process.env.WORKFLOW_STATUS,
    catalogAccept: process.env.CATALOG_ACCEPT_OUTCOME,
    deploy: process.env.DEPLOY_OUTCOME,
    catalogSmoke: process.env.CATALOG_SMOKE_OUTCOME,
    remoteSmoke: process.env.REMOTE_SMOKE_OUTCOME,
    shadowSmoke: process.env.SHADOW_SMOKE_OUTCOME,
    rollback: process.env.ROLLBACK_OUTCOME,
    commit: process.env.COMMIT_SHA
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    console.error(String(error?.code || 'SITE_V2_STAGING_DEPLOY_STATUS_FAILED'));
    process.exitCode = 1;
  });
}
