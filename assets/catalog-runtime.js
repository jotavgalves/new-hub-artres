(function(){
  if(window.__ARMAZEM_CATALOG_RUNTIME__) return;
  window.__ARMAZEM_CATALOG_RUNTIME__ = true;
  var memory = new Map();
  var rules = { hiddenArtCodes:[], hiddenThemeKeys:[], hiddenProducts:[], rulesHash:'' };
  var rulesPromise = null;
  function norm(v){ return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim(); }
  function code(v){ return String(v || '').replace(/\D/g,''); }
  function key(params){ return new URLSearchParams(params || {}).toString(); }
  function escSel(v){ return (window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g,'\\$&'); }
  function currentThemeName(){ try { return typeof fullThemeName === 'function' ? fullThemeName() : ((selectedTheme && selectedTheme.name) || ''); } catch(e) { return ''; } }
  function itemSource(id){ return (Array.isArray(items) && items.find(function(x){return x.id===id;})) || (Array.isArray(cart) && cart.find(function(x){return x.id===id;})) || (favItems && favItems[id]) || null; }
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
      .then(function(data){ var changed = rules.rulesHash && data.rulesHash && data.rulesHash !== rules.rulesHash; rules = data || rules; if(apply !== false && changed) applyRules(); return rules; })
      .catch(function(){ return rules; })
      .finally(function(){ rulesPromise = null; });
    return rulesPromise;
  }
  function removeBlockedCards(){
    document.querySelectorAll('[data-card]').forEach(function(card){ var item = itemSource(card.getAttribute('data-card')); if(isBlocked(item)) card.remove(); });
  }
  function applyRules(){
    var changed = false;
    if(Array.isArray(cart)){
      var before = cart.length;
      cart = cart.filter(function(i){ return !isBlocked(i); });
      changed = before !== cart.length;
    }
    removeBlockedCards();
    if(changed){ try{ save(); renderCart(); toast('Uma arte foi removida porque não está mais disponível no catálogo.'); }catch(e){} }
  }
  function bindCard(card){
    card.querySelectorAll('[data-select]').forEach(function(b){ b.onclick = function(){ addItem(b.dataset.select); }; });
    card.querySelectorAll('[data-remove]').forEach(function(b){ b.onclick = function(){ changeQty(b.dataset.remove, -1); }; });
    card.querySelectorAll('[data-fav]').forEach(function(b){ b.onclick = function(e){ e.stopPropagation(); toggleFav(b.dataset.fav); }; });
  }
  function updateCard(id){
    var card = document.querySelector('[data-card="' + escSel(id) + '"]');
    if(!card) return;
    var item = itemSource(id);
    if(isBlocked(item)){ card.remove(); return; }
    var e = entry(id);
    var fav = favs && favs.has && favs.has(id);
    card.classList.toggle('sel', !!e);
    var badge = card.querySelector('.badge'); if(badge) badge.textContent = e ? ('Selecionada ' + e.qty + 'x') : 'Toque para ver melhor';
    var favBtn = card.querySelector('[data-fav]'); if(favBtn){ favBtn.classList.toggle('active', !!fav); favBtn.textContent = fav ? '♥' : '♡'; }
    var info = card.querySelector('.info'); if(!info) return;
    var note = info.querySelector('.inCartNote');
    var actions = info.querySelector('.cardActions') || document.createElement('div');
    if(!actions.parentElement) info.appendChild(actions);
    var safeId = String(id).replace(/"/g,'&quot;');
    if(e){
      if(!note){ note = document.createElement('span'); note.className = 'inCartNote'; info.insertBefore(note, actions); }
      note.textContent = 'No carrinho: ' + e.qty + ' unidade(s)';
      actions.className = 'cardActions two';
      actions.innerHTML = '<button class="selBtn" data-select="'+safeId+'">Adicionar 1 unidade</button><button class="removeBtn" data-remove="'+safeId+'">Tirar 1 unidade</button>';
    }else{
      if(note) note.remove();
      actions.className = 'cardActions';
      actions.innerHTML = '<button class="selBtn" data-select="'+safeId+'">Adicionar arte</button>';
    }
    bindCard(card);
  }
  function updateAllCards(){ document.querySelectorAll('[data-card]').forEach(function(c){ updateCard(c.getAttribute('data-card')); }); }
  function wrapActions(){
    if(typeof addItem === 'function' && !addItem.__fast){
      addItem = async function(id){
        await refreshRules(false);
        var it = itemSource(id); if(!it) return;
        if(isBlocked(it)){ applyRules(); try{ toast('Essa arte não está mais disponível no catálogo.'); }catch(e){} return; }
        var e = entry(id);
        if(e) e.qty += 1;
        else{ var ni = Object.assign({}, it, { qty: it.product === 'sacolinha' ? 10 : 1, details: Object.assign({}, it.details || {}) }); if(typeof ensureDetails === 'function') ensureDetails(ni); cart.push(ni); }
        save(); try{ toast(e ? 'Prontinho, adicionamos mais 1 unidade dessa arte.' : 'Prontinho, essa arte entrou no seu pedido.'); }catch(e){}
        updateCard(id); renderCart();
      };
      addItem.__fast = true;
    }
    if(typeof changeQty === 'function' && !changeQty.__fast){
      changeQty = function(id, delta){ var e = entry(id); if(!e) return; e.qty += delta; if(e.qty <= 0) cart = cart.filter(function(c){ return c.id !== id; }); save(); updateCard(id); renderCart(); };
      changeQty.__fast = true;
    }
    if(typeof toggleFav === 'function' && !toggleFav.__fast){
      toggleFav = function(id){ var item = itemSource(id); if(favs.has(id)){ favs.delete(id); delete favItems[id]; try{ toast('Removida das favoritas.'); }catch(e){} } else { favs.add(id); if(item) favItems[id] = Object.assign({}, item, { details:Object.assign({}, item.details || {}) }); try{ toast('Guardamos essa arte nas favoritas.'); }catch(e){} } save(); updateCard(id); };
      toggleFav.__fast = true;
    }
    if(typeof addFavorites === 'function' && !addFavorites.__fast){
      addFavorites = async function(){ await refreshRules(false); var fs = Object.values(favItems || {}).filter(function(i){ return favs.has(i.id) && !isBlocked(i); }); if(!fs.length){ try{ toast('Você ainda não marcou favoritas disponíveis.'); }catch(e){} return; } fs.forEach(function(i){ var e=entry(i.id); if(e)e.qty+=1; else{ var ni=Object.assign({}, i, {qty:i.product==='sacolinha'?10:1, details:Object.assign({}, i.details||{})}); if(typeof ensureDetails==='function') ensureDetails(ni); cart.push(ni); } }); save(); updateAllCards(); renderCart(); try{ toast('Prontinho, suas favoritas entraram no pedido.'); }catch(e){} };
      addFavorites.__fast = true;
    }
  }
  function wrapCache(){
    if(typeof api === 'function' && !api.__memory){
      var oldApi = api;
      api = function(params, opts){ var k = key(params); if((!opts || opts.useCache !== false) && memory.has(k)) return Promise.resolve(memory.get(k)); return oldApi(params, opts).then(function(d){ memory.set(k,d); return d; }); };
      api.__memory = true;
    }
    if(typeof loadItems === 'function' && !loadItems.__memory){
      var oldLoadItems = loadItems;
      loadItems = async function(product){
        var params = { mode:'items', folderId:product.id, theme:currentThemeName() || (selectedTheme && selectedTheme.name) || '', product:product.rawName || product.name || product.productName };
        var k = key(params);
        if(memory.has(k)){
          selectedProduct = product; view = 'items'; showFavs = false; document.getElementById('search').value = '';
          var d = memory.get(k); items = d.items || [];
          items.forEach(function(i){ if(!i.themeId && selectedTheme) i.themeId = selectedTheme.id; if(product.product === 'sacolinha' && product.bagSize){ i.details = Object.assign({}, i.details || {}, {size:product.bagSize}); i.productName = 'Sacolinha ' + product.bagSize; } });
          try{ rememberPlace(); }catch(e){} renderItems(); applyRules(); return;
        }
        return oldLoadItems(product).then(function(){ memory.set(k, {items:items || []}); applyRules(); });
      };
      loadItems.__memory = true;
    }
    if(typeof loadProducts === 'function' && !loadProducts.__memory){
      var oldLoadProducts = loadProducts;
      loadProducts = async function(folder, navMode){
        var theme = navMode === 'root' ? (folder && folder.name || '') : (currentThemeName() || (folder && folder.name) || '');
        var params = { mode:'products', folderId:folder && folder.id, theme:theme };
        var k = key(params);
        if(memory.has(k)){
          if(navMode === 'root'){ selectedTheme=folder; folderTrail=[]; currentFolder=folder; }
          else if(navMode === 'push'){ folderTrail.push(folder); currentFolder=folder; }
          else if(navMode === 'keep'){ currentFolder=folder; }
          view='products'; selectedProduct=null; document.getElementById('search').value=''; products = memory.get(k).folders || [];
          try{ rememberPlace(); }catch(e){} showProducts(); return;
        }
        return oldLoadProducts(folder, navMode).then(function(){ memory.set(k, {folders:products || []}); });
      };
      loadProducts.__memory = true;
    }
  }
  function boot(){ wrapActions(); wrapCache(); refreshRules(false).then(applyRules); }
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('load', boot);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden) refreshRules(true); });
  setInterval(function(){ refreshRules(true); }, 15000);
  boot();
})();
