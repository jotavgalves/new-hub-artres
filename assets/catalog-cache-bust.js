(function(){
  if (window.__CATALOG_VERSIONED_CACHE__) return;
  window.__CATALOG_VERSIONED_CACHE__ = true;

  function loadScript(id, src, parent){
    if (document.getElementById(id)) return null;
    var script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = false;
    (parent || document.head).appendChild(script);
    return script;
  }

  function loadCheckoutUi(){
    loadScript('checkoutV3UiScript','/assets/checkout-v3-ui.js?v=20260804-1',document.body || document.head);
  }

  function loadCheckoutRecovery(){
    var script = loadScript('checkoutV3RecoveryScript','/assets/checkout-v3-recovery.js?v=20260804-1',document.body || document.head);
    if (script) script.addEventListener('load',loadCheckoutUi,{once:true});
    else loadCheckoutUi();
  }

  function loadCheckoutV3(){
    var script = loadScript('checkoutV3Script','/assets/checkout-v3.js?v=20260804-1',document.body || document.head);
    if (script) script.addEventListener('load',loadCheckoutRecovery,{once:true});
    else loadCheckoutRecovery();
  }

  function loadProductionV2(){
    if (document.getElementById('productionV2Script')) return;
    var script = loadScript('productionV2Script','/assets/production-v2.js?v=20260731',document.body || document.head);
    if (script) script.addEventListener('load',function(){
      var compat = loadScript('productionV2CompatScript','/assets/production-v2-compat.js?v=20260731-2',document.body || document.head);
      if (compat) compat.addEventListener('load',loadCheckoutV3,{once:true});
      else loadCheckoutV3();
    },{once:true});
  }

  var CACHE_SCHEMA = 'catalog-index-v3-products';
  var META_KEY = 'catalog-meta-version';
  var rawVersion = localStorage.getItem(META_KEY) || 'boot';
  var version = CACHE_SCHEMA + '-' + rawVersion;
  var metaPromise = null;

  function isDriveCacheKey(key){ return String(key || '').indexOf('drive-cache:') === 0; }
  function baseKey(key){ return String(key || '').replace(/^drive-cache:v[^:]+:/, 'drive-cache:'); }
  function versionedKey(key){
    var raw = baseKey(key);
    return 'drive-cache:v' + version + ':' + raw;
  }
  function purgeOldCaches(currentVersion){
    try {
      Object.keys(localStorage).forEach(function(key){
        if (!isDriveCacheKey(key)) return;
        if (key.indexOf('drive-cache:v' + currentVersion + ':') === 0) return;
        localStorage.removeItem(key);
      });
    } catch (_) {}
  }
  async function loadMeta(){
    if (metaPromise) return metaPromise;
    metaPromise = fetch('/api/catalog-meta?_ts=' + Date.now(), { cache:'no-store', headers:{ 'Cache-Control':'no-store' } })
      .then(function(r){ return r.json(); })
      .then(function(meta){
        var nextRaw = String(meta.catalogVersion || meta.version || '1');
        var next = CACHE_SCHEMA + '-' + nextRaw;
        if (next !== version) {
          version = next;
          localStorage.setItem(META_KEY, nextRaw);
          purgeOldCaches(version);
        } else {
          purgeOldCaches(version);
        }
        return meta;
      })
      .catch(function(){ purgeOldCaches(version); return { catalogVersion: version }; });
    return metaPromise;
  }

  loadScript('catalogRuntimeSafeScript','/assets/catalog-runtime-safe.js?v=1');
  loadMeta();
  if (document.readyState === 'complete') loadProductionV2();
  else window.addEventListener('load', loadProductionV2, { once:true });

  try {
    var originalGetItem = Storage.prototype.getItem;
    var originalSetItem = Storage.prototype.setItem;
    var originalRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.getItem = function(key){
      if (this === localStorage && isDriveCacheKey(key)) {
        var direct = originalGetItem.call(this, versionedKey(key));
        if (direct) return direct;
        return null;
      }
      return originalGetItem.apply(this, arguments);
    };

    Storage.prototype.setItem = function(key, value){
      if (this === localStorage && isDriveCacheKey(key)) {
        return originalSetItem.call(this, versionedKey(key), value);
      }
      return originalSetItem.apply(this, arguments);
    };

    Storage.prototype.removeItem = function(key){
      if (this === localStorage && isDriveCacheKey(key)) {
        originalRemoveItem.call(this, key);
        originalRemoveItem.call(this, versionedKey(key));
        return undefined;
      }
      return originalRemoveItem.apply(this, arguments);
    };
  } catch (_) {}

  var originalFetch = window.fetch;
  window.fetch = function(input, init){
    try {
      var url = typeof input === 'string' ? new URL(input, location.origin) : new URL(input.url, location.origin);
      if (url.pathname === '/api/drive' || url.pathname === '/api/catalog-v2') {
        url.searchParams.set('cv', version);
        init = Object.assign({}, init || {}, { cache: 'default' });
        input = url.toString();
      }
    } catch (_) {}
    return originalFetch.call(this, input, init);
  };
})();