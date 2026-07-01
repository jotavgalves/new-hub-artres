(function(){
  if (window.__CATALOG_CACHE_BUST__) return;
  window.__CATALOG_CACHE_BUST__ = true;

  function isDriveCacheKey(key){ return String(key || '').indexOf('drive-cache:') === 0; }

  try {
    Object.keys(localStorage).forEach(function(key){
      if (isDriveCacheKey(key)) localStorage.removeItem(key);
    });
  } catch (_) {}

  try {
    var originalGetItem = Storage.prototype.getItem;
    var originalSetItem = Storage.prototype.setItem;
    var originalRemoveItem = Storage.prototype.removeItem;

    Storage.prototype.getItem = function(key){
      if (this === localStorage && isDriveCacheKey(key)) return null;
      return originalGetItem.apply(this, arguments);
    };

    Storage.prototype.setItem = function(key, value){
      if (this === localStorage && isDriveCacheKey(key)) return undefined;
      return originalSetItem.apply(this, arguments);
    };

    Storage.prototype.removeItem = function(key){
      return originalRemoveItem.apply(this, arguments);
    };
  } catch (_) {}

  var originalFetch = window.fetch;
  window.fetch = function(input, init){
    try {
      var url = typeof input === 'string' ? new URL(input, location.origin) : new URL(input.url, location.origin);
      if (url.pathname === '/api/drive') {
        url.searchParams.set('_ts', String(Date.now()));
        init = Object.assign({}, init || {}, { cache: 'no-store' });
        var headers = new Headers(init.headers || (input && input.headers) || {});
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        headers.set('Pragma', 'no-cache');
        init.headers = headers;
        input = url.toString();
      }
    } catch (_) {}
    return originalFetch.call(this, input, init);
  };
})();
