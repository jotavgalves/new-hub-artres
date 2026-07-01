(function(){
  if (window.__CATALOG_CACHE_BUST__) return;
  window.__CATALOG_CACHE_BUST__ = true;
  var originalFetch = window.fetch;
  window.fetch = function(input, init){
    try {
      var url = typeof input === 'string' ? new URL(input, location.origin) : new URL(input.url, location.origin);
      if (url.pathname === '/api/drive' || url.pathname.startsWith('/api/drive?')) {
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
