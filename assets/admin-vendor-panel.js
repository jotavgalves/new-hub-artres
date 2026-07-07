(function(){
  if (window.__ARMAZEM_VENDOR_PANEL_ACTIVE__) return;
  window.__ARMAZEM_VENDOR_PANEL_ACTIVE__ = true;
  window.__ARMAZEM_VENDOR_PANEL_VERSION__ = '5';

  var user=null, tab='solicitacoes';
  var orders=[], customers=[];
  var ordersLoaded=false, customersLoaded=false;
  var ordersLoading=false, customersLoading=false;
  var ordersSig='', customersSig='', watcherStarted=false;

  function $(id){return document.getElementById(id)}
  function qs(sel){return document.querySelector(sel)}
  function qsa(sel){return Array.from(document.querySelectorAll(sel))}
  function esc(v){return String(v==null?'':v).replace(/[&<>'"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]})}
  function digits(v){return String(v||'').replace(/\D/g,'')}
  function date(v){try{return new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return v||'—'}}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function wa(phone){var d=digits(phone);return d?'https://wa.me/'+(d.indexOf('55')===0?d:'55'+d):'#'}
  function orderNo(o){return o.orderNumber||o.orderCode||o.displayId||o.id||''}
  function safeArray(v){return Array.isArray(v)?v:[]}
  function sigOrders(list){return safeArray(list).slice(0,20).map(function(o){return [orderNo(o),o.createdAt||'',o.updatedAt||'',o.status||'',o.qty||0].join(':')}).join('|')+'::'+safeArray(list).length}
  function sigCustomers(list){return safeArray(list).slice(0,20).map(function(c){return [c.whatsapp||c.phone||'',c.lastOrderAt||'',c.ordersCount||0,c.totalQty||0].join(':')}).join('|')+'::'+safeArray(list).length}
  async function api(url,opts){var r=await fetch(url,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},...(opts||{})});var d=await r.json().catch(function(){return {}});if(!r.ok||d.ok===false)throw new Error(d.detail||d.error||('HTTP_'+r.status));return d}

  async function init(){
    try{
      var d=await api('/api/admin/config?ts='+Date.now());
      user=d.sessionUser||null;
      if(!user||user.role!=='vendedora')return;
      document.body.dataset.userRole='vendedora';
      ownLayout();
      renderSolicitacoes();
      startWatcher();
    }catch(e){}
  }

  function injectStyle(){
    if($('vendorPanelStyle'))return;
    var s=document.createElement('style');
    s.id='vendorPanelStyle';
    s.textContent='body[data-user-role="vendedora"] .nav{gap:8px}body[data-user-role="vendedora"] .nav>[data-tab]{display:none!important}body[data-user-role="vendedora"] #vendorSubnav.vendorNav{display:grid!important;gap:8px;align-content:start}body[data-user-role="vendedora"] #vendorSubnav button{width:100%;border:0;background:transparent;text-align:left;border-radius:18px;padding:14px 14px;font-weight:950;color:#504850;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;box-shadow:inset 0 0 0 1px transparent}body[data-user-role="vendedora"] #vendorSubnav button:hover{background:#fff1f6;color:#d9366b}body[data-user-role="vendedora"] #vendorSubnav button.on{background:linear-gradient(135deg,#fff1f6,#eefdff);color:#d9366b;box-shadow:inset 0 0 0 1px #ffd6e5}body[data-user-role="vendedora"] #vendorSubnav small{color:#938b94;font-weight:950;margin-left:8px}body[data-user-role="vendedora"] #vendorSubnav button.on small{color:#d9366b}.vendorSyncHint{display:block;margin-top:8px;color:#938b94;font-size:11px;font-weight:800}@media(max-width:760px){body[data-user-role="vendedora"] #adminView.shell{display:block!important;min-height:100vh!important}body[data-user-role="vendedora"] #adminView .sidebar{position:relative!important;top:auto!important;height:auto!important;padding:14px 12px!important;border-right:0!important;border-bottom:1px solid rgba(238,225,227,.9)!important;display:grid!important;gap:12px!important;background:rgba(255,255,255,.92)!important}body[data-user-role="vendedora"] #adminView .brand{gap:10px!important}body[data-user-role="vendedora"] #adminView .brandMark{width:42px!important;height:42px!important;flex:0 0 42px!important}body[data-user-role="vendedora"] #adminView .brand h1{font-size:16px!important}body[data-user-role="vendedora"] #adminView .brand p{font-size:10.5px!important}body[data-user-role="vendedora"] #adminView .nav{display:block!important;overflow:visible!important;padding:0!important}body[data-user-role="vendedora"] #vendorSubnav.vendorNav{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;width:100%!important}body[data-user-role="vendedora"] #vendorSubnav button{min-height:48px!important;justify-content:center!important;text-align:center!important;padding:10px 8px!important;border-radius:16px!important;font-size:13px!important;gap:7px!important}body[data-user-role="vendedora"] #vendorSubnav small{margin-left:4px!important;font-size:11px!important}body[data-user-role="vendedora"] #adminView .sideFoot{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important}body[data-user-role="vendedora"] #adminView .sideFoot .btn{width:100%!important;min-height:40px!important;font-size:12px!important}body[data-user-role="vendedora"] #adminView .main{padding:14px 12px 32px!important}body[data-user-role="vendedora"] #adminView .topbar{display:grid!important;gap:8px!important;margin-bottom:12px!important}body[data-user-role="vendedora"] #adminView .topbar h2{font-size:28px!important;line-height:1.03!important}body[data-user-role="vendedora"] #adminView .topbar p{font-size:13px!important;line-height:1.4!important}body[data-user-role="vendedora"] #ordersPanel{display:block!important;min-width:0!important}body[data-user-role="vendedora"] #ordersPanel .card{padding:14px!important;border-radius:22px!important;overflow:visible!important}body[data-user-role="vendedora"] #ordersPanel .sectionHead{display:grid!important;grid-template-columns:1fr!important;gap:10px!important}body[data-user-role="vendedora"] #ordersPanel .sectionHead h3{font-size:20px!important}body[data-user-role="vendedora"] #ordersPanel .sectionHead p{font-size:12.5px!important;line-height:1.45!important}body[data-user-role="vendedora"] #vendorReload{width:100%!important}body[data-user-role="vendedora"] #ordersPanel .itemHead{display:grid!important;grid-template-columns:1fr!important;gap:10px!important}body[data-user-role="vendedora"] #ordersPanel .orderCardV2,body[data-user-role="vendedora"] #ordersPanel .clienteCard{padding:14px!important;border-radius:20px!important;overflow-wrap:anywhere!important}body[data-user-role="vendedora"] #ordersPanel .orderCardV2 .actions{display:grid!important;grid-template-columns:1fr!important;width:100%!important}body[data-user-role="vendedora"] #ordersPanel .orderCardV2 .actions .btn,body[data-user-role="vendedora"] #ordersPanel .clienteCard .btn{width:100%!important}body[data-user-role="vendedora"] #ordersPanel .orderCustomer{line-height:1.45!important;overflow-wrap:anywhere!important}body[data-user-role="vendedora"] #ordersPanel .clienteTop{display:grid!important;grid-template-columns:1fr!important;gap:10px!important}body[data-user-role="vendedora"] #ordersPanel .clienteInfo{display:grid!important;grid-template-columns:1fr!important;gap:8px!important}body[data-user-role="vendedora"] #ordersPanel .codigoChips{display:flex!important;flex-wrap:wrap!important;gap:7px!important}body[data-user-role="vendedora"] #ordersPanel .codigoChips span{max-width:100%!important;white-space:normal!important}body[data-user-role="vendedora"] #adminView .saveBar{display:none!important}}';
    document.head.appendChild(s);
  }

  function removeForeignSubnavs(){
    qsa('.nav .pedidosSubnav').forEach(function(el){ el.remove(); });
    var all=qsa('#vendorSubnav');
    all.forEach(function(el,i){ if(i>0) el.remove(); });
  }

  function ownLayout(){
    injectStyle();
    removeForeignSubnavs();
    qsa('.nav [data-tab]').forEach(function(btn){btn.style.display='none';btn.classList.remove('active')});
    qsa('[data-view]').forEach(function(v){v.classList.toggle('hidden',v.id!=='ordersView')});
    document.body.dataset.adminTab='ordersView';
    var t=$('adminTitle');if(t)t.textContent='Painel da vendedora';
    var sub=$('adminSubtitle');if(sub)sub.textContent='Acesse suas solicitações e clientes vinculados.';
    var save=qs('.saveBar');if(save)save.style.display='none';
    var nav=qs('.nav');
    if(nav&&!$('vendorSubnav')){
      var subnav=document.createElement('div');
      subnav.id='vendorSubnav';
      subnav.className='vendorNav';
      subnav.innerHTML='<button id="vendorSolicitacoes" type="button"><span>Solicitações</span><small>01</small></button><button id="vendorClientes" type="button"><span>Clientes</span><small>02</small></button>';
      nav.insertBefore(subnav,nav.firstChild);
      $('vendorSolicitacoes').onclick=function(e){e.preventDefault();e.stopPropagation();renderSolicitacoes()};
      $('vendorClientes').onclick=function(e){e.preventDefault();e.stopPropagation();renderClientes()};
    }
    mark();
  }

  function mark(){var s=$('vendorSolicitacoes'),c=$('vendorClientes');if(s)s.classList.toggle('on',tab==='solicitacoes');if(c)c.classList.toggle('on',tab==='clientes')}
  function panel(){return $('ordersPanel')}
  function syncHint(){return '<span class="vendorSyncHint">Atualização automática ativa.</span>'}
  function shell(title,text,body){
    ownLayout();
    var p=panel();if(!p)return;
    p.dataset.ordersOwner='vendor';
    p.innerHTML='<div class="card span-12"><div class="sectionHead"><div><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p>'+syncHint()+'</div><button id="vendorReload" class="btn secondary" type="button">Atualizar</button></div>'+body+'</div>';
    var r=$('vendorReload');if(r)r.onclick=function(){tab==='clientes'?loadCustomers(true,false):loadOrders(true,false)};
    mark();
  }

  function renderOrdersList(){
    var list=$('vendorOrdersList');
    if(!list)return;
    list.innerHTML=orders.length?orders.map(orderCard).join(''):'<p class="hint">Nenhuma solicitação encontrada para sua vendedora.</p>';
  }

  function renderCustomersList(){
    var list=$('vendorCustomersList');
    if(!list)return;
    list.innerHTML=customers.length?customers.map(customerCard).join(''):'<p class="hint">Nenhum cliente encontrado para sua vendedora.</p>';
  }

  async function loadOrders(force,silent){
    if(ordersLoading)return;
    if(ordersLoaded&&!force){renderOrdersList();return;}
    ordersLoading=true;
    var list=$('vendorOrdersList');
    if(list&&!silent&&!ordersLoaded)list.innerHTML='<p class="hint">Carregando solicitações...</p>';
    try{
      var d=await api('/api/orders?limit=300&ts='+Date.now());
      var next=d.orders||[];
      var nextSig=sigOrders(next);
      var changed=nextSig!==ordersSig;
      orders=next;
      ordersSig=nextSig;
      ordersLoaded=true;
      if(tab==='solicitacoes'||!silent)renderOrdersList();
      if(changed&&customersLoaded)loadCustomers(true,true);
    }catch(e){if(list&&!silent)list.innerHTML='<p class="hint">'+esc(e.message||'Erro ao carregar solicitações.')+'</p>'}
    finally{ordersLoading=false}
  }

  async function loadCustomers(force,silent){
    if(customersLoading)return;
    if(customersLoaded&&!force){renderCustomersList();return;}
    customersLoading=true;
    var list=$('vendorCustomersList');
    if(list&&!silent&&!customersLoaded)list.innerHTML='<p class="hint">Carregando clientes...</p>';
    try{
      var d=await api('/api/admin/customers-indexed?ts='+Date.now());
      var next=d.customers||[];
      var nextSig=sigCustomers(next);
      customers=next;
      customersSig=nextSig;
      customersLoaded=true;
      if(tab==='clientes'||!silent)renderCustomersList();
    }catch(e){if(list&&!silent)list.innerHTML='<p class="hint">'+esc(e.message||'Erro ao carregar clientes.')+'</p>'}
    finally{customersLoading=false}
  }

  function startWatcher(){
    if(watcherStarted)return;
    watcherStarted=true;
    setInterval(function(){
      if(!user||user.role!=='vendedora'||document.hidden)return;
      loadOrders(true,true);
      if(customersLoaded||tab==='clientes')loadCustomers(true,true);
    },12000);
    window.addEventListener('focus',function(){
      if(!user||user.role!=='vendedora')return;
      loadOrders(true,true);
      if(customersLoaded||tab==='clientes')loadCustomers(true,true);
    });
  }

  function renderSolicitacoes(){
    tab='solicitacoes';document.body.dataset.ordersSubtab='vendor-solicitacoes';mark();
    shell('Solicitações','Pedidos vinculados à sua vendedora.','<div id="vendorOrdersList">'+(ordersLoaded?'':'<p class="hint">Carregando solicitações...</p>')+'</div>');
    if(ordersLoaded)renderOrdersList();
    else loadOrders(false,false);
  }

  function renderClientes(){
    tab='clientes';document.body.dataset.ordersSubtab='vendor-clientes';mark();
    shell('Clientes','Clientes vinculados às suas solicitações.','<div id="vendorCustomersList">'+(customersLoaded?'':'<p class="hint">Carregando clientes...</p>')+'</div>');
    if(customersLoaded)renderCustomersList();
    else loadCustomers(false,false);
  }

  function orderCard(o){var c=o.customer||{}, phone=c.whatsapp||c.phone||'', items=(o.items||[]).slice(0,20).map(function(i){return '#'+esc(i.code)+' ('+esc(i.qty||1)+'x)'}).join(' · ');return '<article class="item orderCardV2"><div class="itemHead"><div><span class="orderNumberPill">'+esc(orderNo(o))+'</span><p class="hint">'+esc(date(o.createdAt))+' · '+esc(o.qty||0)+' item(ns)</p></div><div class="actions"><a class="btn secondary" href="'+esc(wa(phone))+'" target="_blank" rel="noopener">Abrir conversa</a></div></div><div class="orderCustomer"><b>Cliente:</b> '+esc(c.name||'Não informado')+' · <b>WhatsApp:</b> '+esc(phone||'Não informado')+'</div><p class="hint"><b>Status:</b> '+esc(o.status||'Novo')+' · <b>Total:</b> '+money(o.totals&&o.totals.net)+'</p><p class="hint">'+items+'</p></article>'}
  function customerCard(c){var ph=c.whatsapp||c.phone||'', codes=(c.codes||[]).slice(0,15).map(function(x){return '<span>#'+esc(x)+'</span>'}).join('');return '<article class="clienteCard"><div class="clienteTop"><div><h4>'+esc(c.name||'CLIENTE SEM NOME')+'</h4><p>'+esc(ph||'Sem WhatsApp')+'</p></div><strong class="clienteBadge">'+esc(c.ordersCount||0)+' solicitação(ões)</strong></div><div class="clienteInfo"><div><small>Última solicitação</small><b>'+esc(date(c.lastOrderAt))+'</b></div><div><small>Total</small><b>'+money(c.totalNet)+'</b></div><div><small>Quantidade</small><b>'+esc(c.totalQty||0)+'</b></div></div><div class="codigoChips">'+(codes||'<em>Nenhum código</em>')+'</div><div style="margin-top:14px"><a class="btn secondary" target="_blank" rel="noopener" href="'+esc(wa(ph))+'">Abrir WhatsApp</a></div></article>'}
  document.addEventListener('click',function(e){if(!user||user.role!=='vendedora')return;var vc=e.target&&e.target.closest&&e.target.closest('#vendorClientes');if(vc){e.preventDefault();e.stopPropagation();renderClientes();return}var vs=e.target&&e.target.closest&&e.target.closest('#vendorSolicitacoes');if(vs){e.preventDefault();e.stopPropagation();renderSolicitacoes();return}},true);
  setInterval(function(){if(user&&user.role==='vendedora'){ownLayout();if(panel()&&panel().dataset.ordersOwner!=='vendor'){tab==='clientes'?renderClientes():renderSolicitacoes()}}},700);
  init();
})();
