(function(){
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
  const money = v => Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  let orders = [];
  let toastTimer = null;
  let loading = false;
  let renderTimer = null;

  async function api(url, opts={}){
    const r = await fetch(url, { credentials:'include', cache:'no-store', headers:{'Content-Type':'application/json', ...(opts.headers || {})}, ...opts });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || 'Erro');
    return d;
  }
  function panel(){ return $('ordersPanel'); }
  function isClientesSubtab(){ return document.body.dataset.ordersSubtab === 'clientes'; }
  function isOrdersActive(){ return !isClientesSubtab() && (document.body.dataset.adminTab === 'ordersView' || (!$('ordersView')?.classList.contains('hidden'))); }
  function toast(msg, type='ok'){
    const el = $('status');
    if (!el) return;
    clearTimeout(toastTimer);
    el.textContent = msg;
    el.className = 'status ' + type;
    el.classList.remove('hidden');
    toastTimer = setTimeout(() => { if (el.textContent === msg) el.classList.add('hidden'); }, type === 'err' ? 6500 : 3500);
  }
  function digits(v){ return String(v || '').replace(/\D/g, ''); }
  function wa(phone){ const d = digits(phone); return d ? 'https://wa.me/' + (d.startsWith('55') ? d : '55' + d) : '#'; }
  function formatDate(value){ try { return new Date(value).toLocaleString('pt-BR'); } catch(e) { return value || ''; } }
  function orderNo(o){ return o.orderNumber || o.orderCode || o.displayId || o.id || ''; }

  function claimOrdersPanel(){
    const target = panel();
    if (!target || !isOrdersActive()) return false;
    if (target.dataset.ordersOwner === 'unified' && $('ordersListV2')) return true;
    target.dataset.ordersOwner = 'unified';
    target.innerHTML = '<div class="card span-12"><div class="sectionHead"><div><h3>Pedidos</h3><p>Pedidos salvos com número curto no formato PED2600001A.</p></div><button id="reloadOrdersV2" class="btn secondary" type="button">Atualizar</button></div><div class="grid"><div class="field span-4"><label>Buscar pedido</label><input id="orderSearch" placeholder="PED2600001A, nome, telefone, código..."></div><div class="field span-3"><label>Vendedora</label><select id="sellerFilter"><option value="">Todas</option></select></div><div class="field span-3"><label>Data</label><input id="dateFilter" type="date"></div><div class="field span-2"><label>Limpar</label><button id="clearOrderFilters" class="btn secondary" type="button">Limpar filtros</button></div></div><div id="ordersListV2"><p class="hint">Carregando pedidos...</p></div></div>';
    $('reloadOrdersV2').onclick = () => load(true);
    $('orderSearch').oninput = renderList;
    $('sellerFilter').onchange = renderList;
    $('dateFilter').oninput = renderList;
    $('clearOrderFilters').onclick = () => { $('orderSearch').value=''; $('sellerFilter').value=''; $('dateFilter').value=''; renderList(); };
    return true;
  }

  function renderShell(){
    if (!claimOrdersPanel()) return;
    load(false);
  }

  async function load(showToast){
    if (loading || isClientesSubtab()) return;
    loading = true;
    try {
      const d = await api('/api/orders?limit=500');
      orders = d.orders || [];
      claimOrdersPanel();
      renderFilters();
      renderList();
      if (showToast) toast('Pedidos atualizados.');
    } catch(e) {
      const list = $('ordersListV2');
      if (list) list.innerHTML = '<p class="hint">' + esc(e.message) + '</p>';
    } finally { loading = false; }
  }

  function renderFilters(){
    const sel = $('sellerFilter');
    if (!sel) return;
    const current = sel.value;
    const sellers = Array.from(new Set(orders.map(o => o.seller && o.seller.label).filter(Boolean))).sort();
    sel.innerHTML = '<option value="">Todas</option>' + sellers.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    sel.value = current;
  }

  function matches(order){
    const q = ($('orderSearch')?.value || '').toLowerCase().trim();
    const compactQ = q.replace(/[^a-z0-9]/g, '');
    const seller = $('sellerFilter')?.value || '';
    const date = $('dateFilter')?.value || '';
    const customer = order.customer || {};
    const parts = [orderNo(order), order.id, order.legacyId, customer.name, customer.phone, customer.whatsapp, order.seller && order.seller.label, order.partyDate, customer.partyDate, order.notes, customer.notes].concat((order.items || []).map(i => i.code + ' ' + i.theme));
    const hay = parts.join(' ').toLowerCase();
    const compactHay = hay.replace(/[^a-z0-9]/g, '');
    if (q && !hay.includes(q) && !compactHay.includes(compactQ)) return false;
    if (seller && (!order.seller || order.seller.label !== seller)) return false;
    if (date && String(order.createdAt || '').slice(0,10) !== date) return false;
    return true;
  }

  function renderList(){
    const list = $('ordersListV2');
    if (!list || isClientesSubtab()) return;
    const filtered = orders.filter(matches);
    if (!filtered.length) { list.innerHTML = '<p class="hint">Nenhum pedido encontrado.</p>'; return; }
    list.innerHTML = '<div class="ordersSummary"><b>' + filtered.length + ' pedido(s)</b><span>' + orders.length + ' no total</span></div>' + filtered.map(orderCard).join('');
    list.querySelectorAll('[data-copy-customer]').forEach(btn => btn.onclick = () => copyCustomer(btn.dataset.copyCustomer));
    list.querySelectorAll('[data-delete-order-v2]').forEach(btn => btn.onclick = () => deleteOrder(btn.dataset.deleteOrderV2));
  }

  function orderCard(o){
    const c = o.customer || {};
    const phone = c.whatsapp || c.phone || '';
    const no = orderNo(o);
    const items = (o.items || []).slice(0, 20).map(i => '#' + esc(i.code) + ' (' + esc(i.qty || 1) + 'x)').join(' · ');
    const phoneLink = wa(phone);
    return '<div class="item orderCardV2"><div class="itemHead"><div><span class="orderNumberPill">' + esc(no) + '</span><p class="hint">' + esc(formatDate(o.createdAt)) + ' · ' + esc(o.seller && o.seller.label || 'Sem vendedora') + ' · ' + esc(o.qty || 0) + ' item(ns)</p></div><div class="actions"><a class="btn secondary" href="' + esc(phoneLink) + '" target="_blank" rel="noopener">Abrir conversa</a><button class="btn secondary" data-copy-customer="' + esc(o.id) + '" type="button">Copiar dados</button><button class="btn danger" data-delete-order-v2="' + esc(o.id) + '" type="button">Excluir</button></div></div><div class="orderCustomer"><b>Cliente:</b> ' + esc(c.name || 'Não informado') + ' · <b>WhatsApp:</b> ' + esc(phone || 'Não informado') + '</div><p class="hint"><b>Status:</b> ' + esc(o.status || 'Novo') + ' · <b>Total:</b> ' + money(o.totals && o.totals.net) + ' · <b>Desconto:</b> ' + money(o.totals && o.totals.discount) + '</p><p class="hint">' + items + '</p></div>';
  }

  function copyCustomer(id){
    const o = orders.find(x => x.id === id);
    if (!o) return;
    const c = o.customer || {};
    const text = ['Pedido: ' + orderNo(o), 'Cliente: ' + (c.name || ''), 'WhatsApp: ' + (c.whatsapp || c.phone || ''), 'Vendedora: ' + ((o.seller && o.seller.label) || ''), 'Itens: ' + (o.items || []).map(i => '#' + i.code + ' (' + (i.qty || 1) + 'x)').join(', ')].join('\n');
    navigator.clipboard?.writeText(text).then(() => toast('Dados copiados.')).catch(() => toast('Não consegui copiar.', 'err'));
  }

  async function deleteOrder(id){
    if (!confirm('Excluir este pedido?')) return;
    try {
      await api('/api/orders/delete', { method:'POST', body: JSON.stringify({ id }) });
      orders = orders.filter(o => o.id !== id);
      renderList();
      toast('Pedido excluído.');
    } catch(e) { toast(e.message || 'Erro ao excluir', 'err'); }
  }

  function injectStyle(){
    if ($('ordersUnifiedStyle')) return;
    const s = document.createElement('style');
    s.id = 'ordersUnifiedStyle';
    s.textContent = '.ordersSummary{display:flex;justify-content:space-between;gap:12px;margin:16px 0 10px;flex-wrap:wrap}.ordersSummary b{font-family:Montserrat}.orderCardV2 .actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.orderCustomer{margin:12px 0 6px;padding:10px 12px;background:#fff8fb;border:1px solid #ffd6e5;border-radius:14px;color:#4d454d;font-weight:800}.orderNumberPill{display:inline-flex;align-items:center;border-radius:999px;background:#222124;color:#fff;font-weight:950;letter-spacing:.06em;padding:7px 12px;margin-bottom:6px;font-family:Montserrat,Arial,sans-serif}@media(max-width:720px){.orderCardV2 .itemHead{align-items:flex-start}.orderCardV2 .actions .btn{width:100%;justify-content:center}.orderNumberPill{font-size:13px}}';
    document.head.appendChild(s);
  }

  function scheduleRender(){
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      if (isClientesSubtab()) return;
      if (!isOrdersActive()) return;
      if (!$('ordersListV2')) renderShell();
    }, 180);
  }

  document.addEventListener('click', e => { if (e.target && e.target.closest('[data-tab="ordersView"]')) { document.body.dataset.ordersSubtab = 'solicitacoes'; setTimeout(renderShell, 220); } });
  injectStyle();
  new MutationObserver(scheduleRender).observe(document.body, { childList:true, subtree:true });
  setTimeout(() => { if (isOrdersActive()) renderShell(); }, 900);
})();