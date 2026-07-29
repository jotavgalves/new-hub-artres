import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.github',
  'docs',
  'node_modules',
  'src',
  'staging',
  'tests'
]);
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.mjs', '.md', '.txt']);

function extension(path) {
  const match = path.match(/\.[^.\\/]+$/);
  return match ? match[0].toLowerCase() : '';
}

function productionRuntimeFiles(directory = ROOT) {
  const files = [];

  for (const name of readdirSync(directory)) {
    if (directory === ROOT && SKIPPED_DIRECTORIES.has(name)) continue;

    const absolute = join(directory, name);
    const stats = statSync(absolute);

    if (stats.isDirectory()) {
      files.push(...productionRuntimeFiles(absolute));
      continue;
    }

    if (TEXT_EXTENSIONS.has(extension(absolute))) files.push(absolute);
  }

  return files;
}

test('nenhum arquivo do runtime público de produção importa ou carrega o registro V2', () => {
  const forbiddenPatterns = [
    /src\/v2\/products\/registry\.mjs/i,
    /product-registry\.test\.mjs/i,
    /production-isolation\.test\.mjs/i
  ];

  const violations = [];

  for (const file of productionRuntimeFiles()) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.test(content)) {
        violations.push(`${relative(ROOT, file)} -> ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('staging permanece explicitamente fora do conjunto de runtime público', () => {
  assert.equal(SKIPPED_DIRECTORIES.has('staging'), true);
  assert.equal(
    productionRuntimeFiles().some(file => relative(ROOT, file).startsWith(`staging${process.platform === 'win32' ? '\\' : '/'}`)),
    false
  );
});
