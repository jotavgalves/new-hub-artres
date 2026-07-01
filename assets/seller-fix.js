(function(){
  if(window.__SELLER_FIX_ON__)return;window.__SELLER_FIX_ON__=true;
  function dig(v){return String(v||'').replace(/\D/g,'')}
  function norm(v){var d=dig(v);return d.indexOf('55')===0?d.slice(2):d}
  function phoneFromUrl(u){try{var url=new URL(u,location.href);return dig(url.searchParams.get('phone')||url.pathname)}catch(e){return dig(u)}}
  function byPhone(phone){var want=norm(phone);try{for(var id in SELLERS){var s=SELLERS[id];if(norm(s.phone)===want)return{id:id,label:s.label,phone:dig(s.phone)}}}catch(e){}return null}
  function inferSeller(){try{if(typeof selectedSeller!=='undefined'&&selectedSeller&&SELLERS&&SELLERS[selectedSeller]){var s=SELLERS[selectedSeller];return{id:selectedSeller,label:s.label,phone:dig(s.phone)}}}catch(e){}try{if(typeof waUrl==='function'){var p=phoneFromUrl(waUrl());var s2=byPhone(p);if(s2)return s2}}catch(e){}var a=document.querySelector('a.wa:not(.disabled)');if(a){var s3=byPhone(phoneFromUrl(a.href));if(s3)return s3}return null}
  var old=window.fetch;
  window.fetch=function(input,init){
    try{var u=typeof input==='string'?input:String(input&&input.url||'');var m=String(init&&init.method||'GET').toUpperCase();if(u.indexOf('/api/orders')>-1&&m==='POST'&&init&&init.body){var body=JSON.parse(init.body);if(body&&body.customer&&body.customer.name&&!body.seller){var seller=inferSeller();if(seller){body.seller=seller;init=Object.assign({},init,{body:JSON.stringify(body)});}}}}
    catch(e){}
    return old.apply(this,arguments.length===2?[input,init]:arguments)
  };
})();
