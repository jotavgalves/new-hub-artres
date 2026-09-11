(function(){
  'use strict';
  if(window.__ARMAZEM_CART_FIXED_MEASURE_POLISH__==='1')return;
  window.__ARMAZEM_CART_FIXED_MEASURE_POLISH__='1';

  var PRODUCT_KEYS=['painel-romano','retangular-1x2'];
  var hooked=false;
  var scheduled=false;

  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function isFixedItem(item){
    var key=clean(item&&(item.productKey||item.product));
    return PRODUCT_KEYS.indexOf(key)>=0;
  }

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

  function hookRenderCart(){
    if(hooked||typeof renderCart!=='function')return false;
    var previous=renderCart;
    var wrapped=function(){
      var result=previous.apply(this,arguments);
      polish(document);
      return result;
    };
    wrapped.__fixedMeasurePolish=true;
    renderCart=wrapped;
    hooked=true;
    polish(document);
    return true;
  }

  function boot(){
    injectStyle();
    hookRenderCart();
    var attempts=0;
    var timer=setInterval(function(){
      attempts++;
      if(!hooked)hookRenderCart();
      polish(document);
      if(hooked&&attempts>20)clearInterval(timer);
      else if(attempts>120)clearInterval(timer);
    },250);
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
