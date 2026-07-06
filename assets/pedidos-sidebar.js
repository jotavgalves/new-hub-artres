(function(){
  var clientes = [];
  function $(id){ return document.getElementById(id); }
  function qs(sel){ return document.querySelector(sel); }
  function esc(v){ return String(v || '').replace(/[&<>]/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[m]; }); }
  function dig(v){ return String(v || '').replace(/\D/g, ''); }
  function phone(v){ var d = dig(v); if (d.indexOf('55') === 0) d = d.slice(2); if (d.length === 11) return '(' + d.slice(0,2) + ') ' + d.slice(2,7) + '-' + d.slice(7); if (d.length === 10) return '(' + d.slice(0,2) + ') ' + d.slice(2,6) + '-' + d.slice(6); return d; }
  function date(v){ try { return new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); } catch(e){ return v || '—'; } }
  function money(v){ return Number(v || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
  function ordersBtn(){ return qs('[data-tab="ordersView"]'); }
  function panel(){ return $('ordersPanel'); }

  function injectStyle(){
    if ($('pedidosSidebarCss')) return;
    var s = document.createElement('style');
    s.id = 'pedidosSidebarCss';
    s.textContent = '.pedidosSubnav{display:grid;gap:6px;margin:-4px 0 10px 18px;padding-left:12px;border-left:2px solid rgba(239,85,133,.25);animation:pedidoDrop .18s ease both}.pedidosSubnav.is-hidden{display:none!important}.pedidosSubnav button{border:0;background:transparent;text-align:left;border-radius:14px;padding:9px 12px;font-weight:900;color:#766d77;cursor:pointer}.pedidosSubnav button.on{background:#fff1f6;color:#d9366b}.clientesHeader{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:16px}.clientesHeader h3{margin:0;font-family:Montserrat;font-size:26px}.clientesHeader p{margin:4px 0 0;color:#706878}.clientesMetrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0 18px}.clientesMetrics div,.clienteCard{background:#fff;border:1px solid #efdfe4;border-radius:22px;box-shadow:0 14px 36px rgba(31,27,35,.05)}.clientesMetrics div{padding:16px}.clientesMetrics b{display:block;font-size:26px;font-family:Montserrat}.clientesMetrics span{font-weight:900;color:#766d77}.clientesSearch{width:100%;box-sizing:border-box;border:1px solid #efdfe4;border-radius:18px;padding:14px 16px;font:inherit;background:#fff;margin-bottom:16px}.clienteCard{padding:18px;margin:12px 0}.clienteTop{display:flex;justify-content:space-between;gap:14px}.clienteTop h4{margin:0;font-size:20px;font-family:Montserrat}.clienteTop p{margin:6px 0 0;color:#706878;font-weight:900}.clienteBadge{background:#fff1f6;color:#b61f55;border-radius:999px;padding:8px 12px;font-weight:900;height:max-content}.clienteInfo{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:16px 0}.clienteInfo div{background:#fff8fb;border-radius:16px;padding:12px}.clienteInfo small{display:block;font-size:11px;text-transform:uppercase;font-weight:900;color:#817681}.codigoChips{display:flex;flex-wrap:wrap;gap:7px}.codigoChips span{background:#f8f5f3;border-radius:999px;padding:7px 10px;font-weight:900}@keyframes pedidoDrop{from{opacity:.15;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}@media(max-width:760px){.clientesMetrics,.clienteInfo{grid-template-columns:1fr}.clienteTop{display:block}}';
    document.head.appendChild(s);
  }

  function cleanOld(){
    var old = qs('[data-tab="clientesView"]'); if (old) old.remove();
    var oldView = $('clientesView'); if (oldView) oldView.remove();
    var inside = $('pedSub'); if (inside) inside.remove();
    var insideBox = $('clientesBox'); if (insideBox) insideBox.remove();
  }

  function ensureSubnav(){
    injectStyle(); cleanOld();
    var btn = ordersBtn(); if (!btn) return null;
    var sub = $('pedidosSubnav');
    if (!sub) {
      sub = document.createElement('div');
      sub.id = 'pedidosSubnav';
      sub.className = 'pedidosSubnav is-hidden';
      sub.innerHTML = '<button id="subSolicitacoes" type="button" class="on">Solicitações</button><button id="subClientes" type="button">Clientes</button>';
      btn.insertAdjacentElement('afterend', sub);
      $('subSolicitacoes').addEventListener('click', function(e){ e.stopPropagation(); openSolicitacoes(); });
      $('subClientes').addEventListener('click', function(e){ e.stopPropagation(); openClientes(); });
    }
    return sub;
  }
  function showSub(){ var sub = ensureSubnav(); if (sub) sub.classList.remove('is-hidden'); }
  function hideSub(){ var sub = $('pedidosSubnav'); if (sub) sub.classList.add('is-hidden'); }
  function mark(which){ if ($('subSolicitacoes')) $('subSolicitacoes').classList.toggle('on', which === 's'); if ($('subClientes')) $('subClientes').classList.toggle('on', which === 'c'); }
  function activateOrders(){ document.querySelectorAll('[data-view]').forEach(function(v){ v.classList.toggle('hidden', v.id !== 'ordersView'); }); document.querySelectorAll('.nav [data-tab]').forEach(function(b){ b.classList.toggle('active', b === ordersBtn()); }); document.body.dataset.adminTab = 'ordersView'; }

  function openSolicitacoes(){
    document.body.dataset.ordersSubtab = 'solicitacoes';
    showSub(); mark('s');
    var btn = ordersBtn();
    if (btn) btn.click();
    setTimeout(function(){ document.body.dataset.ordersSubtab = 'solicitacoes'; showSub(); mark('s'); }, 550);
  }

  async function fetchClientes(){
    var r = await fetch('/api/admin/customers', { credentials:'include', cache:'no-store' });
    var j = await r.json();
    if (!r.ok || j.ok === false) throw new Error(j.error || 'Erro');
    clientes = j.customers || [];
  }

  function openClientes(){
    var y = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.dataset.ordersSubtab = 'clientes';
    activateOrders(); showSub(); mark('c');
    var p = panel(); if (!p) return;
    p.dataset.ordersOwner = 'clientes';
    p.innerHTML = '<div class="card span-12"><div class="clientesHeader"><div><h3>Clientes</h3><p>Base automática formada pelas solicitações recebidas.</p></div><button id="reloadClientes" class="btn secondary" type="button">Atualizar</button></div><div id="clientesMetrics"></div><input id="clientesBusca" class="clientesSearch" placeholder="Buscar por nome, WhatsApp, código ou vendedora"><div id="clientesLista"><p class="hint">Carregando clientes...</p></div></div>';
    $('reloadClientes').onclick = loadAndRender;
    $('clientesBusca').oninput = renderClientes;
    loadAndRender();
    setTimeout(function(){ window.scrollTo(0, y); }, 0);
    setTimeout(function(){ window.scrollTo(0, y); }, 120);
  }
  function loadAndRender(){ fetchClientes().then(renderClientes).catch(function(e){ if ($('clientesLista')) $('clientesLista').innerHTML = '<p class="hint">' + esc(e.message) + '</p>'; }); }
  function renderClientes(){
    var q = ($('clientesBusca') ? $('clientesBusca').value : '').toLowerCase().trim();
    var arr = clientes.filter(function(c){ return [c.name,c.phone,c.whatsapp].concat(c.sellers||[],c.codes||[]).join(' ').toLowerCase().indexOf(q) > -1; });
    var total = clientes.reduce(function(s,c){ return s + Number(c.ordersCount || 0); }, 0);
    var rec = clientes.filter(function(c){ return Number(c.ordersCount || 0) > 1; }).length;
    if ($('clientesMetrics')) $('clientesMetrics').innerHTML = '<div class="clientesMetrics"><div><b>' + clientes.length + '</b><span>Clientes</span></div><div><b>' + rec + '</b><span>Recorrentes</span></div><div><b>' + total + '</b><span>Solicitações</span></div></div>';
    if ($('clientesLista')) $('clientesLista').innerHTML = arr.length ? arr.map(card).join('') : '<p class="hint">Nenhum cliente encontrado.</p>';
  }
  function card(c){
    var ph = c.whatsapp || c.phone || ''; var wa = dig(ph); if (wa && wa.indexOf('55') !== 0) wa = '55' + wa;
    var codes = (c.codes || []).slice(0,18).map(function(x){ return '<span>#' + esc(x) + '</span>'; }).join('');
    return '<article class="clienteCard"><div class="clienteTop"><div><h4>' + esc(c.name || 'CLIENTE SEM NOME') + '</h4><p>' + esc(phone(ph)) + '</p></div><strong class="clienteBadge">' + esc(c.ordersCount || 0) + ' solicitação(ões)</strong></div><div class="clienteInfo"><div><small>Última solicitação</small><b>' + esc(date(c.lastOrderAt)) + '</b></div><div><small>Vendedora</small><b>' + esc((c.sellers || []).join(', ') || 'Não informado') + '</b></div><div><small>Total</small><b>' + money(c.totalNet) + '</b></div></div><div class="codigoChips">' + (codes || '<em>Nenhum código</em>') + '</div><div style="margin-top:14px"><a class="btn secondary" target="_blank" rel="noopener" href="https://wa.me/' + wa + '">Abrir WhatsApp</a></div></article>';
  }

  document.addEventListener('click', function(e){
    var main = e.target && e.target.closest ? e.target.closest('[data-tab]') : null;
    if (!main) return;
    if (main.dataset.tab === 'ordersView') {
      setTimeout(function(){
        showSub();
        if (document.body.dataset.ordersSubtab === 'clientes') { mark('c'); openClientes(); }
        else { document.body.dataset.ordersSubtab = 'solicitacoes'; mark('s'); }
      }, 320);
    }
    else { delete document.body.dataset.ordersSubtab; hideSub(); }
  });
  window.openClientesAdmin = openClientes;
  setInterval(function(){ if (document.body.dataset.ordersSubtab === 'clientes') { showSub(); mark('c'); } }, 500);
  setTimeout(ensureSubnav, 900);
})();
