(function(){
  if (window.__CATALOG_VERSIONED_CACHE__) return;
  window.__CATALOG_VERSIONED_CACHE__ = true;

  function loadScript(id, src){
    if (document.getElementById(id)) return;
    var script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  var CACHE_SCHEMA = 'catalog-index-v2-bolinhas';
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
      if (url.pathname === '/api/drive') {
        url.searchParams.set('cv', version);
        init = Object.assign({}, init || {}, { cache: 'default' });
        input = url.toString();
      }
    } catch (_) {}
    return originalFetch.call(this, input, init);
  };
})();