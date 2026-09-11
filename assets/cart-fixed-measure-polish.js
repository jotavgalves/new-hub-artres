(function(){
  'use strict';
  if(window.__ARMAZEM_CART_FIXED_MEASURE_POLISH__==='2')return;
  window.__ARMAZEM_CART_FIXED_MEASURE_POLISH__='2';

  var PRODUCT_KEYS=['painel-romano','retangular-1x2'];
  var prices={'painel-romano':78,'retangular-1x2':78};
  var hooked=false;
  var scheduled=false;
  var refreshing=false;

  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function keyOf(value){
    return clean(value&&typeof value==='object'?(value.productKey||value.product||value.key):value);
  }
  function isFixedKey(key){return PRODUCT_KEYS.indexOf(clean(key))>=0}
  function isFixedItem(item){return isFixedKey(keyOf(item))}

  function injectStyle(){
    if(document.getElementById('cartFixedMeasurePolishStyle'))return;
    var style=document.createElement('style');
    style.id='cartFixedMeasurePolishStyle';
    style.textContent=`
      .cartItem .fixedMeasureBadge{display:none!important}
      .cartItem .measureClosed.fixedMeasureInline{
        display:block!important;
        margin:3px 0 9px!important;
        padding:0!important;
        border:0!important;
        background:transparent!important;
      }
      .cartItem .measureClosed.fixedMeasureInline .measureSummary{
        display:block!important;
        min-height:0!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
        color:#8a8490!important;
        font-family:"Plus Jakarta Sans",Arial,sans-serif!important;
        font-size:11.5px!important;
        font-weight:600!important;
        line-height:1.35!important;
        white-space:normal!important;
      }
      .cartItem .measureClosed.fixedMeasureInline .measureSummary:before{content:none!important}
      .cartItem .cartInfo>.qtyRow{margin-top:0!important}
      .cartItem .cartInfo>.findHint{margin-top:7px!important}
      @media(max-width:560px){
        .cartItem .measureClosed.fixedMeasureInline{margin:2px 0 8px!important}
        .cartItem .measureClosed.fixedMeasureInline .measureSummary{font-size:10.8px!important;line-height:1.3!important}
      }
    `;
    document.head.appendChild(style);
  }

  function cartItemForId(id){
    try{
      if(typeof cart==='undefined'||!Array.isArray(cart))return null;
      return cart.find(function(item){return String(item.id)===String(id)})||null;
    }catch(_){return null}
  }

  function polishItem(node){
    if(!node||node.nodeType!==1)return;
    var id=node.getAttribute('data-locate')||'';
    var item=cartItemForId(id);
    if(item&&!isFixedItem(item))return;

    var badge=node.querySelector('.fixedMeasureBadge');
    var measure=node.querySelector('.measureClosed');
    var summary=measure&&measure.querySelector('.measureSummary');
    var text=clean(summary&&summary.textContent);
    var looksFixed=/medida\s+fixa/i.test(text)||!!badge;
    if(!looksFixed)return;

    if(badge)badge.remove();
    if(!measure||!summary)return;

    summary.textContent='Medida fixa: 1,00 × 2,00 m';
    measure.classList.add('fixedMeasureInline');
    summary.classList.remove('romanFixedMeasure','retangularFixedMeasure','clamp');

    var info=node.querySelector('.cartInfo');
    var qty=info&&info.querySelector(':scope > .qtyRow');
    if(info&&qty&&measure.parentElement===info&&measure.nextElementSibling!==qty){
      info.insertBefore(measure,qty);
    }
  }

  function polish(root){
    injectStyle();
    var scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('.cartItem').forEach(polishItem);
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(function(){scheduled=false;polish(document)});
  }

  function hookPrice(){
    if(typeof price!=='function')return false;
    if(price.__fixedMeasureCommerce===true)return true;
    var previous=price;
    var wrapped=function(product,qty,item){
      var key=keyOf(product)||keyOf(item);
      if(isFixedKey(key)){
        var unit=Number(prices[key]||0);
        return Math.max(0,Number(qty||0))*Math.max(0,unit);
      }
      return previous.apply(this,arguments);
    };
    wrapped.__fixedMeasureCommerce=true;
    price=wrapped;
    return true;
  }

  async function refreshCommercial(){
    if(refreshing)return;
    refreshing=true;
    try{
      var response=await fetch('/api/commercial-config?_cartFixed='+Date.now(),{
        cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json','Cache-Control':'no-store'}
      });
      var data=await response.json().catch(function(){return{}});
      var products=data&&data.ok===true&&data.config&&data.config.products?data.config.products:{};
      PRODUCT_KEYS.forEach(function(key){
        var p=products[key];
        var value=Number(p&&p.unitPrice);
        if(Number.isFinite(value)&&value>0)prices[key]=value;
      });
      hookPrice();
      if(typeof renderCart==='function')renderCart();
    }catch(_){
      hookPrice();
      if(typeof renderCart==='function')renderCart();
    }finally{refreshing=false}
  }

  function hookRenderCart(){
    if(hooked||typeof renderCart!=='function')return false;
    var previous=renderCart;
    var wrapped=function(){
      hookPrice();
      var result=previous.apply(this,arguments);
      polish(document);
      return result;
    };
    wrapped.__fixedMeasurePolish=true;
    renderCart=wrapped;
    hooked=true;
    hookPrice();
    polish(document);
    return true;
  }

  function boot(){
    injectStyle();
    hookPrice();
    hookRenderCart();
    refreshCommercial();
    var attempts=0;
    var timer=setInterval(function(){
      attempts++;
      hookPrice();
      if(!hooked)hookRenderCart();
      polish(document);
      if(hooked&&attempts>40)clearInterval(timer);
      else if(attempts>160)clearInterval(timer);
    },250);
    setInterval(function(){hookPrice();refreshCommercial()},30000);
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
