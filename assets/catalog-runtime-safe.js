(function(){
  if(window.__ARMAZEM_CATALOG_RUNTIME_SAFE__) return;
  window.__ARMAZEM_CATALOG_RUNTIME_SAFE__ = true;
  window.__ARMAZEM_CATALOG_RUNTIME__ = true;

  var rules = { hiddenArtCodes:[], hiddenThemeKeys:[], hiddenProducts:[], rulesHash:'' };
  var rulesPromise = null;

  function norm(v){ return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim(); }
  function code(v){ return String(v || '').replace(/\D/g,''); }
  function escSel(v){ return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); }
  function itemSource(id){
    try { if(Array.isArray(items)){ var a = items.find(function(x){return x.id===id;}); if(a) return a; } } catch(e){}
    try { if(Array.isArray(cart)){ var b = cart.find(function(x){return x.id===id;}); if(b) return b; } } catch(e){}
    try { if(favItems && favItems[id]) return favItems[id]; } catch(e){}
    return null;
  }
  function isBlocked(item){
    if(!item) return false;
    var c = code(item.code);
    if(c && (rules.hiddenArtCodes || []).map(code).indexOf(c) > -1) return true;
    var t = norm(item.theme || item.embeddedTheme || '');
    if(t && (rules.hiddenThemeKeys || []).indexOf(t) > -1) return true;
    var p = norm(item.product || item.productKey || item.productName || '');
    if(p && (rules.hiddenProducts || []).map(norm).indexOf(p) > -1) return true;
    return false;
  }
  function refreshRules(apply){
    if(rulesPromise) return rulesPromise;
    rulesPromise = fetch('/api/catalog-rules?_ts=' + Date.now(), { cache:'no-store', headers:{ 'Cache-Control':'no-store' } })
      .then(function(r){ return r.json(); })
      .then(function(data){
        var changed = rules.rulesHash && data.rulesHash && data.rulesHash !== rules.rulesHash;
        rules = data || rules;
        if(apply !== false && changed) applyRules();
        return rules;
      })
      .catch(function(){ return rules; })
      .finally(function(){ rulesPromise = null; });
    return rulesPromise;
  }
  function updateCard(id){
    var card = document.querySelector('[data-card="' + escSel(id) + '"]');
    if(!card) return;
    var item = itemSource(id);
    if(isBlocked(item)){ card.remove(); return; }
    var e = null;
    try { e = entry(id); } catch(_) {}
    var fav = false;
    try { fav = favs && favs.has && favs.has(id); } catch(_) {}
    card.classList.toggle('sel', !!e);
    var badge = card.querySelector('.badge');
    if(badge) badge.textContent = e ? ('Selecionada ' + e.qty + 'x') : 'Toque para ver melhor';
    var favBtn = card.querySelector('[data-fav]');
    if(favBtn){ favBtn.classList.toggle('active', !!fav); favBtn.textContent = fav ? '♥' : '♡'; }
  }
  function applyRules(){
    var changed = false;
    try {
      if(Array.isArray(cart)){
        var before = cart.length;
        cart = cart.filter(function(i){ return !isBlocked(i); });
        changed = before !== cart.length;
      }
    } catch(e){}
    document.querySelectorAll('[data-card]').forEach(function(card){
      var item = itemSource(card.getAttribute('data-card'));
      if(isBlocked(item)) card.remove();
    });
    if(changed){ try{ save(); renderCart(); toast('Uma arte foi removida porque não está mais disponível no catálogo.'); }catch(e){} }
  }
  function wrapActions(){
    try {
      if(typeof addItem === 'function' && !addItem.__safeRuntime){
        var originalAddItem = addItem;
        addItem = async function(id){ await refreshRules(false); var it = itemSource(id); if(isBlocked(it)){ applyRules(); try{ toast('Essa arte não está mais disponível no catálogo.'); }catch(e){} return; } var result = await originalAddItem(id); updateCard(id); return result; };
        addItem.__safeRuntime = true;
      }
    } catch(e){}
  }
  function boot(){ wrapActions(); refreshRules(false).then(applyRules); }
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('load', boot);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) refreshRules(true); });
  setInterval(function(){ refreshRules(true); }, 15000);
  boot();
})();