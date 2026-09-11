(function(){
  'use strict';
  if(window.__ARMAZEM_MEDIA_PROTECTION__==='1')return;
  window.__ARMAZEM_MEDIA_PROTECTION__='1';

  var protectedPaths=new Set(['/api/drive','/api/catalog-v2','/api/painel-romano','/api/painel-retangular','/api/reconcile-cart']);
  var tokenCache=new Map();
  var originalFetch=window.fetch.bind(window);

  function clean(v){return String(v==null?'':v).trim()}
  function driveId(value){
    var raw=clean(value);if(!raw)return'';
    if(/^[A-Za-z0-9_-]{20,128}$/.test(raw))return raw;
    try{
      var u=new URL(raw,location.origin);
      var q=u.searchParams.get('id');if(q&&/^[A-Za-z0-9_-]{20,128}$/.test(q))return q;
      var m=u.pathname.match(/\/d\/([A-Za-z0-9_-]{20,128})/);if(m)return m[1];
    }catch(_){}
    var f=raw.match(/(?:id=|\/d\/)([A-Za-z0-9_-]{20,128})/);return f?f[1]:'';
  }
  function isProtectedUrl(v){return /^\/api\/media\?t=/.test(clean(v))||/\/api\/media\?t=/.test(clean(v))}

  async function tokenUrl(id,source){
    var key=clean(id)||clean(source);if(!key)return'';
    if(tokenCache.has(key))return tokenCache.get(key);
    var promise=originalFetch('/api/image-token',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({fileId:id||'',source:source||''})})
      .then(function(r){return r.json().then(function(d){if(!r.ok||!d||d.ok!==true||!d.url)throw new Error('token');return String(d.url)})})
      .catch(function(){tokenCache.delete(key);return''});
    tokenCache.set(key,promise);return promise;
  }

  async function protectObject(value){
    if(Array.isArray(value)){await Promise.all(value.map(protectObject));return value}
    if(!value||typeof value!=='object')return value;
    var source=clean(value.image||value.thumbnail||value.thumbnail_url||'');
    var id=driveId(value.driveFileId||'')||driveId(source)||(source?driveId(value.id||''):'');
    if(source&&!isProtectedUrl(source)&&id){
      var protectedUrl=await tokenUrl(id,source);
      if(protectedUrl){
        if('image' in value)value.image=protectedUrl;
        if('thumbnail' in value)value.thumbnail=protectedUrl;
        if('thumbnail_url' in value)value.thumbnail_url=protectedUrl;
        try{delete value.driveUrl;delete value.drive_url}catch(_){}
      }
    }
    var keys=Object.keys(value);
    for(var i=0;i<keys.length;i++){
      var child=value[keys[i]];
      if(child&&typeof child==='object')await protectObject(child);
    }
    return value;
  }

  window.fetch=async function(input,init){
    var response=await originalFetch(input,init);
    try{
      var url=typeof input==='string'?new URL(input,location.origin):new URL(input.url,location.origin);
      if(!protectedPaths.has(url.pathname))return response;
      var type=clean(response.headers.get('content-type'));
      if(type.indexOf('application/json')<0)return response;
      var data=await response.clone().json();
      await protectObject(data);
      var headers=new Headers(response.headers);headers.delete('content-length');headers.set('content-type','application/json; charset=utf-8');headers.set('cache-control','no-store, max-age=0');
      return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers:headers});
    }catch(_){return response}
  };

  function protectImg(img){
    if(!img||img.nodeType!==1||img.tagName!=='IMG')return;
    img.draggable=false;
    img.setAttribute('draggable','false');
    var src=clean(img.currentSrc||img.getAttribute('src')||'');
    if(!src||isProtectedUrl(src)||src.indexOf('drive.google.com')<0)return;
    var id=driveId(src);if(!id)return;
    tokenUrl(id,src).then(function(url){if(url&&img.isConnected)img.src=url});
  }

  function scan(root){
    var scope=root&&root.querySelectorAll?root:document;
    if(scope.tagName==='IMG')protectImg(scope);
    scope.querySelectorAll('img').forEach(protectImg);
  }

  function injectStyle(){
    if(document.getElementById('mediaProtectionStyle'))return;
    var s=document.createElement('style');s.id='mediaProtectionStyle';s.textContent='img{-webkit-user-drag:none!important;-webkit-touch-callout:none!important;user-select:none!important;-webkit-user-select:none!important}';document.head.appendChild(s);
  }

  function block(e){e.preventDefault();e.stopPropagation();return false}
  document.addEventListener('contextmenu',block,true);
  document.addEventListener('dragstart',function(e){if(e.target&&e.target.closest&&e.target.closest('img'))block(e)},true);
  document.addEventListener('auxclick',function(e){if(e.target&&e.target.closest&&e.target.closest('img'))block(e)},true);
  document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&String(e.key||'').toLowerCase()==='s')block(e)},true);

  function boot(){
    injectStyle();scan(document);
    new MutationObserver(function(records){records.forEach(function(record){record.addedNodes.forEach(function(node){if(node&&node.nodeType===1)scan(node)})})}).observe(document.documentElement,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
