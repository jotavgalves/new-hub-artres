(function(){
  if(window.__ARMAZEM_REAL_ADMIN_CACHE__)return;
  window.__ARMAZEM_REAL_ADMIN_CACHE__=true;

  var nativeFetch=window.fetch.bind(window);
  var PREFIX='armazem:adm-cache:v1:';
  var MAX_AGE=30*60*1000;
  var forceNext={orders:false,customers:false};
  var refreshes={orders:null,customers:null};
  var lastProbe='';

  function route(input){
    try{
      var raw=typeof input==='string'?input:(input&&input.url)||'';
      var url=new URL(raw,location.origin);
      if(url.origin!==location.origin)return null;
      if(url.pathname==='/api/orders-indexed')return 'orders';
      if(url.pathname==='/api/admin/customers-indexed')return 'customers';
      return null;
    }catch(e){return null;}
  }
  function method(input,options){return String((options&&options.method)||(input&&input.method)||'GET').toUpperCase();}
  function storageKey(kind){return PREFIX+kind;}
  function safeParse(text){try{return JSON.parse(text);}catch(e){return null;}}
  function signature(kind,payload){
    var rows=kind==='orders'?(payload&&payload.orders):(payload&&payload.customers);
    if(!Array.isArray(rows))rows=[];
    if(kind==='orders'){
      var first=rows[0]||{};
      return [rows.length,first.id||first.orderNumber||'',first.createdAt||'',first.status||''].join('|');
    }
    var customer=rows[0]||{};
    return [rows.length,customer.phone||customer.whatsapp||customer.name||'',customer.lastOrderAt||'',customer.ordersCount||0].join('|');
  }
  function read(kind){
    try{
      var row=safeParse(sessionStorage.getItem(storageKey(kind))||'');
      if(!row||!row.payload||!row.updatedAt||Date.now()-row.updatedAt>MAX_AGE)return null;
      return row;
    }catch(e){return null;}
  }
  function write(kind,payload){
    var row={payload:payload,updatedAt:Date.now(),signature:signature(kind,payload)};
    try{sessionStorage.setItem(storageKey(kind),JSON.stringify(row));}catch(e){}
    updateIndicator(kind,row.updatedAt,'ao vivo');
    return row;
  }
  function clear(){
    try{sessionStorage.removeItem(storageKey('orders'));sessionStorage.removeItem(storageKey('customers'));}catch(e){}
  }
  function jsonResponse(payload,state){
    return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Admin-Cache':state||'HIT'}});
  }
  async function network(input,options,kind){
    var response=await nativeFetch(input,options);
    if(!response.ok)return response;
    var clone=response.clone();
    var payload=safeParse(await clone.text());
    if(payload&&payload.ok!==false)write(kind,payload);
    return response;
  }
  async function refresh(kind,notify){
    if(refreshes[kind])return refreshes[kind];
    var url=kind==='orders'?'/api/orders-indexed?limit=500':'/api/admin/customers-indexed';
    refreshes[kind]=(async function(){
      var before=read(kind);
      try{
        var response=await nativeFetch(url,{credentials:'include',cache:'no-store',headers:{Accept:'application/json','X-Admin-Cache-Revalidate':'1'}});
        if(!response.ok)return false;
        var payload=safeParse(await response.text());
        if(!payload||payload.ok===false)return false;
        var after=write(kind,payload);
        var changed=!before||before.signature!==after.signature;
        if(changed&&notify)renderFresh(kind);
        return changed;
      }catch(e){
        updateIndicator(kind,before&&before.updatedAt,'reconectando');
        return false;
      }finally{refreshes[kind]=null;}
    })();
    return refreshes[kind];
  }
  function renderFresh(kind){
    setTimeout(function(){
      forceNext[kind]=false;
      var button=document.getElementById(kind==='orders'?'reloadOrdersV2':'reloadClientes');
      if(button)button.click();
    },220);
  }
  function formatTime(value){
    if(!value)return 'ainda não sincronizado';
    try{return new Date(value).toLocaleString('pt-BR');}catch(e){return '';}
  }
  function updateIndicator(kind,value,state){
    var id=kind==='orders'?'ordersCacheStatus':'customersCacheStatus';
    var target=document.getElementById(id);
    if(!target)return;
    target.textContent=(state==='reconectando'?'Reconectando':'Ao vivo')+' · Última atualização: '+formatTime(value);
    target.dataset.state=state||'ao vivo';
  }
  function ensureIndicators(){
    var ordersButton=document.getElementById('reloadOrdersV2');
    if(ordersButton&&!document.getElementById('ordersCacheStatus')){
      var span=document.createElement('span');span.id='ordersCacheStatus';span.className='hint adminCacheStatus';
      ordersButton.parentElement.insertBefore(span,ordersButton);
      var cached=read('orders');updateIndicator('orders',cached&&cached.updatedAt,cached?'ao vivo':'reconectando');
    }
    var clientsButton=document.getElementById('reloadClientes');
    if(clientsButton&&!document.getElementById('customersCacheStatus')){
      var cspan=document.createElement('span');cspan.id='customersCacheStatus';cspan.className='hint adminCacheStatus';
      clientsButton.parentElement.insertBefore(cspan,clientsButton);
      var ccached=read('customers');updateIndicator('customers',ccached&&ccached.updatedAt,ccached?'ao vivo':'reconectando');
    }
  }
  async function probe(){
    if(document.hidden||!document.getElementById('adminView')||document.getElementById('adminView').classList.contains('hidden'))return;
    try{
      var response=await nativeFetch('/api/orders-indexed?limit=1&cacheProbe=1',{credentials:'include',cache:'no-store',headers:{Accept:'application/json','X-Admin-Cache-Probe':'1'}});
      if(!response.ok)return;
      var payload=safeParse(await response.text());
      var rows=payload&&payload.orders;
      var first=Array.isArray(rows)&&rows[0]||{};
      var current=[first.id||first.orderNumber||'',first.createdAt||'',first.status||''].join('|');
      if(!lastProbe){lastProbe=current;return;}
      if(current&&current!==lastProbe){
        lastProbe=current;
        await Promise.all([refresh('orders',true),refresh('customers',true)]);
      }
    }catch(e){}
  }

  window.fetch=async function(input,options){
    var kind=route(input);
    var verb=method(input,options);
    var pathname='';
    try{pathname=new URL(typeof input==='string'?input:input.url,location.origin).pathname;}catch(e){}

    if(pathname==='/api/admin/logout'&&verb==='POST')clear();

    if(kind&&verb==='GET'){
      if(forceNext[kind]){
        forceNext[kind]=false;
        return network(input,options,kind);
      }
      var cached=read(kind);
      if(cached){
        setTimeout(function(){refresh(kind,true);},0);
        return jsonResponse(cached.payload,'HIT');
      }
      return network(input,options,kind);
    }

    var response=await nativeFetch(input,options);
    if(response.ok&&verb!=='GET'&&(pathname==='/api/orders'||pathname==='/api/orders/delete'||pathname==='/api/orders-indexed')){
      setTimeout(function(){refresh('orders',true);refresh('customers',true);},100);
    }
    return response;
  };

  document.addEventListener('click',function(event){
    var button=event.target&&event.target.closest&&event.target.closest('#reloadOrdersV2,#reloadClientes');
    if(!button)return;
    var kind=button.id==='reloadClientes'?'customers':'orders';
    forceNext[kind]=true;
  },true);

  var style=document.createElement('style');
  style.textContent='.adminCacheStatus{display:inline-flex;align-items:center;margin-left:auto;margin-right:10px;font-weight:850;color:#5e7667}.adminCacheStatus:before{content:"";width:8px;height:8px;margin-right:7px;border-radius:50%;background:#25b96f;box-shadow:0 0 0 4px rgba(37,185,111,.12)}.adminCacheStatus[data-state="reconectando"]{color:#a56a14}.adminCacheStatus[data-state="reconectando"]:before{background:#e5a02e}@media(max-width:760px){.adminCacheStatus{width:100%;margin:8px 0 0}}';
  document.head.appendChild(style);
  new MutationObserver(ensureIndicators).observe(document.body,{childList:true,subtree:true});
  setInterval(probe,5000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)probe();});
  ensureIndicators();
})();
