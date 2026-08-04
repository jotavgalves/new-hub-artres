(function(){
  'use strict';
  if(window.__ARMAZEM_CHECKOUT_V3_RECOVERY__)return;
  window.__ARMAZEM_CHECKOUT_V3_RECOVERY__='2026-08-04.2';

  var SESSION_KEY='armazem:production:checkout-recovery-v3';
  var DURABLE_KEY='armazem:production:checkout-recovery-v4';
  var MAX_AGE=2*60*60*1000;
  var originalFetch=window.fetch;
  var attempts=new Map();
  var scheduled=false;

  window.fetch=function(input,init){
    var nextInit=init;
    try{
      var url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin);
      var method=String(init&&init.method||typeof input!=='string'&&input.method||'GET').toUpperCase();
      if(url.origin===location.origin&&url.pathname==='/api/orders-v2'&&method==='POST'){
        var headers=new Headers(init&&init.headers||typeof input!=='string'&&input.headers||{});
        var key=String(headers.get('Idempotency-Key')||'').trim();
        if(key){
          var count=Number(attempts.get(key)||0)+1;
          attempts.set(key,count);
          if(count>1)headers.set('X-Checkout-Retry','1');
          nextInit=Object.assign({},init||{},{headers:headers});
        }
      }
    }catch(_){ }
    return originalFetch.call(this,input,nextInit);
  };

  document.addEventListener('click',handleSellerSend,true);
  document.addEventListener('click',handleRecoveryDismiss,true);
  window.addEventListener('pageshow',function(){setTimeout(restoreRecentSuccess,0);});
  document.addEventListener('visibilitychange',function(){
    if(document.visibilityState==='visible')setTimeout(restoreRecentSuccess,0);
  });
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  setTimeout(function(){enhanceSuccess();restoreRecentSuccess();},0);

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(function(){scheduled=false;enhanceSuccess();});
  }

  function enhanceSuccess(){
    document.querySelectorAll('.checkoutV3Success').forEach(function(success){
      var control=success.querySelector('.checkoutV3OpenWa');
      var recovery=readRecovery();
      var href=control&&String(control.getAttribute('href')||control.dataset.sellerUrl||'').trim();
      var url=validSellerUrl(href)?href:recovery&&recovery.url||'';
      var orderNode=success.querySelector('.checkoutV3Order');
      var orderNumber=clean(orderNode&&orderNode.textContent);

      if(url&&orderNumber){
        writeRecovery({
          orderNumber:orderNumber,
          url:url,
          action:recovery&&recovery.action||'CREATED',
          createdAt:recovery&&recovery.createdAt||Date.now(),
          openedAt:recovery&&recovery.openedAt||0
        });
      }

      if(control&&control.tagName==='A'){
        var button=document.createElement('button');
        button.type='button';
        button.className=control.className;
        button.textContent=control.textContent||'Enviar para a vendedora';
        button.setAttribute('aria-label',control.getAttribute('aria-label')||'Enviar pedido para a vendedora');
        if(url)button.dataset.sellerUrl=url;
        control.replaceWith(button);
        control=button;
      }else if(control&&url){
        control.dataset.sellerUrl=url;
        control.removeAttribute('href');
        control.removeAttribute('target');
      }

      if(control)control.setAttribute('type','button');
      ensureStatus(success);
    });
  }

  function handleSellerSend(event){
    var control=event.target&&event.target.closest?event.target.closest('.checkoutV3OpenWa'):null;
    if(!control)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    var recovery=readRecovery();
    var url=String(control.dataset.sellerUrl||control.getAttribute('href')||recovery&&recovery.url||'').trim();
    var success=control.closest('.checkoutV3Success');
    var status=ensureStatus(success);
    if(!validSellerUrl(url)){
      if(status)status.textContent='Não foi possível preparar o contato da vendedora. O pedido continua registrado.';
      return;
    }

    var orderNode=success&&success.querySelector('.checkoutV3Order');
    writeRecovery({
      orderNumber:clean(orderNode&&orderNode.textContent)||recovery&&recovery.orderNumber||'',
      url:url,
      action:recovery&&recovery.action||'CREATED',
      createdAt:recovery&&recovery.createdAt||Date.now(),
      openedAt:Date.now()
    });

    control.disabled=true;
    if(status)status.textContent='Abrindo a conversa com a vendedora…';
    var opened=null;
    try{
      opened=window.open(url,'_blank');
      if(opened)try{opened.opener=null;}catch(_){ }
    }catch(_){opened=null;}

    if(opened){
      if(status)status.textContent='A conversa foi aberta. Ao voltar, este pedido continuará nesta tela.';
    }else{
      showManualFallback(success,url,status);
    }
    setTimeout(function(){control.disabled=false;},900);
  }

  function showManualFallback(success,url,status){
    if(status)status.textContent='O navegador bloqueou a abertura automática. Use o botão abaixo; o pedido já está salvo.';
    if(!success)return;
    var existing=success.querySelector('[data-checkout-wa-fallback]');
    if(existing){existing.href=url;return;}
    var link=document.createElement('a');
    link.href=url;
    link.target='_blank';
    link.rel='noopener noreferrer external';
    link.dataset.checkoutWaFallback='1';
    link.className='checkoutV3FallbackWa';
    link.textContent='Toque aqui para abrir o WhatsApp';
    success.appendChild(link);
  }

  function restoreRecentSuccess(){
    if(document.querySelector('.checkoutV3'))return;
    var recovery=readRecovery();
    if(!recovery)return;
    var root=document.createElement('div');
    root.className='checkoutV3 checkoutV3Recovered';
    root.innerHTML='<section class="checkoutV3Card" role="dialog" aria-modal="true" aria-label="Pedido registrado"><div class="checkoutV3Success"><div class="checkoutV3Check">✓</div><h2>Pedido registrado</h2><p>Seu pedido continua salvo. Você pode enviar novamente para a vendedora sem gerar outro número.</p><div class="checkoutV3Order"></div><button class="checkoutV3OpenWa" type="button">Enviar para a vendedora</button><button class="checkoutV3Retry" type="button" data-checkout-recovery-dismiss>Continuar escolhendo artes</button><small class="checkoutV3Note">Ao voltar do WhatsApp, esta confirmação permanece disponível.</small><small class="checkoutV3RecoveryStatus" aria-live="polite"></small></div></section>';
    root.querySelector('.checkoutV3Order').textContent=recovery.orderNumber;
    root.querySelector('.checkoutV3OpenWa').dataset.sellerUrl=recovery.url;
    document.body.appendChild(root);
  }

  function handleRecoveryDismiss(event){
    var button=event.target&&event.target.closest?event.target.closest('[data-checkout-recovery-dismiss],.checkoutV3Success [data-close]'):null;
    if(!button)return;
    clearRecovery();
    var recovered=button.closest('.checkoutV3Recovered');
    if(recovered){
      event.preventDefault();
      event.stopPropagation();
      recovered.remove();
    }
  }

  function ensureStatus(success){
    if(!success)return null;
    var status=success.querySelector('.checkoutV3RecoveryStatus');
    if(status)return status;
    status=document.createElement('small');
    status.className='checkoutV3RecoveryStatus';
    status.setAttribute('aria-live','polite');
    success.appendChild(status);
    return status;
  }

  function readRecovery(){
    var values=[];
    try{values.push(sessionStorage.getItem(SESSION_KEY));}catch(_){ }
    try{values.push(localStorage.getItem(DURABLE_KEY));}catch(_){ }
    for(var index=0;index<values.length;index+=1){
      try{
        var value=JSON.parse(values[index]||'null');
        if(!validRecovery(value))continue;
        writeRecovery(value);
        return value;
      }catch(_){ }
    }
    clearExpired();
    return null;
  }

  function validRecovery(value){
    if(!value||typeof value!=='object')return false;
    if(!/^PED[A-Z0-9-]{6,40}$/.test(clean(value.orderNumber).toUpperCase()))return false;
    if(!validSellerUrl(value.url))return false;
    var created=Number(value.createdAt||0);
    return created>0&&Date.now()-created>=0&&Date.now()-created<=MAX_AGE;
  }

  function validSellerUrl(value){
    return /^https:\/\/wa\.me\/\d{10,20}\?text=/.test(String(value||''));
  }

  function writeRecovery(value){
    if(!validRecovery(value))return;
    var serialized=JSON.stringify(value);
    try{sessionStorage.setItem(SESSION_KEY,serialized);}catch(_){ }
    try{localStorage.setItem(DURABLE_KEY,serialized);}catch(_){ }
  }

  function clearExpired(){
    try{sessionStorage.removeItem(SESSION_KEY);}catch(_){ }
    try{localStorage.removeItem(DURABLE_KEY);}catch(_){ }
  }

  function clearRecovery(){clearExpired();}
  function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
})();
