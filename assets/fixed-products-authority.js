(function(){
  'use strict';
  if(window.__ARMAZEM_FIXED_PRODUCTS_AUTHORITY__==='2')return;
  window.__ARMAZEM_FIXED_PRODUCTS_AUTHORITY__='2';

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
    var raw=clean(value);return KEYS.indexOf(raw)>=0?raw:'';
  }
  function cfg(key){var p=state[key];return{label:p.label,type:'fixedRectangle',unitPrice:p.unitPrice,baseQty:1,basePrice:p.unitPrice,afterStep:1,initialQuantity:1,checkoutEnabled:p.enabled&&p.unitPrice>0,fixedWidth:100,fixedHeight:200,fixedSize:'1X2',sizeKey:'100x200'}}
  function applyCommercial(key,p){if(!state[key]||!p)return;var n=Number(p.unitPrice);if(Number.isFinite(n)&&n>0)state[key].unitPrice=Math.round(n*100)/100;state[key].label=clean(p.label||state[key].label)||state[key].label;state[key].enabled=p.enabled!==false&&state[key].unitPrice>0}

  function canonicalizeCart(){
    var changed=false;
    try{
      if(typeof cart==='undefined'||!Array.isArray(cart))return false;
      cart.forEach(function(item){
        var key=keyOf(item);if(!key)return;var p=state[key];
        if(item.product!==key){item.product=key;changed=true}
        if(item.productKey!==key){item.productKey=key;changed=true}
        if(item.productName!==p.label){item.productName=p.label;changed=true}
        if(item.size!=='1X2'){item.size='1X2';changed=true}
        if(item.sizeKey!=='100x200'){item.sizeKey='100x200';changed=true}
        if(!item.details||typeof item.details!=='object'){item.details={};changed=true}
        var wanted={size:'1X2',sizeKey:'100x200',width:100,height:200,unit:'cm',fixed:true};
        Object.keys(wanted).forEach(function(k){if(item.details[k]!==wanted[k]){item.details[k]=wanted[k];changed=true}});
        if(item.details.customizing){delete item.details.customizing;changed=true}
        if(item.details.customized){delete item.details.customized;changed=true}
      });
    }catch(_){}
    return changed;
  }

  function install(){
    try{if(typeof PRODUCT_CONFIG!=='undefined'&&PRODUCT_CONFIG)KEYS.forEach(function(k){PRODUCT_CONFIG[k]=cfg(k)})}catch(_){}

    if(typeof productConfig==='function'&&!productConfig.__fixedAuthority2){var oldPC=productConfig;productConfig=function(product){var k=keyOf(product);return k?cfg(k):oldPC(product)};productConfig.__fixedAuthority2=true}
    if(typeof price==='function'&&!price.__fixedAuthority2){var oldPrice=price;price=function(product,qty,item){var k=keyOf(product)||keyOf(item);return k?Math.max(0,Number(qty||0))*state[k].unitPrice:oldPrice(product,qty,item)};price.__fixedAuthority2=true}
    if(typeof artPriceText==='function'&&!artPriceText.__fixedAuthority2){var oldArt=artPriceText;artPriceText=function(item){var k=keyOf(item);return k?money(state[k].unitPrice):oldArt(item)};artPriceText.__fixedAuthority2=true}
    if(typeof priceTextFor==='function'&&!priceTextFor.__fixedAuthority2){var oldText=priceTextFor;priceTextFor=function(item){var k=keyOf(item);return k?money(state[k].unitPrice)+' cada':oldText(item)};priceTextFor.__fixedAuthority2=true}
    if(typeof itemActionButton==='function'&&!itemActionButton.__fixedAuthority2){var oldAction=itemActionButton;itemActionButton=function(item){return keyOf(item)?'':oldAction(item)};itemActionButton.__fixedAuthority2=true}
    if(typeof measureFields==='function'&&!measureFields.__fixedAuthority2){var oldMeasure=measureFields;measureFields=function(item){return keyOf(item)?'<div class="measureClosed fixedMeasureInline"><div class="measureSummary">Medida fixa: 1,00 × 2,00 m</div></div>':oldMeasure(item)};measureFields.__fixedAuthority2=true}
    if(typeof detailsForWhatsApp==='function'&&!detailsForWhatsApp.__fixedAuthority2){var oldWA=detailsForWhatsApp;detailsForWhatsApp=function(item){return keyOf(item)?'Medida: 1,00 x 2,00 m':oldWA(item)};detailsForWhatsApp.__fixedAuthority2=true}

    var changed=canonicalizeCart();
    if(changed&&typeof save==='function'){try{save()}catch(_){}}
    if(typeof renderCart==='function'){try{renderCart()}catch(_){}}
  }

  async function refresh(){
    if(refreshing)return;refreshing=true;
    try{var r=await fetch('/api/commercial-config?_fixedAuthority='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json','Cache-Control':'no-store'}});var d=await r.json().catch(function(){return{}});var products=d&&d.ok===true&&d.config&&d.config.products?d.config.products:{};KEYS.forEach(function(k){applyCommercial(k,products[k])})}catch(_){}finally{refreshing=false}
    install();
  }

  function boot(){
    install();
    refresh();
    [200,700,1600].forEach(function(ms){setTimeout(install,ms)});
    window.addEventListener('pageshow',function(){install();refresh()});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
