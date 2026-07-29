import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function acceptValidatedCatalogVersion(options = {}) {
  const reportPath = String(options.reportPath || '').trim();
  const statePath = String(options.statePath || '').trim();
  const outputPath = String(options.outputPath || '').trim();
  if (!reportPath) throw acceptanceError('CATALOG_REPORT_FILE_REQUIRED');
  if (!statePath) throw acceptanceError('CATALOG_ACCEPTED_STATE_FILE_REQUIRED');

  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const current = JSON.parse(await readFile(statePath, 'utf8'));

  const version = positiveInteger(report.catalogVersion);
  const accepted = nonNegativeInteger(current.acceptedCatalogVersion);
  const valid = report.ok === true &&
    report.traversalComplete === true &&
    nonNegativeInteger(report.rejectedCount) === 0 &&
    nonNegativeInteger(report.differenceCount) === 0;

  if (!valid) throw acceptanceError('CATALOG_VERSION_NOT_ELIGIBLE_FOR_AUTO_ACCEPT');
  if (!version) throw acceptanceError('CATALOG_VERSION_INVALID');
  if (version < accepted) throw acceptanceError('CATALOG_VERSION_REGRESSION');

  const changed = version > accepted;
  if (changed) {
    const next = {
      schemaVersion: 1,
      acceptedCatalogVersion: version,
      acceptedAt: validIso(report.generatedAt),
      acceptanceMode: 'full-readonly-contract-validation',
      validation: {
        traversalComplete: true,
        rejectedCount: 0,
        differenceCount: 0
      }
    };
    await writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  }

  if (outputPath) {
    await writeFile(outputPath, `changed=${changed}\naccepted_version=${version}\n`, { flag: 'a' });
  }

  const result = Object.freeze({ ok: true, changed, acceptedVersion: version, previousVersion: accepted });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function validIso(value) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) throw acceptanceError('CATALOG_REPORT_TIMESTAMP_INVALID');
  return date.toISOString();
}

function acceptanceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function main() {
  await acceptValidatedCatalogVersion({
    reportPath: process.env.CATALOG_REPORT_FILE,
    statePath: process.env.CATALOG_ACCEPTED_STATE_FILE,
    outputPath: process.env.GITHUB_OUTPUT
  });
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (executedPath === import.meta.url) {
  main().catch(error => {
    console.error(String(error?.code || 'CATALOG_AUTO_ACCEPT_FAILED'));
    process.exitCode = 1;
  });
}
