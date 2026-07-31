import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = {
  page: 'staging/site-v2-worker/src/admin-readonly-page.js',
  cache: 'staging/site-v2-worker/src/admin-sales-cache-do.js',
  client: 'staging/site-v2-worker/src/admin-sales-cache-client.js',
  route: 'staging/site-v2-worker/src/ledger-inspection-routes.js',
  worker: 'staging/site-v2-worker/src/index-shadow.js',
  wrangler: 'wrangler.site-v2-staging.jsonc'
};

test('painel usa cache de sessão sem persistir token', async () => {
  const source = await readFile(files.page, 'utf8');
  assert.match(source, /sessionStorage/);
  assert.match(source, /If-None-Match/);
  assert.match(source, /Cache validado/);
  assert.match(source, /last-updated/);
  assert.match(source, /data-revision/);
  assert.match(source, /\/internal\/v2\/admin\/orders\/stream/);
  assert.match(source, /FALLBACK_REFRESH_MS = 60000/);
  assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /sessionStorage\.setItem\([^\n]*token/i);
});

test('API administrativa usa snapshot, ETag e resposta 304', async () => {
  const source = await readFile(files.route, 'utf8');
  assert.match(source, /adminSalesCacheStub/);
  assert.match(source, /if-none-match/);
  assert.match(source, /status: 304/);
  assert.match(source, /private, max-age=0, must-revalidate/);
  assert.match(source, /X-Data-Revision/);
  assert.match(source, /handleAdminOrdersStream/);
  assert.match(source, /admin-sales-cache-client\.js/);
  assert.doesNotMatch(source, /cloudflare:workers/);
});

test('pedido criado invalida cache e publica revisão ao vivo', async () => {
  const cache = await readFile(files.cache, 'utf8');
  const client = await readFile(files.client, 'utf8');
  const worker = await readFile(files.worker, 'utf8');
  assert.match(cache, /orderCommitted/);
  assert.match(cache, /this\.#broadcast\('revision'/);
  assert.match(cache, /RECONCILE_AFTER_MS = 30_000/);
  assert.match(client, /scheduleAdminSalesCacheRefresh/);
  assert.match(worker, /scheduleCommittedEffects/);
  assert.match(worker, /ADMIN_ORDERS_STREAM_ROUTE/);
  assert.match(worker, /adminSalesCacheStatus/);
});

test('Durable Object de cache está isolado e versionado no Wrangler', async () => {
  const source = await readFile(files.wrangler, 'utf8');
  assert.match(source, /"name": "ADMIN_SALES_CACHE"/);
  assert.match(source, /"class_name": "AdminSalesCache"/);
  assert.match(source, /"tag": "v2"/);
  assert.match(source, /"new_sqlite_classes": \["AdminSalesCache"\]/);
});
