(function(){
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
  let config = null;
  let meta = null;
  let timer = null;

  async function api(url, opts = {}) {
    const r = await fetch(url, { credentials:'include', cache:'no-store', headers:{ 'Content-Type':'application/json', ...(opts.headers || {}) }, ...opts });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || 'Erro');
    return d;
  }
  function toast(msg, type='ok') {
    const el = $('status');
    if (!el) return;
    clearTimeout(timer);
    el.textContent = msg;
    el.className = 'status ' + type;
    el.classList.remove('hidden');
    timer = setTimeout(() => { if (el.textContent === msg) el.classList.add('hidden'); }, type === 'err' ? 6500 : 3500);
  }
  function productionDefaults(input) {
    return {
      enabled: input && input.enabled !== false,
      allowStatusUpdate: !input || input.allowStatusUpdate !== false,
      statusOnFetch: input && input.statusOnFetch || '',
      statusOnComplete: input && input.statusOnComplete || 'Separado',
      actorName: input && input.actorName || 'Armazem',
      exposeCustomer: true,
      exposeTotals: false
    };
  }
  function ensureOrderStatuses() {
    config.orderSettings = config.orderSettings || {};
    const base = Array.isArray(config.orderSettings.statuses) ? config.orderSettings.statuses : ['Novo','Em atendimento','Fechado','Cancelado'];
    ['Em produção','Separado'].forEach(s => { if (!base.includes(s)) base.push(s); });
    config.orderSettings.statuses = base;
  }
  async function load() {
    const cfg = await api('/api/admin/config?ts=' + Date.now());
    const prod = await api('/api/admin/production?ts=' + Date.now());
    config = cfg.config || {};
    config.productionApi = productionDefaults(config.productionApi || prod.production || {});
    ensureOrderStatuses();
    meta = prod;
    render();
  }
  async function save() {
    if (!config) return;
    config.productionApi = productionDefaults(config.productionApi || {});
    ensureOrderStatuses();
    await api('/api/admin/config', { method:'POST', body:JSON.stringify({ config }) });
    toast('API de produção salva.');
    await load();
  }
  function setField(name, value) {
    config.productionApi = productionDefaults(config.productionApi || {});
    if (value === 'true') value = true;
    if (value === 'false') value = false;
    config.productionApi[name] = value;
  }
  function render() {
    const panel = $('toolsPanel');
    if (!panel || !config || !meta) return;
    const p = productionDefaults(config.productionApi || {});
    let card = $('productionApiCard');
    if (!card) {
      card = document.createElement('div');
      card.id = 'productionApiCard';
      card.className = 'card span-12';
      panel.appendChild(card);
    }
    const statuses = meta.statuses || config.orderSettings.statuses || ['Novo','Em atendimento','Em produção','Separado','Fechado','Cancelado'];
    const statusOptions = value => `<option value="" ${!value?'selected':''}>Não alterar automaticamente</option>` + statuses.map(s => `<option value="${esc(s)}" ${value===s?'selected':''}>${esc(s)}</option>`).join('');
    card.innerHTML = `<div class="sectionHead"><div><h3>App desktop / Produção</h3><p>O app informa o número do pedido e recebe somente cliente, data, vendedora, IDs e quantidades.</p></div><span class="pill">${meta.tokenConfigured?'Token configurado':'Token não configurado'}</span></div>
      <div class="grid productionSettingsGrid">
        <div class="field span-3"><label>API do app</label><select data-prod-field="enabled"><option value="true" ${p.enabled?'selected':''}>Ativada</option><option value="false" ${!p.enabled?'selected':''}>Desativada</option></select></div>
        <div class="field span-3"><label>Alterar status pelo app</label><select data-prod-field="allowStatusUpdate"><option value="true" ${p.allowStatusUpdate?'selected':''}>Sim</option><option value="false" ${!p.allowStatusUpdate?'selected':''}>Não</option></select></div>
        <div class="field span-3"><label>Status ao buscar</label><select data-prod-field="statusOnFetch">${statusOptions(p.statusOnFetch)}</select></div>
        <div class="field span-3"><label>Status ao concluir</label><select data-prod-field="statusOnComplete">${statusOptions(p.statusOnComplete)}</select></div>
        <div class="field span-4"><label>Responsável</label><input data-prod-field="actorName" value="${esc(p.actorName)}"></div>
        <div class="field span-8"><label>Endpoint para o app</label><input readonly value="${esc(location.origin + (meta.endpoint || '/api/production/order?number=PED2600001A'))}"></div>
        <div class="field span-12"><p class="hint">Token: configure <b>ARMAZEM_DESKTOP_TOKEN</b> no Cloudflare Pages. O app envia <b>Authorization: Bearer SEU_TOKEN</b>.</p></div>
        <div class="field span-12"><button id="saveProductionApi" class="btn green" type="button">Salvar API de produção</button></div>
      </div>
      <div class="card softCard productionTestCard"><div class="sectionHead"><div><h3>Teste de pedido</h3><p>Retorno compacto que o app desktop vai receber.</p></div></div><div class="productionTestTop"><div class="field"><label>Número do pedido</label><input id="productionOrderNumber" placeholder="PED2600001A"></div><button id="testProductionOrder" class="btn secondary" type="button">Testar</button></div><div class="field productionResultField"><label>Resultado</label><pre id="productionResult" class="jsonBox">Digite um pedido e clique em Testar.</pre></div></div>`;
    card.querySelectorAll('[data-prod-field]').forEach(el => {
      el.oninput = () => setField(el.dataset.prodField, el.value);
      el.onchange = () => setField(el.dataset.prodField, el.value);
    });
    $('saveProductionApi').onclick = save;
    $('testProductionOrder').onclick = testOrder;
  }
  async function testOrder() {
    const number = String($('productionOrderNumber') && $('productionOrderNumber').value || '').trim();
    if (!number) return toast('Digite o número do pedido para testar.', 'err');
    const out = $('productionResult');
    try {
      out.textContent = 'Buscando...';
      const d = await api('/api/admin/production', { method:'POST', body:JSON.stringify({ number }) });
      out.textContent = JSON.stringify(d.payload || d, null, 2);
    } catch (e) {
      out.textContent = e.message || 'Erro';
    }
  }
  function ensureStyle() {
    if ($('productionApiStyle')) return;
    const s = document.createElement('style');
    s.id = 'productionApiStyle';
    s.textContent = '#productionApiCard .pill{white-space:nowrap}.softCard{border:1px solid #eee2e4!important;border-radius:18px!important;background:#fff!important}#productionApiCard input[readonly]{background:#f8f5f3;color:#5f5960;font-weight:800}.productionTestCard{margin-top:14px}.productionTestTop{display:grid;grid-template-columns:minmax(260px,420px) auto;gap:12px;align-items:end;margin-top:12px}.productionTestTop .btn{min-height:48px;white-space:nowrap}.productionResultField{margin-top:14px}.productionResultField .jsonBox{max-height:360px;min-height:180px}@media(max-width:760px){.productionTestTop{grid-template-columns:1fr}.productionTestTop .btn{width:100%}}';
    document.head.appendChild(s);
  }
  function bootWhenNeeded() {
    ensureStyle();
    if (!$('toolsPanel')) return;
    if (document.body.dataset.adminTab === 'toolsView' || !$('productionApiCard')) load().catch(() => {});
  }
  document.addEventListener('click', e => {
    const tab = e.target && e.target.closest('[data-tab]');
    if (!tab || tab.dataset.tab !== 'toolsView') return;
    setTimeout(bootWhenNeeded, 350);
  });
  new MutationObserver(() => {
    if ($('toolsPanel') && document.body.dataset.adminTab === 'toolsView' && !$('productionApiCard')) bootWhenNeeded();
  }).observe(document.body, { childList:true, subtree:true });
  setTimeout(bootWhenNeeded, 1200);
})();
