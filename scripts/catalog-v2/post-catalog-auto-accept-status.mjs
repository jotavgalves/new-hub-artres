import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function buildCatalogAutoAcceptComment(input = {}) {
  const report = sanitizeReport(input.report || {});
  const outcome = sanitizeOutcome(input.outcome);
  const authenticated = report.source === 'google-drive-service-account';
  const lines = [
    '### Aceitação automática do catálogo V2',
    '',
    `- Resultado do workflow: **${outcome}**`,
    `- Fonte: **${authenticated ? 'Google Drive autenticado' : 'catálogo legado'}**`,
    `- Integração configurada: **${report.configured ? 'sim' : 'não'}**`,
    `- Ação: **${report.action || 'FAILED'}**`,
    `- Versão: **${report.catalogVersion}**`,
    `- Aceita no staging: **${report.accepted ? 'sim' : 'não'}**`,
    `- Catálogo alterado: **${report.changed ? 'sim' : 'não'}**`,
    `- Percurso completo: **${report.traversalComplete ? 'sim' : 'não'}**`,
    `- Rotas navegáveis: ${report.routeCount}`,
    `- Temas: ${report.themeCount}`,
    `- Pastas: ${report.folderCount}`,
    `- Produtos virtuais: ${report.productCount}`,
    `- Artes únicas: ${report.artworkCount}`,
    `- Ocorrências no relatório: ${report.issueCount}`,
    `- Linhas rejeitadas: ${report.rejectedCount}`,
    `- Diferenças de contrato: ${report.differenceCount}`
  ];
  for (const root of report.roots) {
    lines.push(`- Produto \`${root.productKey}\`: ${root.themesPublished} tema(s), ${root.foldersPublished} pasta(s), ${root.artworksPublished} arte(s)`);
  }
  if (report.issueSummary.length) {
    lines.push('', 'Principais ocorrências sanitizadas:');
    for (const item of report.issueSummary.slice(0, 10)) lines.push(`- \`${item.code}\`: ${item.count}`);
  }
  if (report.error) lines.push('', `- Código de erro sanitizado: \`${report.error}\``);
  if (report.action === 'NOT_CONFIGURED') {
    lines.push('', 'A sincronização autenticada está instalada, mas o segredo da conta de serviço ainda não foi cadastrado. A versão anterior permaneceu ativa.');
  }
  lines.push('', 'A versão anterior permanece ativa quando a validação ou a carga falha. Nenhum ID de arquivo, URL de arte, token, e-mail de serviço, chave privada ou dado de cliente foi incluído.');
  return lines.join('\n');
}

export async function postCatalogAutoAcceptStatus(options = {}) {
  const token = String(options.token || '').trim();
  const repository = String(options.repository || '').trim();
  const issueNumber = Number.parseInt(options.issueNumber, 10);
  const reportPath = String(options.reportPath || '').trim();
  const fetchImpl = options.fetch || globalThis.fetch;

  if (token.length < 20) throw statusError('GITHUB_TOKEN_MISSING_OR_SHORT');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw statusError('GITHUB_REPOSITORY_INVALID');
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw statusError('TRACKING_ISSUE_NUMBER_INVALID');
  if (typeof fetchImpl !== 'function') throw statusError('FETCH_REQUIRED');

  let report = {};
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch (_) {}
  const sanitized = sanitizeReport(report);
  if (sanitized.action === 'UNCHANGED' && options.outcome === 'success') {
    return Object.freeze({ ok: true, posted: false, reason: 'UNCHANGED' });
  }

  const body = buildCatalogAutoAcceptComment({ report: sanitized, outcome: options.outcome });
  const url = new URL(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`);
  const response = await Reflect.apply(fetchImpl, globalThis, [url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'catalog-v2-auto-accept'
    },
    body: JSON.stringify({ body })
  }]);
  if (!response.ok) throw statusError(`GITHUB_COMMENT_HTTP_${response.status}`);
  return Object.freeze({ ok: true, posted: true, issueNumber });
}

function sanitizeReport(input) {
  return Object.freeze({
    source: input.source === 'google-drive-service-account' ? input.source : 'legacy-public-catalog',
    configured: input.configured !== false,
    action: ['ACCEPTED', 'REPLAY', 'UNCHANGED', 'NOT_CONFIGURED'].includes(input.action) ? input.action : '',
    catalogVersion: nonNegativeInteger(input.catalogVersion),
    accepted: input.accepted === true,
    changed: input.changed === true,
    traversalComplete: input.traversalComplete === true,
    routeCount: nonNegativeInteger(input.routeCount),
    themeCount: nonNegativeInteger(input.themeCount || rootsTotal(input.roots, 'themesPublished')),
    folderCount: nonNegativeInteger(input.folderCount),
    productCount: nonNegativeInteger(input.productCount || (Array.isArray(input.roots) ? input.roots.length : 0)),
    artworkCount: nonNegativeInteger(input.artworkCount),
    issueCount: nonNegativeInteger(input.issueCount),
    issueSummary: sanitizeIssueSummary(input.issueSummary),
    roots: sanitizeRoots(input.roots),
    rejectedCount: nonNegativeInteger(input.rejectedCount),
    differenceCount: nonNegativeInteger(input.differenceCount),
    error: publicCode(input.error)
  });
}

function sanitizeIssueSummary(value) {
  return (Array.isArray(value) ? value : []).slice(0, 20).map(item => ({
    code: publicCode(item?.code) || 'CATALOG_SCAN_ISSUE',
    count: nonNegativeInteger(item?.count)
  })).filter(item => item.count > 0);
}

function sanitizeRoots(value) {
  return (Array.isArray(value) ? value : []).slice(0, 10).map(root => ({
    productKey: safeToken(root?.productKey),
    themesPublished: nonNegativeInteger(root?.themesPublished),
    foldersPublished: nonNegativeInteger(root?.foldersPublished),
    artworksPublished: nonNegativeInteger(root?.artworksPublished)
  }));
}

function rootsTotal(roots, field) {
  return (Array.isArray(roots) ? roots : []).reduce((sum, root) => sum + nonNegativeInteger(root && root[field]), 0);
}

function safeToken(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._-]{1,160}$/.test(text) ? text : 'produto';
}

function sanitizeOutcome(value) {
  const text = String(value || 'unknown').trim().toLowerCase();
  return ['success', 'failure', 'cancelled', 'skipped'].includes(text) ? text : 'unknown';
}

function publicCode(value) {
  const text = String(value || '').trim();
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : '';
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function statusError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  const result = await postCatalogAutoAcceptStatus({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    issueNumber: process.env.TRACKING_ISSUE_NUMBER,
    reportPath: process.env.CATALOG_REPORT_FILE,
    outcome: process.env.PUBLISH_OUTCOME
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    console.error(String(error?.code || 'CATALOG_AUTO_ACCEPT_STATUS_FAILED'));
    process.exitCode = 1;
  });
}
