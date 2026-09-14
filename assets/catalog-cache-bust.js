(function(){
  if (window.__CATALOG_VERSIONED_CACHE__ === '2') return;
  window.__CATALOG_VERSIONED_CACHE__ = '2';

  function loadScript(id, src, parent){
    if (document.getElementById(id)) return null;
    var script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    (parent || document.head).appendChild(script);
    return script;
  }

  function loadCheckoutUi(){loadScript('checkoutV3UiScript','/assets/checkout-v3-ui.js?v=20260804-1',document.body||document.head)}
  function loadCheckoutRecovery(){var s=loadScript('checkoutV3RecoveryScript','/assets/checkout-v3-recovery.js?v=20260804-2',document.body||document.head);if(s)s.addEventListener('load',loadCheckoutUi,{once:true});else loadCheckoutUi()}
  function loadCheckoutV3(){var s=loadScript('checkoutV3Script','/assets/checkout-v3.js?v=20260806-2',document.body||document.head);if(s)s.addEventListener('load',loadCheckoutRecovery,{once:true});else loadCheckoutRecovery()}
  function loadCartReconcile(){var s=loadScript('cartReconcileV1Script','/assets/cart-reconcile-v1.js?v=20260819-1',document.body||document.head);if(s)s.addEventListener('load',loadCheckoutV3,{once:true});else loadCheckoutV3()}
  function loadFixedProductsAuthority(){var s=loadScript('fixedProductsAuthorityScript','/assets/fixed-products-authority.js?v=2',document.body||document.head);if(s)s.addEventListener('load',loadCartReconcile,{once:true});else loadCartReconcile()}
  function loadProductSelectorPolish(){var s=loadScript('productSelectorPolishScript','/assets/product-selector-polish.js?v=2',document.body||document.head);if(s)s.addEventListener('load',loadFixedProductsAuthority,{once:true});else loadFixedProductsAuthority()}
  function loadPainelRetangular(){var s=loadScript('painelRetangularRuntimeScript','/assets/painel-retangular-runtime.js?v=2',document.body||document.head);if(s)s.addEventListener('load',loadProductSelectorPolish,{once:true});else loadProductSelectorPolish()}
  function loadPainelRomano(){var s=loadScript('painelRomanoRuntimeScript','/assets/painel-romano-runtime.js?v=3',document.body||document.head);if(s)s.addEventListener('load',loadPainelRetangular,{once:true});else loadPainelRetangular()}
  function loadProductionV2(){
    if(document.getElementById('productionV2Script'))return;
    var s=loadScript('productionV2Script','/assets/production-v2.js?v=20260731',document.body||document.head);
    var next=function(){var c=loadScript('productionV2CompatScript','/assets/production-v2-compat.js?v=20260731-2',document.body||document.head);if(c)c.addEventListener('load',loadPainelRomano,{once:true});else loadPainelRomano()};
    if(s)s.addEventListener('load',next,{once:true});else next();
  }

  var CACHE_SCHEMA='catalog-index-v4-products';
  var META_KEY='catalog-meta-version';
  var rawVersion=localStorage.getItem(META_KEY)||'boot';
  var version=CACHE_SCHEMA+'-'+rawVersion;
  var metaPromise=null;
  function isDriveCacheKey(key){return String(key||'').indexOf('drive-cache:')===0}
  function baseKey(key){return String(key||'').replace(/^drive-cache:v[^:]+:/,'drive-cache:')}
  function versionedKey(key){return 'drive-cache:v'+version+':'+baseKey(key)}
  function purgeOldCaches(currentVersion){try{Object.keys(localStorage).forEach(function(key){if(!isDriveCacheKey(key))return;if(key.indexOf('drive-cache:v'+currentVersion+':')===0)return;localStorage.removeItem(key)})}catch(_){}}
  function loadMeta(){
    if(metaPromise)return metaPromise;
    metaPromise=fetch('/api/catalog-meta?_ts='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-store'}}).then(function(r){return r.json()}).then(function(meta){var nextRaw=String(meta.catalogVersion||meta.version||'1');var next=CACHE_SCHEMA+'-'+nextRaw;if(next!==version){version=next;localStorage.setItem(META_KEY,nextRaw)}purgeOldCaches(version);return meta}).catch(function(){purgeOldCaches(version);return{catalogVersion:version}});
    return metaPromise;
  }

  loadScript('catalogRuntimeSafeScript','/assets/catalog-runtime-safe.js?v=1');
  loadMeta();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadProductionV2,{once:true});else loadProductionV2();

  try{
    var originalGetItem=Storage.prototype.getItem;
    var originalSetItem=Storage.prototype.setItem;
    var originalRemoveItem=Storage.prototype.removeItem;
    Storage.prototype.getItem=function(key){if(this===localStorage&&isDriveCacheKey(key))return originalGetItem.call(this,versionedKey(key));return originalGetItem.apply(this,arguments)};
    Storage.prototype.setItem=function(key,value){if(this===localStorage&&isDriveCacheKey(key))return originalSetItem.call(this,versionedKey(key),value);return originalSetItem.apply(this,arguments)};
    Storage.prototype.removeItem=function(key){if(this===localStorage&&isDriveCacheKey(key)){originalRemoveItem.call(this,key);originalRemoveItem.call(this,versionedKey(key));return}return originalRemoveItem.apply(this,arguments)};
  }catch(_){}

  var originalFetch=window.fetch;
  window.fetch=function(input,init){
    try{
      var url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin);
      if(url.pathname==='/api/drive'||url.pathname==='/api/catalog-v2'||url.pathname==='/api/painel-romano'||url.pathname==='/api/painel-retangular'){
        url.searchParams.set('cv',version);
        init=Object.assign({},init||{},{cache:'no-store',headers:Object.assign({},init&&init.headers||{}, {'Cache-Control':'no-store'})});
        input=url.toString();
      }
    }catch(_){}
    return originalFetch.call(this,input,init);
  };
})();
