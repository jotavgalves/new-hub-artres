(function(){
  if(window.__ARMAZEM_PAINEL_RETANGULAR_RUNTIME__==='1')return;
  window.__ARMAZEM_PAINEL_RETANGULAR_RUNTIME__='1';

  var KEY='retangular-1x2';
  var ROOT='1r4BdVOZasdtlE16K7TKIVkHCfVSHLRML';
  var WORKSPACE_STORAGE='armazem:production:workspace';
  var state={label:'Painel Retangular',enabled:false,unitPrice:0,minimum:1,step:1,initial:1,active:false,installed:false,autoOpened:false};

  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function norm(v){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
  function moneyBR(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function isRect(v){return !!v&&String(v.product||v.productKey||v.key||'')===KEY}
  function isRectTheme(v){return !!v&&String(v.id||'').indexOf('retangular-1x2-theme:')===0}
  function notify(msg){try{if(typeof toast==='function')toast(msg);else alert(msg)}catch(_){}}
  function request(params){var q=new URLSearchParams(params||{});q.set('_',String(Date.now()));return fetch('/api/painel-retangular?'+q.toString(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok||d.ok===false)throw new Error(d.detail||d.error||'Falha ao carregar Painel Retangular.');return d})})}
  function rectProduct(theme){theme=theme||(typeof selectedTheme!=='undefined'?selectedTheme:null)||{id:'',name:'Tema'};return{id:'retangular-1x2-product:'+String(theme.id||norm(theme.name||'tema')),name:state.label,rawName:state.label,label:state.label,productName:state.label,product:KEY,productKey:KEY,kind:'product',rootFolderId:ROOT,size:'1X2',sizeKey:'100x200'}}

  function injectStyle(){
    if(document.getElementById('painelRetangularRuntimeStyle'))return;
    var s=document.createElement('style');s.id='painelRetangularRuntimeStyle';
    s.textContent='.productionV2Tabs{grid-template-columns:repeat(4,minmax(0,1fr))!important}.productionV2RetangularTab i{font-size:10px!important}.productionV2RetangularTab[data-unpriced="1"]:not(.active){opacity:.72}.retangularFixedMeasure{background:#faf7fd!important;border-color:#e9ddf1!important;color:#74458e!important}@media(max-width:620px){.productionV2Tabs{display:grid!important;grid-template-columns:repeat(4,minmax(118px,1fr))!important;overflow-x:auto!important;scrollbar-width:none}.productionV2Tabs::-webkit-scrollbar{display:none}.productionV2Tab{padding-left:7px!important;padding-right:7px!important}.productionV2Tab b{font-size:10px!important}}';
    document.head.appendChild(s);
  }

  function deactivateRomanSignal(){
    var nav=document.getElementById('productionV2Nav');if(!nav)return;
    var signal=document.createElement('span');signal.hidden=true;signal.setAttribute('data-workspace','__retangular_signal__');nav.appendChild(signal);
    try{signal.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))}catch(_){}
    signal.remove();
  }

  function ensureTab(){
    var nav=document.getElementById('productionV2Nav');var tabs=nav&&nav.querySelector('.productionV2Tabs');if(!tabs)return false;
    var btn=document.getElementById('productionV2RetangularTab');
    if(!btn){
      btn=document.createElement('button');btn.id='productionV2RetangularTab';btn.type='button';btn.className='productionV2Tab productionV2RetangularTab';btn.setAttribute('data-retangular-workspace',KEY);btn.innerHTML='<i aria-hidden="true">1×2</i><span><b>Painel Retangular</b></span>';
      btn.onclick=function(e){e.preventDefault();e.stopPropagation();activateRect(true)};tabs.appendChild(btn);
      nav.addEventListener('click',function(e){var target=e.target&&e.target.closest&&e.target.closest('[data-workspace],#productionV2RomanTab');if(target)deactivateRect(false)},true);
    }
    btn.dataset.unpriced=state.enabled&&state.unitPrice>0?'0':'1';
    btn.title=state.enabled&&state.unitPrice>0?state.label:'Painel Retangular — medida 1x2. Defina o preço no painel administrativo para vender';
    syncNav();return true;
  }

  function syncNav(){
    if(!state.active)return;
    document.querySelectorAll('#productionV2Nav [data-workspace],#productionV2RomanTab').forEach(function(b){b.classList.remove('active')});
    var btn=document.getElementById('productionV2RetangularTab');if(btn)btn.classList.add('active');
    document.querySelectorAll('[data-workspace-title]').forEach(function(n){n.textContent=state.label});
  }
  function remember(){try{sessionStorage.setItem(WORKSPACE_STORAGE,KEY)}catch(_){}try{var u=new URL(location.href);u.searchParams.set('produto',KEY);history.replaceState(history.state,'',u.pathname+u.search+u.hash)}catch(_){}try{localStorage.removeItem('armazem:lastPlace')}catch(_){}}
  function deactivateRect(clearUrl){state.active=false;var btn=document.getElementById('productionV2RetangularTab');if(btn)btn.classList.remove('active');if(clearUrl){try{var u=new URL(location.href);if(u.searchParams.get('produto')===KEY){u.searchParams.delete('produto');history.replaceState(history.state,'',u.pathname+u.search+u.hash)}}catch(_){}}}
  function showEmptyCatalog(){
    if(typeof updateHead==='function')updateHead('Painel Retangular','Medida fixa de 1,00 × 2,00 m. As artes aparecerão aqui assim que forem adicionadas à pasta do produto.','Em preparação');
    var host=document.getElementById('content');
    if(host)host.innerHTML='<div class="empty"><div><b>Nenhuma arte cadastrada ainda</b><span>A pasta do Painel Retangular já está conectada. Quando novas artes forem adicionadas, elas serão carregadas automaticamente.</span></div></div>';
  }

  async function activateRect(announce){
    deactivateRomanSignal();state.active=true;remember();syncNav();var chooser=document.getElementById('productionV2Chooser');if(chooser)chooser.remove();
    if(announce)notify(state.enabled&&state.unitPrice>0?'Agora você está vendo '+state.label+'.':state.label+' aberto. A medida é 1x2 e o preço ainda será definido no Admin.');
    try{
      if(typeof view!=='undefined')view='themes';if(typeof selectedTheme!=='undefined')selectedTheme=null;if(typeof selectedProduct!=='undefined')selectedProduct=null;if(typeof currentFolder!=='undefined')currentFolder=null;if(typeof folderTrail!=='undefined')folderTrail=[];
      var search=document.getElementById('search');if(search)search.value='';if(typeof updateHead==='function')updateHead('Escolha um tema','Escolha um tema disponível para '+state.label+'.','carregando');if(typeof loading==='function')loading('Buscando Painéis Retangulares...');
      var d=await request({mode:'themes'});if(!state.active)return;var nextThemes=Array.isArray(d.folders)?d.folders:[];if(typeof themes!=='undefined')themes=nextThemes;if(nextThemes.length&&typeof showThemes==='function')showThemes();else showEmptyCatalog();syncNav();
    }catch(e){if(typeof themes!=='undefined')themes=[];if(typeof errorScreen==='function')errorScreen('Não foi possível carregar o catálogo do Painel Retangular.');else notify('Não foi possível carregar os Painéis Retangulares agora.');syncNav();}
  }

  function installFunctionHooks(){
    if(state.installed)return;state.installed=true;
    if(typeof productConfig==='function'){var oldProductConfig=productConfig;productConfig=function(product){if(product===KEY)return{label:state.label,type:'fixedRectangle',unitPrice:state.unitPrice,baseQty:state.minimum,basePrice:state.minimum*state.unitPrice,afterStep:state.step,initialQuantity:state.initial,checkoutEnabled:state.enabled&&state.unitPrice>0,fixedWidth:100,fixedHeight:200,fixedSize:'1X2',sizeKey:'100x200'};return oldProductConfig(product)}}
    if(typeof label==='function'){var oldLabel=label;label=function(key){return key===KEY?state.label:oldLabel(key)}}
    if(typeof price==='function'){var oldPrice=price;price=function(product,qty,item){if(product===KEY)return Math.max(0,Number(qty||0))*Math.max(0,Number(state.unitPrice||0));return oldPrice(product,qty,item)}}
    if(typeof priceTextFor==='function'){var oldPriceTextFor=priceTextFor;priceTextFor=function(p){if(isRect(p))return state.unitPrice>0?moneyBR(state.unitPrice)+' cada':'Preço a definir';return oldPriceTextFor(p)}}
    if(typeof artPriceText==='function'){var oldArtPriceText=artPriceText;artPriceText=function(item){if(isRect(item))return state.unitPrice>0?moneyBR(state.unitPrice):'Preço a definir';return oldArtPriceText(item)}}
    if(typeof itemActionButton==='function'){var oldItemActionButton=itemActionButton;itemActionButton=function(item){if(isRect(item))return'<span class="fixedMeasureBadge">Medida fixa 1×2 m</span>';return oldItemActionButton(item)}}
    if(typeof measureFields==='function'){var oldMeasureFields=measureFields;measureFields=function(item){if(isRect(item))return'<div class="measureClosed"><div class="measureSummary clamp retangularFixedMeasure">Medida fixa: 1,00 × 2,00 m</div></div>';return oldMeasureFields(item)}}
    if(typeof detailsForWhatsApp==='function'){var oldDetailsForWhatsApp=detailsForWhatsApp;detailsForWhatsApp=function(item){if(isRect(item))return'Medida: 1,00 x 2,00 m';return oldDetailsForWhatsApp(item)}}
    if(typeof prefetchProductsForTheme==='function'){var oldPrefetchProducts=prefetchProductsForTheme;prefetchProductsForTheme=function(t){if(state.active||isRectTheme(t))return Promise.resolve();return oldPrefetchProducts(t)}}
    if(typeof prefetchItemsForProducts==='function'){var oldPrefetchItems=prefetchItemsForProducts;prefetchItemsForProducts=function(list){if(state.active)return Promise.resolve();return oldPrefetchItems((list||[]).filter(function(p){return!isRect(p)}))}}
    if(typeof addItem==='function'){var oldAddItem=addItem;addItem=function(id){var source=(typeof items!=='undefined'&&Array.isArray(items)?items:[]).find(function(i){return String(i.id)===String(id)})||(typeof prev!=='undefined'?prev:null);if(isRect(source)&&(!state.enabled||!(state.unitPrice>0))){notify('Defina o preço do '+state.label+' no painel administrativo antes de vender.');return}return oldAddItem(id)}}
    if(typeof cartRule==='function'){var oldCartRule=cartRule;cartRule=function(){var list=(typeof cart!=='undefined'&&Array.isArray(cart)?cart:[]).filter(isRect);if(list.length){if(!state.enabled||!(state.unitPrice>0))return{ok:false,msg:state.label+' está sem preço ou indisponível no momento.'};var bad=list.find(function(i){var q=Math.max(1,Number(i.qty||1));return q<state.minimum||(q-state.minimum)%state.step!==0});if(bad)return{ok:false,msg:'Revise a quantidade de '+state.label+'.'}}return oldCartRule()}}
    if(typeof loadProducts==='function'){var oldLoadProducts=loadProducts;loadProducts=async function(folder,navMode){if(!state.active&&!isRectTheme(folder))return oldLoadProducts(folder,navMode);state.active=true;selectedTheme=folder;folderTrail=[];currentFolder=folder;selectedProduct=null;view='products';var search=document.getElementById('search');if(search)search.value='';if(typeof rememberPlace==='function')rememberPlace();products=[rectProduct(folder)];if(typeof showProducts==='function')showProducts();syncNav()}}
    if(typeof loadItems==='function'){var oldLoadItems=loadItems;loadItems=async function(product){if(!isRect(product))return oldLoadItems(product);state.active=true;selectedProduct=product;view='items';showFavs=false;var search=document.getElementById('search');if(search)search.value='';if(typeof updateHead==='function')updateHead('Escolha suas artes',state.label+' com medida fixa de 1,00 x 2,00 m.','carregando');if(typeof loading==='function')loading('Preparando os Painéis Retangulares...','arts');if(typeof rememberPlace==='function')rememberPlace();try{var themeName=typeof fullThemeName==='function'?fullThemeName():'';themeName=themeName||(selectedTheme&&selectedTheme.name)||'';var d=await request({mode:'items',theme:themeName});items=Array.isArray(d.items)?d.items:[];items.forEach(function(i){i.product=KEY;i.productKey=KEY;i.productName=state.label;i.size='1X2';i.sizeKey='100x200';i.details=Object.assign({},i.details||{},{size:'1X2',sizeKey:'100x200',width:100,height:200,unit:'cm',fixed:true})});if(typeof renderItems==='function')renderItems();syncNav()}catch(e){if(typeof errorScreen==='function')errorScreen(e.message||'Não foi possível carregar os Painéis Retangulares.')}}}
    if(typeof globalCodeSearch==='function'){var oldGlobalCodeSearch=globalCodeSearch;globalCodeSearch=async function(q){if(!state.active)return oldGlobalCodeSearch(q);view='search';selectedProduct=null;showFavs=false;if(typeof updateHead==='function')updateHead('Busca por código','Procurando a arte #'+q+' nos Painéis Retangulares.','buscando');if(typeof loading==='function')loading('Procurando essa arte...');try{var d=await request({mode:'search',code:q});items=Array.isArray(d.items)?d.items:[];if(typeof renderItems==='function')renderItems();syncNav()}catch(e){items=[];if(typeof renderItems==='function')renderItems();notify('Não foi possível concluir a busca agora.')}}}
  }

  function mergeReconcile(receiver,input,init,previousFetch){var body;try{body=JSON.parse(String(init&&init.body||'{}'))}catch(_){return previousFetch.call(receiver,input,init)}var all=Array.isArray(body.items)?body.items:[];var ours=all.filter(isRect);if(!ours.length)return previousFetch.call(receiver,input,init);var standard=all.filter(function(i){return!isRect(i)});if(!standard.length)return Promise.resolve(new Response(JSON.stringify({ok:true,items:ours,migrations:[],removed:[],changed:false}),{status:200,headers:{'Content-Type':'application/json'}}));var next=Object.assign({},init,{body:JSON.stringify({items:standard})});return previousFetch.call(receiver,input,next).then(async function(response){var d=await response.clone().json().catch(function(){return{}});if(!response.ok||d.ok!==true||!Array.isArray(d.items))return response;d.items=d.items.concat(ours);return new Response(JSON.stringify(d),{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})})}
  function installFetchHook(){if(window.fetch.__retangularUnified)return;var previousFetch=window.fetch;var wrapped=function(input,init){var url;try{url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin)}catch(_){return previousFetch.apply(this,arguments)}var method=String(init&&init.method||'GET').toUpperCase();if(url.pathname==='/api/reconcile-cart'&&method==='POST')return mergeReconcile(this,input,init,previousFetch);if(url.pathname==='/api/orders-v2'&&method==='POST'){try{var body=JSON.parse(String(init&&init.body||'{}'));if(Array.isArray(body.items)&&body.items.some(isRect)){url.pathname='/api/orders-unified';input=url.toString()}}catch(_){}}return previousFetch.call(this,input,init)};wrapped.__retangularUnified=true;window.fetch=wrapped}

  async function loadCommercial(){try{var r=await fetch('/api/commercial-config?_retangular='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json'}});var d=await r.json();var p=d&&d.config&&d.config.products&&d.config.products[KEY];if(p){state.label=clean(p.label||state.label)||state.label;state.unitPrice=Math.max(0,Number(p.unitPrice||0));state.enabled=p.enabled===true&&state.unitPrice>0;var q=p.quantity||{};state.minimum=Math.max(1,Number(q.minimum||1));state.step=Math.max(1,Number(q.step||1));state.initial=Math.max(state.minimum,Number(q.initial||state.minimum))}}catch(_){}ensureTab()}
  function shouldAutoOpen(){try{var q=new URL(location.href).searchParams.get('produto')||new URL(location.href).searchParams.get('product')||'';if(q===KEY)return true}catch(_){}try{return sessionStorage.getItem(WORKSPACE_STORAGE)===KEY}catch(_){return false}}

  function boot(){injectStyle();installFetchHook();loadCommercial();var tries=0;var timer=setInterval(function(){tries++;var tab=ensureTab();if(typeof loadProducts==='function'&&typeof loadItems==='function')installFunctionHooks();if(tab&&!state.autoOpened&&shouldAutoOpen()){state.autoOpened=true;activateRect(false)}if((tab&&state.installed&&state.autoOpened)||tries>120)clearInterval(timer)},100)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
