(function(){
  if(window.__ARMAZEM_PAINEL_ROMANO_RUNTIME__==='3')return;
  window.__ARMAZEM_PAINEL_ROMANO_RUNTIME__='3';

  var KEY='painel-romano';
  var ROOT='15f6Ge0jZCHSIWMhmEUOs4bfXy9y5U3wk';
  var WORKSPACE_STORAGE='armazem:production:workspace';
  var state={label:'Painel Romano 1x2',enabled:false,unitPrice:0,minimum:1,step:1,initial:1,active:false,installed:false};

  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function norm(v){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
  function moneyBR(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function isRoman(v){return !!v&&String(v.product||v.productKey||v.key||'')===KEY}
  function isRomanTheme(v){return !!v&&String(v.id||'').indexOf('painel-romano-theme:')===0}
  function notify(msg){try{if(typeof toast==='function')toast(msg);else alert(msg)}catch(_){}}
  function request(params){var q=new URLSearchParams(params||{});q.set('_',String(Date.now()));return fetch('/api/painel-romano?'+q.toString(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok||d.ok===false)throw new Error(d.detail||d.error||'Falha ao carregar Painel Romano.');return d})})}
  function romanProduct(theme){theme=theme||(typeof selectedTheme!=='undefined'?selectedTheme:null)||{id:'',name:'Tema'};return{id:'painel-romano-product:'+String(theme.id||norm(theme.name||'tema')),name:state.label,rawName:state.label,label:state.label,productName:state.label,product:KEY,productKey:KEY,kind:'product',rootFolderId:ROOT,size:'1X2',sizeKey:'100x200'}}

  function injectStyle(){
    if(document.getElementById('painelRomanoRuntimeStyle'))return;
    var s=document.createElement('style');s.id='painelRomanoRuntimeStyle';
    s.textContent='.productionV2Tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important}.productionV2RomanTab i{font-size:10px!important}.productionV2RomanTab[data-unpriced="1"]:not(.active){opacity:.72}.fixedMeasureBadge{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border-radius:999px;background:#eefaff;border:1px solid #cfeefa;color:#117696;font-size:10.5px;font-weight:900;white-space:nowrap}.romanFixedMeasure{background:#f7fbfd!important;border-color:#d9f1fa!important;color:#117696!important}@media(max-width:560px){.productionV2Tabs{grid-template-columns:repeat(3,minmax(0,1fr))!important}.productionV2Tab{padding-left:6px!important;padding-right:6px!important}.productionV2Tab b{font-size:10px!important}}';
    document.head.appendChild(s);
  }

  function ensureTab(){
    var nav=document.getElementById('productionV2Nav');
    var tabs=nav&&nav.querySelector('.productionV2Tabs');
    if(!tabs)return false;
    var btn=document.getElementById('productionV2RomanTab');
    if(!btn){
      btn=document.createElement('button');
      btn.id='productionV2RomanTab';
      btn.type='button';
      btn.className='productionV2Tab productionV2RomanTab';
      btn.setAttribute('data-roman-workspace',KEY);
      btn.innerHTML='<i aria-hidden="true">1×2</i><span><b>Painel Romano</b></span>';
      btn.onclick=function(e){e.preventDefault();e.stopPropagation();activateRoman(true)};
      tabs.appendChild(btn);
      nav.addEventListener('click',function(e){var normal=e.target&&e.target.closest&&e.target.closest('[data-workspace]');if(normal)deactivateRoman(false)},true);
    }
    btn.dataset.unpriced=state.enabled&&state.unitPrice>0?'0':'1';
    btn.title=state.enabled&&state.unitPrice>0?state.label:'Painel Romano 1x2 — defina o preço no painel administrativo para vender';
    syncNav();
    return true;
  }

  function syncNav(){
    if(!state.active)return;
    document.querySelectorAll('#productionV2Nav [data-workspace]').forEach(function(b){b.classList.remove('active')});
    var btn=document.getElementById('productionV2RomanTab');if(btn)btn.classList.add('active');
    document.querySelectorAll('[data-workspace-title]').forEach(function(n){n.textContent='Painel Romano 1x2'});
  }

  function rememberRoman(){
    try{sessionStorage.setItem(WORKSPACE_STORAGE,KEY)}catch(_){}
    try{var u=new URL(location.href);u.searchParams.set('produto',KEY);history.replaceState(history.state,'',u.pathname+u.search+u.hash)}catch(_){}
    try{localStorage.removeItem('armazem:lastPlace')}catch(_){}
  }

  function deactivateRoman(clearUrl){
    state.active=false;
    var btn=document.getElementById('productionV2RomanTab');if(btn)btn.classList.remove('active');
    if(clearUrl){try{var u=new URL(location.href);if(u.searchParams.get('produto')===KEY){u.searchParams.delete('produto');history.replaceState(history.state,'',u.pathname+u.search+u.hash)}}catch(_){}}
  }

  async function activateRoman(announce){
    state.active=true;rememberRoman();syncNav();
    if(announce)notify(state.enabled&&state.unitPrice>0?'Agora você está vendo Painel Romano 1x2.':'Painel Romano aberto. Defina o preço no Admin antes de vender.');
    try{
      if(typeof view!=='undefined')view='themes';
      if(typeof selectedTheme!=='undefined')selectedTheme=null;
      if(typeof selectedProduct!=='undefined')selectedProduct=null;
      if(typeof currentFolder!=='undefined')currentFolder=null;
      if(typeof folderTrail!=='undefined')folderTrail=[];
      var search=document.getElementById('search');if(search)search.value='';
      if(typeof updateHead==='function')updateHead('Escolha um tema','Escolha um tema disponível para Painel Romano 1x2.','carregando');
      if(typeof loading==='function')loading('Buscando Painéis Romanos...');
      var d=await request({mode:'themes'});
      if(!state.active)return;
      if(typeof themes!=='undefined')themes=Array.isArray(d.folders)?d.folders:[];
      if(typeof showThemes==='function')showThemes();
      syncNav();
    }catch(e){
      if(typeof themes!=='undefined')themes=[];
      if(typeof showThemes==='function')showThemes();
      notify('Não foi possível carregar os Painéis Romanos agora.');
      syncNav();
    }
  }

  function installFunctionHooks(){
    if(state.installed)return;
    state.installed=true;

    if(typeof productConfig==='function'){
      var oldProductConfig=productConfig;
      productConfig=function(product){if(product===KEY)return{label:state.label,type:'fixedRectangle',unitPrice:state.unitPrice,baseQty:state.minimum,basePrice:state.minimum*state.unitPrice,afterStep:state.step,initialQuantity:state.initial,checkoutEnabled:state.enabled&&state.unitPrice>0,fixedWidth:100,fixedHeight:200,fixedSize:'1X2',sizeKey:'100x200'};return oldProductConfig(product)};
    }
    if(typeof label==='function'){
      var oldLabel=label;label=function(key){return key===KEY?state.label:oldLabel(key)};
    }
    if(typeof price==='function'){
      var oldPrice=price;price=function(product,qty,item){if(product===KEY)return Math.max(0,Number(qty||0))*Math.max(0,Number(state.unitPrice||0));return oldPrice(product,qty,item)};
    }
    if(typeof priceTextFor==='function'){
      var oldPriceTextFor=priceTextFor;priceTextFor=function(p){if(isRoman(p))return state.unitPrice>0?moneyBR(state.unitPrice)+' cada':'Preço a definir';return oldPriceTextFor(p)};
    }
    if(typeof artPriceText==='function'){
      var oldArtPriceText=artPriceText;artPriceText=function(item){if(isRoman(item))return state.unitPrice>0?moneyBR(state.unitPrice):'Preço a definir';return oldArtPriceText(item)};
    }
    if(typeof itemActionButton==='function'){
      var oldItemActionButton=itemActionButton;itemActionButton=function(item){if(isRoman(item))return'<span class="fixedMeasureBadge">Medida fixa 1×2 m</span>';return oldItemActionButton(item)};
    }
    if(typeof measureFields==='function'){
      var oldMeasureFields=measureFields;measureFields=function(item){if(isRoman(item))return'<div class="measureClosed"><div class="measureSummary clamp romanFixedMeasure">Medida fixa: 1,00 × 2,00 m</div></div>';return oldMeasureFields(item)};
    }
    if(typeof detailsForWhatsApp==='function'){
      var oldDetailsForWhatsApp=detailsForWhatsApp;detailsForWhatsApp=function(item){if(isRoman(item))return'Medida: 1,00 x 2,00 m';return oldDetailsForWhatsApp(item)};
    }
    if(typeof prefetchProductsForTheme==='function'){
      var oldPrefetchProducts=prefetchProductsForTheme;prefetchProductsForTheme=function(t){if(state.active||isRomanTheme(t))return Promise.resolve();return oldPrefetchProducts(t)};
    }
    if(typeof prefetchItemsForProducts==='function'){
      var oldPrefetchItems=prefetchItemsForProducts;prefetchItemsForProducts=function(list){if(state.active)return Promise.resolve();return oldPrefetchItems((list||[]).filter(function(p){return!isRoman(p)}))};
    }
    if(typeof addItem==='function'){
      var oldAddItem=addItem;addItem=function(id){var source=(typeof items!=='undefined'&&Array.isArray(items)?items:[]).find(function(i){return String(i.id)===String(id)})||(typeof prev!=='undefined'?prev:null);if(isRoman(source)&&(!state.enabled||!(state.unitPrice>0))){notify('Defina o preço do Painel Romano no painel administrativo antes de vender.');return}return oldAddItem(id)};
    }
    if(typeof cartRule==='function'){
      var oldCartRule=cartRule;cartRule=function(){var roman=(typeof cart!=='undefined'&&Array.isArray(cart)?cart:[]).filter(isRoman);if(roman.length){if(!state.enabled||!(state.unitPrice>0))return{ok:false,msg:'Painel Romano está sem preço ou indisponível no momento.'};var bad=roman.find(function(i){var q=Math.max(1,Number(i.qty||1));return q<state.minimum||(q-state.minimum)%state.step!==0});if(bad)return{ok:false,msg:'Revise a quantidade de '+state.label+'.'}}return oldCartRule()};
    }

    if(typeof loadProducts==='function'){
      var oldLoadProducts=loadProducts;loadProducts=async function(folder,navMode){if(!state.active&&!isRomanTheme(folder))return oldLoadProducts(folder,navMode);state.active=true;selectedTheme=folder;folderTrail=[];currentFolder=folder;selectedProduct=null;view='products';var search=document.getElementById('search');if(search)search.value='';if(typeof rememberPlace==='function')rememberPlace();products=[romanProduct(folder)];if(typeof showProducts==='function')showProducts();syncNav()};
    }
    if(typeof loadItems==='function'){
      var oldLoadItems=loadItems;loadItems=async function(product){if(!isRoman(product))return oldLoadItems(product);state.active=true;selectedProduct=product;view='items';showFavs=false;var search=document.getElementById('search');if(search)search.value='';if(typeof updateHead==='function')updateHead('Escolha suas artes','Painel Romano com medida fixa de 1,00 x 2,00 m.','carregando');if(typeof loading==='function')loading('Preparando os Painéis Romanos...','arts');if(typeof rememberPlace==='function')rememberPlace();try{var themeName=typeof fullThemeName==='function'?fullThemeName():'';themeName=themeName||(selectedTheme&&selectedTheme.name)||'';var d=await request({mode:'items',theme:themeName});items=Array.isArray(d.items)?d.items:[];items.forEach(function(i){i.product=KEY;i.productKey=KEY;i.productName=state.label;i.size='1X2';i.sizeKey='100x200';i.details=Object.assign({},i.details||{},{size:'1X2',sizeKey:'100x200',width:100,height:200,unit:'cm',fixed:true})});if(typeof renderItems==='function')renderItems();syncNav()}catch(e){if(typeof errorScreen==='function')errorScreen(e.message||'Não foi possível carregar os Painéis Romanos.')}};
    }
    if(typeof globalCodeSearch==='function'){
      var oldGlobalCodeSearch=globalCodeSearch;globalCodeSearch=async function(q){if(!state.active)return oldGlobalCodeSearch(q);view='search';selectedProduct=null;showFavs=false;if(typeof updateHead==='function')updateHead('Busca por código','Procurando a arte #'+q+' nos Painéis Romanos.','buscando');if(typeof loading==='function')loading('Procurando essa arte...');try{var d=await request({mode:'search',code:q});items=Array.isArray(d.items)?d.items:[];if(typeof renderItems==='function')renderItems();syncNav()}catch(e){items=[];if(typeof renderItems==='function')renderItems();notify('Não foi possível concluir a busca agora.')}};
    }
    if(typeof locateItem==='function'){
      var oldLocateItem=locateItem;locateItem=async function(id){var it=typeof entry==='function'?entry(id):null;if(!isRoman(it))return oldLocateItem(id);state.active=true;selectedTheme={id:it.themeId||'',name:(it.theme||'Tema').split(' / ')[0]||it.theme||'Tema'};folderTrail=[];await loadItems(romanProduct(selectedTheme));setTimeout(function(){var el=document.querySelector('[data-card="'+CSS.escape(id)+'"]');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('located');setTimeout(function(){el.classList.remove('located')},1900)}},80)};
    }
  }

  function mergeRomanReconcile(receiver,input,init,previousFetch){
    var body;try{body=JSON.parse(String(init&&init.body||'{}'))}catch(_){return previousFetch.call(receiver,input,init)}
    var all=Array.isArray(body.items)?body.items:[];
    var roman=all.filter(isRoman);if(!roman.length)return previousFetch.call(receiver,input,init);
    var standard=all.filter(function(i){return!isRoman(i)});
    if(!standard.length){return Promise.resolve(new Response(JSON.stringify({ok:true,items:roman,migrations:[],removed:[],changed:false}),{status:200,headers:{'Content-Type':'application/json'}}))}
    var next=Object.assign({},init,{body:JSON.stringify({items:standard})});
    return previousFetch.call(receiver,input,next).then(async function(response){var d=await response.clone().json().catch(function(){return{}});if(!response.ok||d.ok!==true||!Array.isArray(d.items))return response;d.items=d.items.concat(roman);return new Response(JSON.stringify(d),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})});
  }

  function installFetchHook(){
    if(window.fetch.__romanUnified)return;
    var previousFetch=window.fetch;
    var wrapped=function(input,init){
      var url;try{url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin)}catch(_){return previousFetch.apply(this,arguments)}
      var method=String(init&&init.method||'GET').toUpperCase();
      if(url.pathname==='/api/reconcile-cart'&&method==='POST')return mergeRomanReconcile(this,input,init,previousFetch);
      if(url.pathname==='/api/orders-v2'&&method==='POST'){
        try{var body=JSON.parse(String(init&&init.body||'{}'));if(Array.isArray(body.items)&&body.items.some(isRoman)){url.pathname='/api/orders-unified';input=url.toString();}}
        catch(_){}
      }
      return previousFetch.call(this,input,init);
    };
    wrapped.__romanUnified=true;window.fetch=wrapped;
  }

  function applyCommercial(d){var cfg=d&&d.config||{};var p=cfg.products&&cfg.products[KEY]||{};state.label=clean(p.label||state.label)||state.label;state.enabled=p.enabled===true;state.unitPrice=Math.max(0,Number(p.unitPrice||0));if(p.quantity){state.minimum=Math.max(1,Number(p.quantity.minimum||1));state.step=Math.max(1,Number(p.quantity.step||1));state.initial=Math.max(state.minimum,Number(p.quantity.initial||state.minimum))}ensureTab()}

  function boot(){injectStyle();installFunctionHooks();installFetchHook();ensureTab();fetch('/api/commercial-config?romanRuntime='+Date.now(),{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.json()}).then(applyCommercial).catch(function(){});var wanted='';try{wanted=new URLSearchParams(location.search).get('produto')||sessionStorage.getItem(WORKSPACE_STORAGE)||''}catch(_){}if(wanted===KEY)setTimeout(function(){activateRoman(false)},50);setInterval(function(){ensureTab();syncNav()},700)}

  injectStyle();
  if(window.__ARMAZEM_PRODUCTION_V2__)boot();else{var tries=0,t=setInterval(function(){tries++;if(window.__ARMAZEM_PRODUCTION_V2__){clearInterval(t);boot()}else if(tries>80)clearInterval(t)},100)}
})();
