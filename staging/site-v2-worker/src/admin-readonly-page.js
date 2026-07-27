export const ADMIN_READONLY_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Armazem | Pedidos sintéticos</title>
  <link rel="stylesheet" href="/admin/app.css">
  <script src="/admin/app.js" defer></script>
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">ARMAZEM · AMBIENTE DE TESTE</p>
      <h1>Pedidos sintéticos</h1>
    </div>
    <div class="badges" aria-label="Estado do painel">
      <span class="badge badge-staging">STAGING</span>
      <span class="badge badge-readonly">SOMENTE LEITURA</span>
    </div>
  </header>

  <main class="shell">
    <section class="notice" aria-labelledby="notice-title">
      <div class="notice-icon" aria-hidden="true">i</div>
      <div>
        <h2 id="notice-title">Painel isolado da produção</h2>
        <p>Exibe exclusivamente pedidos do catálogo sintético 9001. Não possui controles para criar, editar, cancelar ou excluir pedidos.</p>
      </div>
    </section>

    <section class="access-card" aria-labelledby="access-title">
      <div>
        <p class="section-kicker">ACESSO TEMPORÁRIO</p>
        <h2 id="access-title">Conectar ao staging</h2>
        <p class="muted">A chave permanece apenas na memória desta aba e nunca é gravada no navegador.</p>
      </div>
      <form id="access-form" class="access-form" autocomplete="off">
        <label for="token">Chave de acesso do staging</label>
        <div class="access-row">
          <input id="token" name="token" type="password" minlength="32" maxlength="512" required autocomplete="off" spellcheck="false">
          <select id="limit" name="limit" aria-label="Quantidade máxima de pedidos">
            <option value="25">25 pedidos</option>
            <option value="50" selected>50 pedidos</option>
            <option value="100">100 pedidos</option>
          </select>
          <button type="submit" class="primary">Carregar</button>
          <button type="button" id="disconnect" class="secondary" disabled>Desconectar</button>
        </div>
      </form>
    </section>

    <div id="status" class="status" role="status" aria-live="polite">Informe a chave para consultar o ledger sintético.</div>

    <section id="dashboard" class="dashboard" hidden>
      <div class="summary-grid" aria-label="Resumo dos pedidos">
        <article class="metric"><span>Pedidos no ledger</span><strong id="order-count">0</strong></article>
        <article class="metric"><span>Valor sintético retornado</span><strong id="total-value">R$ 0,00</strong></article>
        <article class="metric"><span>Itens contabilizados</span><strong id="item-quantity">0</strong></article>
        <article class="metric"><span>Eventos pendentes</span><strong id="pending-outbox">0</strong></article>
      </div>

      <section class="orders-card" aria-labelledby="orders-title">
        <div class="orders-header">
          <div>
            <p class="section-kicker">LEDGER SQLITE · ANO ATUAL</p>
            <h2 id="orders-title">Pedidos recentes</h2>
          </div>
          <button type="button" id="refresh" class="secondary">Atualizar</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pedido</th>
                <th>Criado em</th>
                <th>Status</th>
                <th>Vendedor</th>
                <th>Itens</th>
                <th>Total</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody id="orders-body"></tbody>
          </table>
        </div>
        <div id="empty" class="empty" hidden>Nenhum pedido sintético encontrado.</div>
      </section>
    </section>
  </main>

  <footer>Armazem · Console V2 isolado · Dados pessoais removidos na API</footer>
