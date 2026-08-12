(function(){
  'use strict';
  if(window.__ARMAZEM_CART_RECONCILE_V1__)return;
  window.__ARMAZEM_CART_RECONCILE_V1__='2026-08-12.1';

  var originalFetch=window.fetch;

  window.fetch=async function(input,init){
    var url;
    try{url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin);}catch(_){return originalFetch.apply(this,arguments);}
    if(url.pathname!=='/api/orders-v2'||!init||String(init.method||'GET').toUpperCase()!=='POST')return originalFetch.apply(this,arguments);

    var body;
    try{body=JSON.parse(String(init.body||'{}'));}catch(_){return originalFetch.apply(this,arguments);}
    if(!body||!Array.isArray(body.items)||!body.items.length)return originalFetch.apply(this,arguments);

    var enriched=enrichItems(body.items);
    try{
      var reconcileResponse=await originalFetch.call(this,'/api/reconcile-cart',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify({items:enriched})
      });
      var reconcile=await reconcileResponse.json().catch(function(){return {};});
      if(reconcileResponse.ok&&reconcile.ok===true&&Array.isArray(reconcile.items)){
        body.items=reconcile.items;
        init=Object.assign({},init,{body:JSON.stringify(body)});
        repairLocalCart(reconcile.migrations,reconcile.removed);
        return originalFetch.call(this,input,init);
      }
    }catch(_){ }
    return originalFetch.call(this,input,init);
  };

  function enrichItems(items){
    var local=safeCart();
    return items.map(function(item){
      var id=String(item&&item.driveFileId||'');
      var source=local.find(function(entry){return String(entry&&entry.driveFileId||entry&&entry.id||'')===id;})||{};
      return Object.assign({},item,{
        code:String(source.code||item.code||''),
        theme:String(source.theme||item.theme||''),
        originalName:String(source.originalName||source.rawName||item.originalName||'')
      });
    });
  }

  function repairLocalCart(migrations,removed){
    try{
      if(typeof cart==='undefined'||!Array.isArray(cart))return;
      var migrationList=Array.isArray(migrations)?migrations:[];
      var removedList=Array.isArray(removed)?removed:[];
      var byOld=new Map(migrationList.map(function(m){return [String(m.oldDriveFileId||''),m];}));
      var removedIds=new Set(removedList.map(function(item){return String(item&&item.driveFileId||'');}).filter(Boolean));
      var changed=false;

      for(var index=cart.length-1;index>=0;index-=1){
        var item=cart[index];
        var oldId=String(item&&item.driveFileId||item&&item.id||'');
        if(removedIds.has(oldId)){
          cart.splice(index,1);
          changed=true;
          continue;
        }
        var migration=byOld.get(oldId);
        if(!migration||!migration.driveFileId)continue;
        item.id=migration.driveFileId;
        item.driveFileId=migration.driveFileId;
        if(migration.code)item.code=migration.code;
        if(migration.theme)item.theme=migration.theme;
        if(migration.originalName)item.originalName=migration.originalName;
        if(migration.image)item.image=migration.image;
        changed=true;
      }

      if(!changed)return;
      if(typeof save==='function')save();
      if(typeof renderCart==='function')renderCart();
      try{
        window.dispatchEvent(new CustomEvent('armazem:cart-reconciled',{
          detail:{removed:removedList.length,migrated:migrationList.length}
        }));
      }catch(_){ }
    }catch(_){ }
  }

  function safeCart(){
    try{return typeof cart!=='undefined'&&Array.isArray(cart)?cart.slice():[];}catch(_){return [];}
  }
})();
