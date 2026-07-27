import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const workerSource = await readFile(new URL('staging/site-v2-worker/src/index.js', root), 'utf8');
const adminSource = await readFile(new URL('staging/site-v2-worker/src/admin-readonly-page.js', root), 'utf8');

test('painel e ativos são servidos somente por GET', () => {
  assert.ok(workerSource.includes("url.pathname === '/admin'"));
  assert.ok(workerSource.includes("url.pathname === '/admin/app.css'"));
  assert.ok(workerSource.includes("url.pathname === '/admin/app.js'"));
  assert.ok(workerSource.includes("methodNotAllowed(['GET'], requestId)"));
});

test('consulta administrativa é autenticada e estritamente somente de leitura', () => {
  assert.ok(workerSource.includes("url.pathname === '/internal/v2/admin/orders'"));
  assert.ok(workerSource.includes("request.headers.get('x-staging-token')"));
  assert.ok(workerSource.includes('readOnly: true'));
  assert.ok(workerSource.includes("catalog: 'synthetic-staging-only'"));
  assert.ok(workerSource.includes('events.filter'));
  assert.ok(workerSource.includes('orderInspectionView(event.payload.order)'));
  assert.equal(workerSource.includes("'/internal/v2/admin/orders/create'"), false);
  assert.equal(workerSource.includes("'/internal/v2/admin/orders/update'"), false);
  assert.equal(workerSource.includes("'/internal/v2/admin/orders/delete'"), false);
});

test('dados pessoais continuam removidos da resposta administrativa', () => {
  assert.ok(workerSource.includes('customer: { redacted: true }'));
  assert.ok(workerSource.includes('adminSummary(orders, ledgerHealth)'));
  assert.equal(workerSource.includes('customer.whatsapp'), false);
  assert.equal(workerSource.includes('customer.phone'), false);
});

test('chave não é persistida nem enviada em URL', () => {
  assert.ok(adminSource.includes('type="password"'));
  assert.ok(adminSource.includes("'X-Staging-Token': state.token"));
  assert.ok(adminSource.includes("url.searchParams.set('limit'"));
  assert.equal(adminSource.includes('localStorage'), false);
  assert.equal(adminSource.includes('sessionStorage'), false);
  assert.equal(adminSource.includes("searchParams.set('token'"), false);
  assert.equal(adminSource.includes('document.cookie'), false);
});

test('interface não contém chamadas de mutação e renderiza dados com textContent', () => {
  assert.ok(adminSource.includes("method: 'GET'"));
  assert.ok(adminSource.includes('replaceChildren()'));
  assert.ok(adminSource.includes('textContent'));
  assert.equal(adminSource.includes("method: 'POST'"), false);
  assert.equal(adminSource.includes("method: 'PUT'"), false);
  assert.equal(adminSource.includes("method: 'PATCH'"), false);
  assert.equal(adminSource.includes("method: 'DELETE'"), false);
  assert.equal(adminSource.includes('innerHTML'), false);
});

test('página bloqueia indexação, framing e recursos externos', () => {
  assert.ok(adminSource.includes('noindex,nofollow,noarchive'));
  assert.ok(workerSource.includes("frame-ancestors 'none'"));
  assert.ok(workerSource.includes("style-src 'self'"));
  assert.ok(workerSource.includes("script-src 'self'"));
  assert.ok(workerSource.includes("connect-src 'self'"));
  assert.ok(workerSource.includes("X-Frame-Options': 'DENY'"));
  assert.equal(/https?:\/\//.test(adminSource), false);
});
