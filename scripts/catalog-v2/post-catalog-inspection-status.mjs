import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function buildCatalogInspectionComment(input = {}) {
  const report = sanitizeReport(input.report || {});
  const inspectionOutcome = outcome(input.inspectionOutcome);
  const deactivationOutcome = outcome(input.deactivationOutcome);
  const verifyOutcome = outcome(input.verifyOutcome);
  const rollbackOutcome = outcome(input.rollbackOutcome);
  const finalSafe = verifyOutcome === 'success' || rollbackOutcome === 'success';

  const lines = [
    '### Resultado da inspeção somente leitura',
    '',
    `- Inspeção: **${inspectionOutcome}**`,
    `- Desativação normal: **${deactivationOutcome}**`,
    `- Verificação da ponte desativada: **${verifyOutcome}**`,
    `- Rollback emergencial: **${rollbackOutcome}**`,
    `- Estado seguro confirmado ao final: **${finalSafe ? 'sim' : 'não confirmado'}**`,
    '',
    '#### Contagens sanitizadas',
    '',
    `- Versão do catálogo: ${report.catalogVersion}`,
    `- Requisições internas: ${report.requestCount}`,
    `- Temas: ${report.themeCount}`,
    `- Pastas percorridas: ${report.folderCount}`,
    `- Produtos virtuais: ${report.productCount}`,
    `- Artes únicas: ${report.artworkCount}`,
    `- Linhas rejeitadas: ${report.rejectedCount}`,
    `- Diferenças sombra: ${report.differenceCount}`,
    `- Percurso completo: ${report.traversalComplete ? 'sim' : 'não'}`
  ];

  if (report.error) {
    lines.push('', `- Código de erro sanitizado: \`${report.error}\``);
  }

  lines.push(
    '',
    'Nenhuma URL de arte, ID de arquivo, dado de cliente, token ou credencial foi incluído neste relatório.'
  );

  return lines.join('\n');
}

export async function postCatalogInspectionStatus(options = {}) {
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
  if (reportPath) {
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch (_) { report = {}; }
  }

  const body = buildCatalogInspectionComment({
    report,
    inspectionOutcome: options.inspectionOutcome,
    deactivationOutcome: options.deactivationOutcome,
    verifyOutcome: options.verifyOutcome,
    rollbackOutcome: options.rollbackOutcome
  });

  const url = new URL(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`);
  const response = await Reflect.apply(fetchImpl, globalThis, [url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'catalog-v2-readonly-inspection'
    },
    body: JSON.stringify({ body })
  }]);

  if (!response.ok) throw statusError(`GITHUB_COMMENT_HTTP_${response.status}`);
  return Object.freeze({ ok: true, issueNumber });
}

function sanitizeReport(input) {
  return Object.freeze({
    requestCount: nonNegativeInteger(input.requestCount),
    themeCount: nonNegativeInteger(input.themeCount),
    folderCount: nonNegativeInteger(input.folderCount),
    productCount: nonNegativeInteger(input.productCount),
    artworkCount: nonNegativeInteger(input.artworkCount),
    rejectedCount: nonNegativeInteger(input.rejectedCount),
    differenceCount: nonNegativeInteger(input.differenceCount),
    catalogVersion: nonNegativeInteger(input.catalogVersion),
    traversalComplete: input.traversalComplete === true,
    error: publicCode(input.error)
  });
}

function outcome(value) {
  const text = String(value || 'skipped').trim().toLowerCase();
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
  const result = await postCatalogInspectionStatus({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
    issueNumber: process.env.TRACKING_ISSUE_NUMBER,
    reportPath: process.env.CATALOG_REPORT_FILE,
    inspectionOutcome: process.env.INSPECTION_OUTCOME,
    deactivationOutcome: process.env.DEACTIVATION_OUTCOME,
    verifyOutcome: process.env.VERIFY_OUTCOME,
    rollbackOutcome: process.env.ROLLBACK_OUTCOME
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    const code = String(error?.code || 'CATALOG_STATUS_COMMENT_FAILED')
      .replace(/[^A-Z0-9_]/g, '')
      .slice(0, 100) || 'CATALOG_STATUS_COMMENT_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
