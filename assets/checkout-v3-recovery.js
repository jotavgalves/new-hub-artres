(function(){
  'use strict';
  if(window.__ARMAZEM_CHECKOUT_V3_RECOVERY__)return;
  window.__ARMAZEM_CHECKOUT_V3_RECOVERY__='2026-08-04.1';

  var originalFetch=window.fetch;
  var attempts=new Map();

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
})();
