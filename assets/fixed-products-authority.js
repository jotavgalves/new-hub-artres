(function(){
  'use strict';
  if(window.__ARMAZEM_FIXED_PRODUCTS_AUTHORITY__==='1')return;
  window.__ARMAZEM_FIXED_PRODUCTS_AUTHORITY__='1';

  var KEYS=['painel-romano','retangular-1x2'];
  var state={
    'painel-romano':{label:'Painel Romano 1x2',unitPrice:78,enabled:true},
    'retangular-1x2':{label:'Painel Retangular',unitPrice:78,enabled:true}
  };
  var refreshing=false;

  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function keyOf(value){
    if(value&&typeof value==='object'){
      var direct=clean(value.productKey||value.product||value.key);
      if(KEYS.indexOf(direct)>=0)return direct;
      var text=clean([value.productName,value.productLabel,value.name].filter(Boolean).join(' ')).toLowerCase();
      if(text.indexOf('romano')>=0)return 'painel-romano';
      if(text.indexOf('retangular')>=0)return 'retangular-1x2';
      return '';
    }
    var raw=clean(value);
    return KEYS.indexOf(raw)>=0?raw:'';
  }
  function cfg(key){
    var p=state[key]||state['painel-romano'];
    return {label:p.label,type:'fixedRectangle',unitPrice:p.unitPrice,baseQty:1,basePrice:p.unitPrice,afterStep:1,initialQuantity:1,checkoutEnabled:p.enabled&&p.unitPrice>0,fixedWidth:100,fixedHeight:200,fixedSize:'1X2',sizeKey:'100x200'};
  }

  function applyCommercial(key,p){
    if(!state[key]||!p||typeof p!=='object')return;
    var price=Number(p.unitPrice);
    if(Number.isFinite(price)&&price>0)state[key].unitPrice=Math.round(price*100)/100;
    state[key].label=clean(p.label||state[key].label)||state[key].label;
    state[key].enabled=p.enabled!==false&&state[key].unitPrice>0;
  }

  async function refresh(){
    if(refreshing)return;
    refreshing=true;
    try{
      var r=await fetch('/api/commercial-config?_fixedAuthority='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json','Cache-Control':'no-store'}});
      var d=await r.json().catch(function(){return{}});
      var products=d&&d.ok===true&&d.config&&d.config.products?d.config.products:{};
      KEYS.forEach(function(key){applyCommercial(key,products[key])});
    }catch(_){}finally{refreshing=false}
    applyAll(true);
  }

  function seedProductConfig(){
    try{
      if(typeof PRODUCT_CONFIG==='undefined'||!PRODUCT_CONFIG)return;
      KEYS.forEach(function(key){PRODUCT_CONFIG[key]=cfg(key)});
    }catch(_){}
  }

  function canonicalizeCart(){
    var changed=false;
    try{
      if(typeof cart==='undefined'||!Array.isArray(cart))return false;
      cart.forEach(function(item){
        var key=keyOf(item);if(!key)return;
        var p=state[key];
        if(item.product!==key){item.product=key;changed=true}
        if(item.productKey!==key){item.productKey=key;changed=true}
        if(item.productName!==p.label){item.productName=p.label;changed=true}
        if(item.productLabel!==p.label){item.productLabel=p.label;changed=true}
        if(item.size!=='1X2'){item.size='1X2';changed=true}
        if(item.sizeKey!=='100x200'){item.sizeKey='100x200';changed=true}
        var details=item.details&&typeof item.details==='object'?item.details:{};
        if(item.details!==details){item.details=details;changed=true}
        var wanted={size:'1X2',sizeKey:'100x200',width:100,height:200,unit:'cm',fixed:true};
        Object.keys(wanted).forEach(function(k){if(details[k]!==wanted[k]){details[k]=wanted[k];changed=true}});
        if(details.customizing){details.customizing=false;changed=true}
        if(details.customized){details.customized=false;changed=true}
      });
    }catch(_){}
    return changed;
  }

  function wrapFunctions(){
    seedProductConfig();

    if(typeof productConfig==='function'&&!productConfig.__fixedProductsAuthority){
      var previousProductConfig=productConfig;
      var nextProductConfig=function(product){var key=keyOf(product);return key?cfg(key):previousProductConfig(product)};
      nextProductConfig.__fixedProductsAuthority=true;
      productConfig=nextProductConfig;
    }

    if(typeof price==='function'&&!price.__fixedProductsAuthority){
      var previousPrice=price;
      var nextPrice=function(product,qty,item){var key=keyOf(product)||keyOf(item);return key?Math.max(0,Number(qty||0))*state[key].unitPrice:previousPrice(product,qty,item)};
      nextPrice.__fixedProductsAuthority=true;
      price=nextPrice;
    }

    if(typeof artPriceText==='function'&&!artPriceText.__fixedProductsAuthority){
      var previousArtPriceText=artPriceText;
      var nextArtPriceText=function(item){var key=keyOf(item);return key?money(state[key].unitPrice):previousArtPriceText(item)};
      nextArtPriceText.__fixedProductsAuthority=true;
      artPriceText=nextArtPriceText;
    }

    if(typeof priceTextFor==='function'&&!priceTextFor.__fixedProductsAuthority){
      var previousPriceTextFor=priceTextFor;
      var nextPriceTextFor=function(item){var key=keyOf(item);return key?money(state[key].unitPrice)+' cada':previousPriceTextFor(item)};
      nextPriceTextFor.__fixedProductsAuthority=true;
      priceTextFor=nextPriceTextFor;
    }

    if(typeof itemActionButton==='function'&&!itemActionButton.__fixedProductsAuthority){
      var previousItemActionButton=itemActionButton;
      var nextItemActionButton=function(item){return keyOf(item)?'':previousItemActionButton(item)};
      nextItemActionButton.__fixedProductsAuthority=true;
      itemActionButton=nextItemActionButton;
    }

    if(typeof measureFields==='function'&&!measureFields.__fixedProductsAuthority){
      var previousMeasureFields=measureFields;
      var nextMeasureFields=function(item){
        if(keyOf(item))return '<div class="measureClosed fixedMeasureInline"><div class="measureSummary">Medida fixa: 1,00 × 2,00 m</div></div>';
        return previousMeasureFields(item);
      };
      nextMeasureFields.__fixedProductsAuthority=true;
      measureFields=nextMeasureFields;
    }

    if(typeof detailsForWhatsApp==='function'&&!detailsForWhatsApp.__fixedProductsAuthority){
      var previousDetailsForWhatsApp=detailsForWhatsApp;
      var nextDetailsForWhatsApp=function(item){return keyOf(item)?'Medida: 1,00 x 2,00 m':previousDetailsForWhatsApp(item)};
      nextDetailsForWhatsApp.__fixedProductsAuthority=true;
      detailsForWhatsApp=nextDetailsForWhatsApp;
    }
  }

  function cleanRenderedCart(){
    try{
      document.querySelectorAll('.cartItem .fixedMeasureBadge').forEach(function(node){node.remove()});
      document.querySelectorAll('.cartItem').forEach(function(node){
        var text=clean(node.textContent).toLowerCase();
        if(text.indexOf('painel romano')<0&&text.indexOf('painel retangular')<0)return;
        var summaries=node.querySelectorAll('.measureSummary');
        if(summaries.length){
          summaries[0].textContent='Medida fixa: 1,00 × 2,00 m';
          summaries[0].classList.remove('romanFixedMeasure','retangularFixedMeasure','clamp');
          summaries[0].parentElement&&summaries[0].parentElement.classList.add('fixedMeasureInline');
          for(var i=1;i<summaries.length;i++)summaries[i].parentElement&&summaries[i].parentElement.remove();
        }
      });
    }catch(_){}
  }

  function applyAll(render){
    wrapFunctions();
    var changed=canonicalizeCart();
    if(changed&&typeof save==='function'){try{save()}catch(_){}}
    if(render&&typeof renderCart==='function'){try{renderCart()}catch(_){}}
    cleanRenderedCart();
  }

  function boot(){
    applyAll(true);
    refresh();
    var attempts=0;
    var timer=setInterval(function(){
      attempts++;
      applyAll(attempts<20);
      if(attempts>=40)clearInterval(timer);
    },250);
    setInterval(refresh,30000);
    new MutationObserver(function(){cleanRenderedCart()}).observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
