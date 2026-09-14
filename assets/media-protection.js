(function(){
  'use strict';
  if(window.__ARMAZEM_MEDIA_PROTECTION__==='2')return;
  window.__ARMAZEM_MEDIA_PROTECTION__='2';

  var protectedPaths=new Set(['/api/drive','/api/catalog-v2','/api/painel-romano','/api/painel-retangular','/api/reconcile-cart']);
  var tokenCache=new Map();
  var originalFetch=window.fetch.bind(window);

  function clean(v){return String(v==null?'':v).trim()}
  function driveId(value){
    var raw=clean(value);if(!raw)return'';
    if(/^[A-Za-z0-9_-]{20,128}$/.test(raw))return raw;
    try{var u=new URL(raw,location.origin);var q=u.searchParams.get('id');if(q&&/^[A-Za-z0-9_-]{20,128}$/.test(q))return q;var m=u.pathname.match(/\/d\/([A-Za-z0-9_-]{20,128})/);if(m)return m[1]}catch(_){}
    var f=raw.match(/(?:id=|\/d\/)([A-Za-z0-9_-]{20,128})/);return f?f[1]:'';
  }
  function isProtectedUrl(v){return /\/api\/media\?t=/.test(clean(v))}

  function collect(value,refs,ids){
    if(Array.isArray(value)){value.forEach(function(v){collect(v,refs,ids)});return}
    if(!value||typeof value!=='object')return;
    var source=clean(value.image||value.thumbnail||value.thumbnail_url||'');
    var id=driveId(value.driveFileId||'')||driveId(source)||(source?driveId(value.id||''):'');
    if(source&&!isProtectedUrl(source)&&id){refs.push({value:value,id:id});ids.add(id)}
    Object.keys(value).forEach(function(k){var child=value[k];if(child&&typeof child==='object')collect(child,refs,ids)});
  }

  async function batchUrls(ids){
    var missing=ids.filter(function(id){return !tokenCache.has(id)});
    for(var i=0;i<missing.length;i+=120){
      var chunk=missing.slice(i,i+120);
      try{
        var r=await originalFetch('/api/image-token-batch',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({ids:chunk})});
        var d=await r.json().catch(function(){return{}});var urls=d&&d.ok===true&&d.urls?d.urls:{};
        chunk.forEach(function(id){if(urls[id])tokenCache.set(id,String(urls[id]))});
      }catch(_){}
    }
    var out={};ids.forEach(function(id){if(tokenCache.has(id))out[id]=tokenCache.get(id)});return out;
  }

  async function protectPayload(data){
    var refs=[];var ids=new Set();collect(data,refs,ids);if(!ids.size)return data;
    var urls=await batchUrls(Array.from(ids));
    refs.forEach(function(ref){var url=urls[ref.id];if(!url)return;var value=ref.value;if('image' in value)value.image=url;if('thumbnail' in value)value.thumbnail=url;if('thumbnail_url' in value)value.thumbnail_url=url;try{delete value.driveUrl;delete value.drive_url}catch(_){}});
    return data;
  }

  window.fetch=async function(input,init){
    var response=await originalFetch(input,init);
    try{
      var url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin);
      if(!protectedPaths.has(url.pathname))return response;
      var type=clean(response.headers.get('content-type'));if(type.indexOf('application/json')<0)return response;
      var data=await response.clone().json();await protectPayload(data);
      var headers=new Headers(response.headers);headers.delete('content-length');headers.set('content-type','application/json; charset=utf-8');headers.set('cache-control','no-store, max-age=0');
      return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:headers});
    }catch(_){return response}
  };

  var pendingImgs=new Map();var pendingTimer=0;
  function queueImg(img){
    if(!img||img.tagName!=='IMG')return;img.draggable=false;img.setAttribute('draggable','false');
    var src=clean(img.getAttribute('src')||img.currentSrc||'');if(!src||isProtectedUrl(src)||src.indexOf('drive.google.com')<0)return;var id=driveId(src);if(!id)return;
    if(tokenCache.has(id)){img.src=tokenCache.get(id);return}
    if(!pendingImgs.has(id))pendingImgs.set(id,[]);pendingImgs.get(id).push(img);
    clearTimeout(pendingTimer);pendingTimer=setTimeout(flushImgs,25);
  }
  async function flushImgs(){
    var ids=Array.from(pendingImgs.keys());if(!ids.length)return;var groups=new Map(pendingImgs);pendingImgs.clear();var urls=await batchUrls(ids);
    groups.forEach(function(imgs,id){var url=urls[id];if(!url)return;imgs.forEach(function(img){if(img&&img.isConnected)img.src=url})});
  }
  function scan(root){var scope=root&&root.querySelectorAll?root:document;if(scope.tagName==='IMG')queueImg(scope);scope.querySelectorAll('img').forEach(queueImg)}
  function injectStyle(){if(document.getElementById('mediaProtectionStyle'))return;var s=document.createElement('style');s.id='mediaProtectionStyle';s.textContent='img{-webkit-user-drag:none!important;-webkit-touch-callout:none!important;user-select:none!important;-webkit-user-select:none!important}';document.head.appendChild(s)}
  function block(e){e.preventDefault();e.stopPropagation();return false}
  document.addEventListener('contextmenu',block,true);
  document.addEventListener('dragstart',function(e){if(e.target&&e.target.closest&&e.target.closest('img'))block(e)},true);
  document.addEventListener('auxclick',function(e){if(e.target&&e.target.closest&&e.target.closest('img'))block(e)},true);
  document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&String(e.key||'').toLowerCase()==='s')block(e)},true);

  function boot(){injectStyle();scan(document);new MutationObserver(function(records){records.forEach(function(record){record.addedNodes.forEach(function(node){if(node&&node.nodeType===1)scan(node)})})}).observe(document.documentElement,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
