(function(){
  var user=null, tab='solicitacoes', orders=[], customers=[], loading=false;
  function $(id){return document.getElementById(id)}
  function qs(sel){return document.querySelector(sel)}
  function qsa(sel){return Array.from(document.querySelectorAll(sel))}
  function esc(v){return String(v==null?'':v).replace(/[&<>'"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]})}
  function digits(v){return String(v||'').replace(/\D/g,'')}
  function date(v){try{return new Date(v).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch(e){return v||'—'}}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function wa(phone){var d=digits(phone);return d?'https://wa.me/'+(d.indexOf('55')===0?d:'55'+d):'#'}
  function orderNo(o){return o.orderNumber||o.orderCode||o.displayId||o.id||''}
  async function api(url,opts){var r=await fetch(url,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},...(opts||{})});var d=await r.json().catch(function(){return {}});if(!r.ok||d.ok===false)throw new Error(d.error||'Erro');return d}
  async function init(){
    try{var d=await api('/api/admin/config?ts='+Date.now());user=d.sessionUser||null;if(!user||user.role!=='vendedora')return;document.body.dataset.userRole='vendedora';ownLayout();renderSolicitacoes();}
    catch(e){}
  }
  function ownLayout(){
    qsa('.nav [data-tab]').forEach(function(btn){var ok=btn.dataset.tab==='ordersView';btn.style.display=ok?'':'none';btn.classList.toggle('active',ok)});
    qsa('[data-view]').forEach(function(v){v.classList.toggle('hidden',v.id!=='ordersView')});
    document.body.dataset.adminTab='ordersView';
    var t=$('adminTitle');if(t)t.textContent='Painel da vendedora';
    var sub=$('adminSubtitle');if(sub)sub.textContent='Acesse suas solicitações e clientes vinculados.';
    var save=qs('.saveBar');if(save)save.style.display='none';
    var existing=$('pedidosSubnav');if(existing)existing.remove();
    var ordersBtn=qs('[data-tab="ordersView"]');
    if(ordersBtn&&!$('vendorSubnav')){
      var subnav=document.createElement('div');
      subnav.id='vendorSubnav';
      subnav.className='pedidosSubnav';
      subnav.innerHTML='<button id="vendorSolicitacoes" type="button">Solicitações</button><button id="vendorClientes" type="button">Clientes</button>';
      ordersBtn.insertAdjacentElement('afterend',subnav);
      $('vendorSolicitacoes').onclick=function(e){e.preventDefault();e.stopPropagation();renderSolicitacoes()};
      $('vendorClientes').onclick=function(e){e.preventDefault();e.stopPropagation();renderClientes()};
    }
  }
  function mark(){var s=$('vendorSolicitacoes'),c=$('vendorClientes');if(s)s.classList.toggle('on',tab==='solicitacoes');if(c)c.classList.toggle('on',tab==='clientes')}
  function panel(){return $('ordersPanel')}
  function shell(title,text,body){ownLayout();mark();var p=panel();if(!p)return;p.dataset.ordersOwner='vendor';p.innerHTML='<div class="card span-12"><div class="sectionHead"><div><h3>'+esc(title)+'</h3><p>'+esc(text)+'</p></div><button id="vendorReload" class="btn secondary" type="button">Atualizar</button></div>'+body+'</div>';var r=$('vendorReload');if(r)r.onclick=function(){tab==='clientes'?renderClientes(true):renderSolicitacoes(true)}}
  async function renderSolicitacoes(force){
    tab='solicitacoes';document.body.dataset.ordersSubtab='solicitacoes';mark();
    shell('Solicitações','Pedidos vinculados à sua vendedora.','<div id="vendorOrdersList"><p class="hint">Carregando solicitações...</p></div>');
    if(loading)return;loading=true;
    try{var d=await api('/api/orders?limit=300');orders=d.orders||[];var list=$('vendorOrdersList');if(list)list.innerHTML=orders.length?orders.map(orderCard).join(''):'<p class="hint">Nenhuma solicitação encontrada para sua vendedora.</p>'}catch(e){var l=$('vendorOrdersList');if(l)l.innerHTML='<p class="hint">'+esc(e.message||'Erro ao carregar solicitações.')+'</p>'}finally{loading=false}
  }
  function orderCard(o){var c=o.customer||{}, phone=c.whatsapp||c.phone||'', items=(o.items||[]).slice(0,20).map(function(i){return '#'+esc(i.code)+' ('+esc(i.qty||1)+'x)'}).join(' · ');return '<article class="item orderCardV2"><div class="itemHead"><div><span class="orderNumberPill">'+esc(orderNo(o))+'</span><p class="hint">'+esc(date(o.createdAt))+' · '+esc(o.qty||0)+' item(ns)</p></div><div class="actions"><a class="btn secondary" href="'+esc(wa(phone))+'" target="_blank" rel="noopener">Abrir conversa</a><button class="btn secondary" type="button" data-vcopy="'+esc(orderNo(o))+'">Copiar dados</button></div></div><div class="orderCustomer"><b>Cliente:</b> '+esc(c.name||'Não informado')+' · <b>WhatsApp:</b> '+esc(phone||'Não informado')+'</div><p class="hint"><b>Status:</b> '+esc(o.status||'Novo')+' · <b>Total:</b> '+money(o.totals&&o.totals.net)+'</p><p class="hint">'+items+'</p></article>'}
  async function renderClientes(force){
    tab='clientes';document.body.dataset.ordersSubtab='clientes';mark();
    shell('Clientes','Clientes vinculados às suas solicitações.','<div id="vendorCustomersList"><p class="hint">Carregando clientes...</p></div>');
    if(loading)return;loading=true;
    try{var d=await api('/api/admin/customers?ts='+Date.now());customers=d.customers||[];var list=$('vendorCustomersList');if(list)list.innerHTML=customers.length?customers.map(customerCard).join(''):'<p class="hint">Nenhum cliente encontrado para sua vendedora.</p>'}catch(e){var l=$('vendorCustomersList');if(l)l.innerHTML='<p class="hint">'+esc(e.message||'Erro ao carregar clientes.')+'</p>'}finally{loading=false}
  }
  function customerCard(c){var ph=c.whatsapp||c.phone||'', codes=(c.codes||[]).slice(0,15).map(function(x){return '<span>#'+esc(x)+'</span>'}).join('');return '<article class="clienteCard"><div class="clienteTop"><div><h4>'+esc(c.name||'CLIENTE SEM NOME')+'</h4><p>'+esc(ph||'Sem WhatsApp')+'</p></div><strong class="clienteBadge">'+esc(c.ordersCount||0)+' solicitação(ões)</strong></div><div class="clienteInfo"><div><small>Última solicitação</small><b>'+esc(date(c.lastOrderAt))+'</b></div><div><small>Total</small><b>'+money(c.totalNet)+'</b></div><div><small>Quantidade</small><b>'+esc(c.totalQty||0)+'</b></div></div><div class="codigoChips">'+(codes||'<em>Nenhum código</em>')+'</div><div style="margin-top:14px"><a class="btn secondary" target="_blank" rel="noopener" href="'+esc(wa(ph))+'">Abrir WhatsApp</a></div></article>'}
  document.addEventListener('click',function(e){if(!user||user.role!=='vendedora')return;var vc=e.target&&e.target.closest&&e.target.closest('#vendorClientes');if(vc){e.preventDefault();e.stopPropagation();renderClientes();return}var vs=e.target&&e.target.closest&&e.target.closest('#vendorSolicitacoes');if(vs){e.preventDefault();e.stopPropagation();renderSolicitacoes();return}},true);
  setInterval(function(){if(user&&user.role==='vendedora'){ownLayout();if(panel()&&panel().dataset.ordersOwner!=='vendor'){tab==='clientes'?renderClientes():renderSolicitacoes()}}},1000);
  init();
})();