</body>
</html>`;

export const ADMIN_READONLY_CSS = `
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #090b10;
  color: #f4f6fb;
  --panel: #11151d;
  --panel-2: #171c26;
  --line: #293140;
  --muted: #9ca7b8;
  --accent: #67e8f9;
  --accent-2: #22d3ee;
  --safe: #86efac;
  --danger: #fca5a5;
}
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 85% -10%, #16313b 0, transparent 32rem), #090b10; }
button, input, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .45; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 2rem; padding: 2rem clamp(1.25rem, 4vw, 4rem); border-bottom: 1px solid var(--line); background: rgba(9, 11, 16, .82); }
h1, h2, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: clamp(1.7rem, 3vw, 2.5rem); letter-spacing: -.04em; }
h2 { margin-bottom: .35rem; letter-spacing: -.025em; }
.eyebrow, .section-kicker { margin-bottom: .45rem; color: var(--accent); font-size: .72rem; font-weight: 800; letter-spacing: .16em; }
.badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .55rem; }
.badge { padding: .48rem .72rem; border-radius: 999px; border: 1px solid; font-size: .7rem; font-weight: 850; letter-spacing: .08em; }
.badge-staging { border-color: #155e75; background: #083344; color: #a5f3fc; }
.badge-readonly { border-color: #166534; background: #052e16; color: #bbf7d0; }
.shell { width: min(1380px, calc(100% - 2rem)); margin: 2rem auto 4rem; }
.notice, .access-card, .orders-card, .metric { border: 1px solid var(--line); background: linear-gradient(145deg, rgba(23,28,38,.96), rgba(14,18,25,.96)); box-shadow: 0 20px 70px rgba(0,0,0,.22); }
.notice { display: flex; gap: 1rem; padding: 1.15rem 1.3rem; border-radius: 16px; margin-bottom: 1rem; }
.notice p, .muted { margin-bottom: 0; color: var(--muted); line-height: 1.55; }
.notice-icon { display: grid; place-items: center; flex: 0 0 2rem; height: 2rem; border-radius: 50%; background: #164e63; color: #cffafe; font-weight: 900; }
.access-card { display: grid; grid-template-columns: minmax(240px, .75fr) minmax(420px, 1.25fr); gap: 2rem; padding: 1.4rem; border-radius: 18px; }
.access-form { align-self: end; }
.access-form label { display: block; margin-bottom: .55rem; color: #dbe4f0; font-size: .82rem; font-weight: 700; }
.access-row { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto auto; gap: .65rem; }
input, select, button { min-height: 44px; border-radius: 10px; border: 1px solid var(--line); }
input, select { width: 100%; padding: 0 .8rem; background: #0b0f16; color: #eef2f7; outline: none; }
input:focus, select:focus { border-color: var(--accent-2); box-shadow: 0 0 0 3px rgba(34,211,238,.14); }
button { padding: 0 1rem; font-weight: 800; }
.primary { border-color: #0e7490; background: #0891b2; color: white; }
.primary:hover { background: #0e7490; }
.secondary { background: #171c26; color: #dce5f2; }
.secondary:hover:not(:disabled) { border-color: #64748b; }
.status { margin: 1rem 0; min-height: 48px; display: flex; align-items: center; padding: .85rem 1rem; border-radius: 12px; border: 1px dashed var(--line); color: var(--muted); }
.status[data-tone="error"] { border-style: solid; border-color: #7f1d1d; background: rgba(69,10,10,.42); color: #fecaca; }
.status[data-tone="success"] { border-style: solid; border-color: #14532d; background: rgba(5,46,22,.42); color: #bbf7d0; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }
.metric { padding: 1.15rem; border-radius: 15px; }
.metric span { display: block; color: var(--muted); font-size: .78rem; font-weight: 700; }
.metric strong { display: block; margin-top: .45rem; font-size: clamp(1.35rem, 2.6vw, 2rem); }
.orders-card { border-radius: 18px; overflow: hidden; }
.orders-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.25rem 1.3rem; border-bottom: 1px solid var(--line); }
.orders-header h2 { margin-bottom: 0; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 930px; }
th, td { padding: .9rem 1rem; text-align: left; border-bottom: 1px solid rgba(41,49,64,.72); vertical-align: top; }
th { color: #9fb0c5; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; background: #0d1118; }
td { color: #dfe7f2; font-size: .86rem; }
td strong { color: white; }
.order-meta { display: block; margin-top: .2rem; color: var(--muted); font-size: .72rem; }
.pill { display: inline-flex; padding: .3rem .55rem; border-radius: 999px; background: #1e293b; color: #dbeafe; font-size: .72rem; font-weight: 800; }
.synthetic { color: var(--accent); }
.empty { padding: 3rem 1rem; text-align: center; color: var(--muted); }
footer { padding: 1.5rem; text-align: center; color: #657184; font-size: .74rem; }
@media (max-width: 980px) {
  .access-card { grid-template-columns: 1fr; }
  .access-row { grid-template-columns: 1fr 1fr; }
  .access-row input { grid-column: 1 / -1; }
  .summary-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 620px) {
  .topbar { align-items: flex-start; flex-direction: column; }
  .badges { justify-content: flex-start; }
  .access-row, .summary-grid { grid-template-columns: 1fr; }
  .shell { width: min(100% - 1rem, 1380px); }
}
`;

export const ADMIN_READONLY_JS = `
(() => {
  'use strict';

  const state = { token: '', loading: false };
  const form = document.getElementById('access-form');
  const tokenInput = document.getElementById('token');
  const limitInput = document.getElementById('limit');
  const disconnectButton = document.getElementById('disconnect');
  const refreshButton = document.getElementById('refresh');
  const statusNode = document.getElementById('status');
  const dashboard = document.getElementById('dashboard');
  const bodyNode = document.getElementById('orders-body');
  const emptyNode = document.getElementById('empty');

  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const integer = new Intl.NumberFormat('pt-BR');
  const dateTime = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Recife'
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const candidate = String(tokenInput.value || '').trim();
    if (candidate.length < 32) {
      setStatus('A chave precisa ter pelo menos 32 caracteres.', 'error');
      return;
    }
    state.token = candidate;
    await loadOrders();
  });

  refreshButton.addEventListener('click', loadOrders);
  disconnectButton.addEventListener('click', disconnect);

  async function loadOrders() {
    if (!state.token || state.loading) return;
    state.loading = true;
    setBusy(true);
    setStatus('Consultando o ledger sintético...', 'neutral');

    try {
      const url = new URL('/internal/v2/admin/orders', window.location.origin);
      url.searchParams.set('limit', String(limitInput.value || '50'));
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Staging-Token': state.token
        },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error'
      });
      const payload = await readJson(response);

      if (response.status === 401) {
        disconnect(false);
        throw new Error('Chave inválida ou expirada.');
      }
      if (!response.ok || payload?.ok !== true || payload?.readOnly !== true) {
        throw new Error('Falha na consulta: ' + String(payload?.error || response.status));
      }

      renderSummary(payload.summary || {});
      renderOrders(Array.isArray(payload.orders) ? payload.orders : []);
      dashboard.hidden = false;
      disconnectButton.disabled = false;
      setStatus('Consulta concluída. Nenhuma operação de escrita foi disponibilizada.', 'success');
    } catch (error) {
      setStatus(String(error?.message || 'Não foi possível carregar os pedidos.'), 'error');
    } finally {
      state.loading = false;
      setBusy(false);
    }
  }

  async function readJson(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error('A API retornou uma resposta inválida.');
    }
  }

  function renderSummary(summary) {
    setText('order-count', integer.format(number(summary.orderCount)));
    setText('total-value', money.format(number(summary.totalValue)));
    setText('item-quantity', integer.format(number(summary.itemQuantity)));
    setText('pending-outbox', integer.format(number(summary.pendingOutbox)));
  }

  function renderOrders(orders) {
    bodyNode.replaceChildren();
    emptyNode.hidden = orders.length !== 0;

    for (const order of orders) {
      const row = document.createElement('tr');
      row.append(
        cellWithMeta(order.orderNumber || '—', order.displayId || ''),
        textCell(formatDate(order.createdAt)),
        statusCell(order.status || '—'),
        cellWithMeta(order.seller?.label || order.seller?.id || '—', order.seller?.id || ''),
        cellWithMeta(integer.format(number(order.qty)), itemSummary(order.items)),
        textCell(money.format(number(order.pricing?.total))),
        sourceCell(order.source)
      );
      bodyNode.append(row);
    }
  }

  function textCell(value) {
    const cell = document.createElement('td');
    cell.textContent = String(value ?? '');
    return cell;
  }

  function cellWithMeta(primary, secondary) {
    const cell = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = String(primary || '—');
    cell.append(strong);
    if (secondary && secondary !== primary) {
      const meta = document.createElement('span');
      meta.className = 'order-meta';
      meta.textContent = String(secondary);
      cell.append(meta);
    }
    return cell;
  }

  function statusCell(value) {
    const cell = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = String(value || '—');
    cell.append(pill);
    return cell;
  }

  function sourceCell(value) {
    const cell = document.createElement('td');
    const source = document.createElement('span');
    source.className = 'synthetic';
    source.textContent = String(value || 'catalog-v2-staging-synthetic');
    cell.append(source);
    return cell;
  }

  function itemSummary(items) {
    if (!Array.isArray(items) || items.length === 0) return 'Sem itens';
    return items.map(item => String(item.driveFileId || item.itemId || 'item') + ' × ' + integer.format(number(item.quantity))).join(' · ');
  }

  function formatDate(value) {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? dateTime.format(date) : '—';
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value);
  }

  function setStatus(message, tone) {
    statusNode.textContent = String(message);
    if (tone === 'error' || tone === 'success') statusNode.dataset.tone = tone;
    else statusNode.removeAttribute('data-tone');
  }

  function setBusy(busy) {
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = busy;
    refreshButton.disabled = busy || !state.token;
    limitInput.disabled = busy;
  }

  function disconnect(showMessage = true) {
    state.token = '';
    tokenInput.value = '';
    bodyNode.replaceChildren();
    dashboard.hidden = true;
    disconnectButton.disabled = true;
    refreshButton.disabled = true;
    if (showMessage) setStatus('Sessão local encerrada. A chave foi removida da memória da página.', 'neutral');
    tokenInput.focus();
  }
})();
`;
