(function(){
  if (window.__ARMAZEM_PAINEL_ROMANO_RUNTIME__) return;
  window.__ARMAZEM_PAINEL_ROMANO_RUNTIME__ = '1';

  var KEY = 'painel-romano';
  var ROOT = '15f6Ge0jZCHSIWMhmEUOs4bfXy9y5U3wk';
  var state = {
    label: 'Painel Romano 1x2',
    enabled: false,
    unitPrice: 0,
    minimum: 1,
    step: 1,
    initial: 1
  };

  function clean(v){ return String(v == null ? '' : v).replace(/\s+/g,' ').trim(); }
  function norm(v){ return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim(); }
  function moneyBR(v){ return Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}); }
  function isRoman(item){ return !!item && String(item.product || item.productKey || '') === KEY; }
  function romanProduct(theme){
    theme = theme || (typeof selectedTheme !== 'undefined' ? selectedTheme : null) || {id:'',name:'Tema'};
    return {
      id: 'painel-romano-product:' + String(theme.id || norm(theme.name || 'tema')),
      name: state.label,
      rawName: state.label,
      label: state.label,
      productName: state.label,
      product: KEY,
      productKey: KEY,
      kind: 'product',
      rootFolderId: ROOT,
      size: '1X2',
      sizeKey: '100x200'
    };
  }
  function request(params){
    var q = new URLSearchParams(params || {});
    q.set('_', String(Date.now()));
    return fetch('/api/painel-romano?' + q.toString(), {cache:'no-store'}).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(d){
        if (!r.ok || d.ok === false) throw new Error(d.detail || d.error || 'Falha ao carregar Painel Romano.');
        return d;
      });
    });
  }
  function injectStyle(){
    if (document.getElementById('painelRomanoRuntimeStyle')) return;
    var s = document.createElement('style');
    s.id = 'painelRomanoRuntimeStyle';
    s.textContent = '.fixedMeasureBadge{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border-radius:999px;background:#eefaff;border:1px solid #cfeefa;color:#117696;font-size:10.5px;font-weight:900;white-space:nowrap}.romanFixedMeasure{background:#f7fbfd!important;border-color:#d9f1fa!important;color:#117696!important}';
    document.head.appendChild(s);
  }

  function installCoreHooks(){
    try {
      if (typeof PRODUCT_CONFIG !== 'undefined') {
        PRODUCT_CONFIG[KEY] = {
          label: state.label,
          type: 'fixedRectangle',
          unitPrice: state.unitPrice,
          fixedWidth: 100,
          fixedHeight: 200,
          fixedSize: '1X2',
          sizeKey: '100x200'
        };
      }
    } catch(e) {}

    if (typeof productConfig === 'function' && !productConfig.__romanWrapped) {
      var oldProductConfig = productConfig;
      productConfig = function(product){
        if (product === KEY) return {
          label: state.label,
          type: 'fixedRectangle',
          unitPrice: state.unitPrice,
          fixedWidth: 100,
          fixedHeight: 200,
          fixedSize: '1X2',
          sizeKey: '100x200'
        };
        return oldProductConfig(product);
      };
      productConfig.__romanWrapped = true;
    }

    if (typeof label === 'function' && !label.__romanWrapped) {
      var oldLabel = label;
      label = function(key){ return key === KEY ? state.label : oldLabel(key); };
      label.__romanWrapped = true;
    }

    if (typeof price === 'function' && !price.__romanWrapped) {
      var oldPrice = price;
      price = function(product, qty, item){
        if (product === KEY) return Math.max(0, Number(qty || 0)) * Math.max(0, Number(state.unitPrice || 0));
        return oldPrice(product, qty, item);
      };
      price.__romanWrapped = true;
    }

    if (typeof priceTextFor === 'function' && !priceTextFor.__romanWrapped) {
      var oldPriceTextFor = priceTextFor;
      priceTextFor = function(p){
        var key = p && (p.product || p.productKey || p.key);
        if (key === KEY) return state.unitPrice > 0 ? moneyBR(state.unitPrice) + ' cada' : 'Preço em configuração';
        return oldPriceTextFor(p);
      };
      priceTextFor.__romanWrapped = true;
    }

    if (typeof artPriceText === 'function' && !artPriceText.__romanWrapped) {
      var oldArtPriceText = artPriceText;
      artPriceText = function(item){
        if (isRoman(item)) return state.unitPrice > 0 ? moneyBR(state.unitPrice) : 'Preço em configuração';
        return oldArtPriceText(item);
      };
      artPriceText.__romanWrapped = true;
    }

    if (typeof itemActionButton === 'function' && !itemActionButton.__romanWrapped) {
      var oldItemActionButton = itemActionButton;
      itemActionButton = function(item){
        if (isRoman(item)) return '<span class="fixedMeasureBadge">Medida fixa 1×2 m</span>';
        return oldItemActionButton(item);
      };
      itemActionButton.__romanWrapped = true;
    }

    if (typeof measureFields === 'function' && !measureFields.__romanWrapped) {
      var oldMeasureFields = measureFields;
      measureFields = function(item){
        if (isRoman(item)) return '<div class="measureClosed"><div class="measureSummary clamp romanFixedMeasure">Medida fixa: 1,00 × 2,00 m</div></div>';
        return oldMeasureFields(item);
      };
      measureFields.__romanWrapped = true;
    }

    if (typeof detailsForWhatsApp === 'function' && !detailsForWhatsApp.__romanWrapped) {
      var oldDetailsForWhatsApp = detailsForWhatsApp;
      detailsForWhatsApp = function(item){
        if (isRoman(item)) return 'Medida: 1,00 x 2,00 m';
        return oldDetailsForWhatsApp(item);
      };
      detailsForWhatsApp.__romanWrapped = true;
    }

    if (typeof prefetchItemsForProducts === 'function' && !prefetchItemsForProducts.__romanWrapped) {
      var oldPrefetch = prefetchItemsForProducts;
      prefetchItemsForProducts = function(list){
        return oldPrefetch((list || []).filter(function(p){ return !isRoman(p); }));
      };
      prefetchItemsForProducts.__romanWrapped = true;
    }
  }

  function installNavigationHooks(){
    if (typeof loadThemes === 'function' && !loadThemes.__romanWrapped) {
      var oldLoadThemes = loadThemes;
      loadThemes = async function(){
        await oldLoadThemes();
        if (!state.enabled) return;
        try {
          var d = await request({mode:'themes'});
          var extras = Array.isArray(d.folders) ? d.folders : [];
          var existing = new Set((themes || []).map(function(t){ return norm(t && t.name); }));
          extras.forEach(function(t){
            var key = norm(t && t.name);
            if (key && !existing.has(key)) {
              themes.push(t);
              existing.add(key);
            }
          });
          themes.sort(function(a,b){ return String(a.name || '').localeCompare(String(b.name || ''),'pt-BR',{numeric:true}); });
          if (view === 'themes') showThemes();
        } catch(e) {}
      };
      loadThemes.__romanWrapped = true;
    }

    if (typeof loadProducts === 'function' && !loadProducts.__romanWrapped) {
      var oldLoadProducts = loadProducts;
      loadProducts = async function(folder, navMode){
        navMode = navMode || 'root';
        var romanOnlyTheme = folder && String(folder.id || '').indexOf('painel-romano-theme:') === 0;
        if (romanOnlyTheme) {
          selectedTheme = folder;
          folderTrail = [];
          currentFolder = folder;
          selectedProduct = null;
          view = 'products';
          if (typeof $ === 'function' && $('search')) $('search').value = '';
          if (typeof rememberPlace === 'function') rememberPlace();
          products = state.enabled ? [romanProduct(folder)] : [];
          showProducts();
          return;
        }

        await oldLoadProducts(folder, navMode);
        if (!state.enabled || view !== 'products' || !selectedTheme || (Array.isArray(folderTrail) && folderTrail.length)) return;
        if (!(products || []).some(function(p){ return isRoman(p); })) {
          products.push(romanProduct(selectedTheme));
          showProducts();
        }
      };
      loadProducts.__romanWrapped = true;
    }

    if (typeof loadItems === 'function' && !loadItems.__romanWrapped) {
      var oldLoadItems = loadItems;
      loadItems = async function(product){
        if (!isRoman(product)) return oldLoadItems(product);
        selectedProduct = product;
        view = 'items';
        showFavs = false;
        if (typeof $ === 'function' && $('search')) $('search').value = '';
        if (typeof updateHead === 'function') updateHead('Escolha suas artes','Painel Romano com medida fixa de 1,00 x 2,00 m. Escolha a arte e adicione ao pedido.','carregando');
        if (typeof loading === 'function') loading('Preparando os Painéis Romanos para você escolher...','arts');
        if (typeof rememberPlace === 'function') rememberPlace();
        try {
          var themeName = typeof fullThemeName === 'function' ? fullThemeName() : '';
          themeName = themeName || (selectedTheme && selectedTheme.name) || '';
          var d = await request({mode:'items',theme:themeName});
          items = Array.isArray(d.items) ? d.items : [];
          items.forEach(function(i){
            if (!i.themeId && selectedTheme) i.themeId = selectedTheme.id;
            i.product = KEY;
            i.productKey = KEY;
            i.productName = state.label;
            i.size = '1X2';
            i.sizeKey = '100x200';
            i.details = Object.assign({}, i.details || {}, {size:'1X2',sizeKey:'100x200',width:100,height:200,unit:'cm',fixed:true});
          });
          renderItems();
        } catch(e) {
          if (typeof errorScreen === 'function') errorScreen(e.message || 'Não foi possível carregar os Painéis Romanos.');
        }
      };
      loadItems.__romanWrapped = true;
    }

    if (typeof globalCodeSearch === 'function' && !globalCodeSearch.__romanWrapped) {
      var oldDemoSearch = typeof demoSearchByCode === 'function' ? demoSearchByCode : function(){ return []; };
      globalCodeSearch = async function(q){
        view = 'search';
        selectedProduct = null;
        showFavs = false;
        if (typeof updateHead === 'function') updateHead('Busca por código','Procurando a arte #' + q + ' em todos os produtos.','buscando');
        if (typeof loading === 'function') loading('Procurando essa arte para você...');
        var mainItems = [], romanItems = [];
        try {
          var main = await api({mode:'search',code:q});
          mainItems = Array.isArray(main.items) ? main.items : [];
        } catch(e) {}
        if (state.enabled) {
          try {
            var roman = await request({mode:'search',code:q});
            romanItems = Array.isArray(roman.items) ? roman.items : [];
          } catch(e) {}
        }
        var seen = new Set();
        items = mainItems.concat(romanItems).filter(function(i){
          var key = String(i.product || i.productKey || '') + '::' + String(i.id || i.driveFileId || i.code || '');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (!items.length && String(q).match(/\d/)) items = oldDemoSearch(q);
        renderItems();
      };
      globalCodeSearch.__romanWrapped = true;
    }

    if (typeof locateItem === 'function' && !locateItem.__romanWrapped) {
      var oldLocateItem = locateItem;
      locateItem = async function(id){
        var it = typeof entry === 'function' ? entry(id) : null;
        if (!isRoman(it)) return oldLocateItem(id);
        try {
          if (typeof $ === 'function') {
            if ($('drawerBg')) $('drawerBg').classList.remove('show');
            if ($('drawer')) $('drawer').classList.remove('show');
          }
          selectedTheme = {id:it.themeId || '', name:(it.theme || 'Tema').split(' / ')[0] || it.theme || 'Tema'};
          folderTrail = [];
          await loadItems({
            id:it.productFolderId || ('painel-romano-product:' + (it.themeId || norm(it.theme))),
            product:KEY,
            productKey:KEY,
            productName:state.label,
            name:state.label,
            rawName:state.label,
            kind:'product'
          });
          setTimeout(function(){
            var el = document.querySelector('[data-card="' + CSS.escape(id) + '"]');
            if (el) {
              el.scrollIntoView({behavior:'smooth',block:'center'});
              el.classList.add('located');
              setTimeout(function(){ el.classList.remove('located'); },1900);
            }
          },80);
        } catch(e) {
          if (typeof toast === 'function') toast('Não consegui voltar para esse Painel Romano agora.');
        }
      };
      locateItem.__romanWrapped = true;
    }
  }

  function applyCommercialConfig(data){
    var cfg = data && data.config || {};
    var p = cfg.products && cfg.products[KEY] || {};
    state.label = clean(p.label || state.label) || state.label;
    state.enabled = p.enabled === true;
    state.unitPrice = Math.max(0, Number(p.unitPrice || 0));
    if (p.quantity) {
      state.minimum = Math.max(1, Number(p.quantity.minimum || 1));
      state.step = Math.max(1, Number(p.quantity.step || 1));
      state.initial = Math.max(state.minimum, Number(p.quantity.initial || state.minimum));
    }
    installCoreHooks();
    installNavigationHooks();
    try {
      if (typeof PRODUCT_CONFIG !== 'undefined' && PRODUCT_CONFIG[KEY]) {
        PRODUCT_CONFIG[KEY].label = state.label;
        PRODUCT_CONFIG[KEY].unitPrice = state.unitPrice;
      }
    } catch(e) {}
    if (typeof renderCart === 'function') renderCart();
    if (state.enabled && typeof view !== 'undefined' && view === 'themes' && typeof loadThemes === 'function') loadThemes();
  }

  injectStyle();
  installCoreHooks();
  installNavigationHooks();
  fetch('/api/commercial-config?roman=' + Date.now(), {cache:'no-store'})
    .then(function(r){ return r.json(); })
    .then(applyCommercialConfig)
    .catch(function(){ installCoreHooks(); installNavigationHooks(); });
})();
