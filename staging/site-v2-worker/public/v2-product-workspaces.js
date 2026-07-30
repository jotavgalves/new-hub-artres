(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.SiteV2ProductWorkspaces = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const MARKER = 'site-v2-product-workspaces-v1';
  const SESSION_KEY = 'armazem:v2:workspace:session';
  const LEGACY_PLACE_KEY = 'armazem:lastPlace';
  const CATALOG_MODES = new Set(['themes', 'products', 'items', 'search', 'folderSearch']);
  const WORKSPACES = deepFreeze({
    bolinhas: {
      id: 'bolinhas',
      productKey: '50x50',
      label: 'Bolinhas',
      title: 'Bolinhas 50x50',
      description: 'Veja somente as artes disponíveis para bolinhas e monte o pedido no carrinho compartilhado.',
      icon: '●'
    },
    'painel-150': {
      id: 'painel-150',
      productKey: 'painel-150',
      label: 'Painel 150 cm',
      title: 'Painel redondo 150 cm',
      description: 'Veja somente as artes disponíveis para painel de 150 cm e continue usando o mesmo carrinho.',
      icon: '◯'
    }
  });
  const ALIASES = deepFreeze({
    bolinhas: 'bolinhas',
    bolinha: 'bolinhas',
    '50x50': 'bolinhas',
    painel: 'painel-150',
    'painel-150': 'painel-150',
    painel150: 'painel-150',
    'painel-150cm': 'painel-150'
  });

  let started = false;
  let activeWorkspaceId = '';
  let hooks = null;
  let observer = null;

  function start(input = {}) {
    if (started) return getState();
    hooks = validateHooks(input);
    started = true;

    const documentRef = root?.document;
    if (!documentRef) return getState();

    documentRef.documentElement.dataset.v2ProductWorkspaces = MARKER;
    installStyles(documentRef);
    installWorkspaceNavigation(documentRef);
    installRuntimeGuards();
    observeSharedCart(documentRef);

    const initial = resolveInitialWorkspace({
      search: root?.location?.search,
      sessionValue: safeSessionGet()
    });

    if (initial) {
      activate(initial.id, { reload: true, announce: false, focusCatalog: false });
    } else {
      renderInitialChooser(documentRef);
      refreshWorkspaceUi(documentRef);
    }

    return getState();
  }

  function activate(value, options = {}) {
    const workspace = resolveWorkspace(value);
    if (!workspace) throw workspaceError('WORKSPACE_INVALID');

    const changed = workspace.id !== activeWorkspaceId;
    activeWorkspaceId = workspace.id;
    safeSessionSet(workspace.id);
    updateProductQuery(workspace.id);

    const documentRef = root?.document;
    if (documentRef) {
      closeInitialChooser(documentRef);
      refreshWorkspaceUi(documentRef);
    }

    if (changed) clearCatalogPlaceOnly();
    hooks?.clearNavigation?.();

    if (options.reload !== false) reloadActiveCatalog(documentRef, options);

    if (changed && options.announce !== false) {
      hooks?.notify?.(`Agora você está vendo ${workspace.title}. O carrinho foi mantido.`);
    }

    dispatchWorkspaceChange(workspace, changed);
    return workspace;
  }

  function scopeCatalogParams(params = {}, workspaceValue = activeWorkspaceId) {
    const workspace = resolveWorkspace(workspaceValue);
    const next = { ...(params || {}) };
    const mode = clean(next.mode);
    if (workspace && CATALOG_MODES.has(mode)) next.product = workspace.productKey;
    return next;
  }

  function resolveWorkspace(value) {
    if (value && typeof value === 'object') {
      const byId = clean(value.id);
      const byKey = clean(value.productKey);
      return resolveWorkspace(byId || byKey);
    }
    const normalized = clean(value).toLowerCase();
    const id = ALIASES[normalized] || normalized;
    return WORKSPACES[id] || null;
  }

  function resolveInitialWorkspace(input = {}) {
    let queryValue = '';
    try {
      const params = new URLSearchParams(String(input.search || ''));
      queryValue = params.get('produto') || params.get('product') || '';
    } catch (_) {}
    return resolveWorkspace(queryValue) || resolveWorkspace(input.sessionValue);
  }

  function workspaceForProduct(value) {
    return resolveWorkspace(value);
  }

  function getState() {
    const active = resolveWorkspace(activeWorkspaceId);
    return Object.freeze({
      started,
      marker: MARKER,
      activeWorkspaceId: active?.id || '',
      productKey: active?.productKey || '',
      cartQuantity: currentCartQuantity(),
      workspaces: Object.values(WORKSPACES)
    });
  }

  function validateHooks(input) {
    for (const name of ['getApi', 'setApi', 'loadThemes']) {
      if (typeof input[name] !== 'function') throw workspaceError(`WORKSPACE_${name.replace(/[A-Z]/g, m => `_${m}`).toUpperCase()}_REQUIRED`);
    }
    return Object.freeze({
      getApi: input.getApi,
      setApi: input.setApi,
      loadThemes: input.loadThemes,
      getShowProducts: optionalFunction(input.getShowProducts),
      setShowProducts: optionalFunction(input.setShowProducts),
      filterProducts: optionalFunction(input.filterProducts),
      getFilteredItems: optionalFunction(input.getFilteredItems),
      setFilteredItems: optionalFunction(input.setFilteredItems),
      getLocateItem: optionalFunction(input.getLocateItem),
      setLocateItem: optionalFunction(input.setLocateItem),
      getCartItemProduct: optionalFunction(input.getCartItemProduct),
      getCartQuantity: optionalFunction(input.getCartQuantity),
      clearNavigation: optionalFunction(input.clearNavigation),
      notify: optionalFunction(input.notify)
    });
  }

  function installRuntimeGuards() {
    wrapCatalogApi();
    wrapProductRenderer();
    wrapItemFilter();
    wrapCartLocator();
  }

  function wrapCatalogApi() {
    const original = hooks.getApi();
    if (typeof original !== 'function') throw workspaceError('WORKSPACE_API_INVALID');
    hooks.setApi(function scopedWorkspaceApi(params, options) {
      const workspace = resolveWorkspace(activeWorkspaceId);
      if (!workspace) return Promise.reject(workspaceError('WORKSPACE_SELECTION_REQUIRED'));
      return original(scopeCatalogParams(params, workspace), options);
    });
  }

  function wrapProductRenderer() {
    if (!hooks.getShowProducts || !hooks.setShowProducts || !hooks.filterProducts) return;
    const original = hooks.getShowProducts();
    if (typeof original !== 'function') throw workspaceError('WORKSPACE_SHOW_PRODUCTS_INVALID');
    hooks.setShowProducts(function scopedShowProducts(...args) {
      const workspace = requireActiveWorkspace();
      hooks.filterProducts(workspace.productKey);
      return original(...args);
    });
  }

  function wrapItemFilter() {
    if (!hooks.getFilteredItems || !hooks.setFilteredItems) return;
    const original = hooks.getFilteredItems();
    if (typeof original !== 'function') throw workspaceError('WORKSPACE_FILTERED_ITEMS_INVALID');
    hooks.setFilteredItems(function scopedFilteredItems(...args) {
      const list = original(...args);
      const workspace = requireActiveWorkspace();
      return (Array.isArray(list) ? list : []).filter(item => productMatches(item, workspace.productKey));
    });
  }

  function wrapCartLocator() {
    if (!hooks.getLocateItem || !hooks.setLocateItem || !hooks.getCartItemProduct) return;
    const original = hooks.getLocateItem();
    if (typeof original !== 'function') throw workspaceError('WORKSPACE_LOCATE_ITEM_INVALID');
    hooks.setLocateItem(async function scopedLocateItem(id, ...args) {
      const target = workspaceForProduct(hooks.getCartItemProduct(id));
      if (target && target.id !== activeWorkspaceId) {
        activate(target.id, { reload: false, announce: false, focusCatalog: false });
      }
      return original(id, ...args);
    });
  }

  function reloadActiveCatalog(documentRef, options) {
    const content = documentRef?.getElementById?.('content');
    content?.classList?.add?.('v2-workspace-switching');
    let result;
    try {
      result = Promise.resolve(hooks.loadThemes());
    } catch (error) {
      result = Promise.reject(error);
    }
    result.finally(() => {
      content?.classList?.remove?.('v2-workspace-switching');
      refreshSharedCart(documentRef);
      if (options.focusCatalog !== false) {
        const title = documentRef?.getElementById?.('viewTitle');
        title?.setAttribute?.('tabindex', '-1');
        title?.focus?.({ preventScroll: true });
        documentRef?.querySelector?.('.catalog')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }
    });
    return result;
  }

  function installWorkspaceNavigation(documentRef) {
    if (documentRef.getElementById('v2WorkspaceNav')) return;
    const catalogHead = documentRef.querySelector('.catHead');
    if (!catalogHead) throw workspaceError('WORKSPACE_CATALOG_HEAD_MISSING');

    const section = documentRef.createElement('section');
    section.id = 'v2WorkspaceNav';
    section.className = 'v2-workspace-nav';
    section.setAttribute('aria-label', 'Escolha o produto que deseja procurar');
    section.innerHTML = `
      <div class="v2-workspace-nav-copy">
        <span>Estou procurando</span>
        <strong data-v2-workspace-title>Escolha um produto</strong>
      </div>
      <div class="v2-workspace-tabs" role="tablist" aria-label="Produtos disponíveis">
        ${workspaceButtons('tab')}
      </div>
      <div class="v2-workspace-cart-note" data-v2-shared-cart aria-live="polite">Mesmo carrinho para os dois produtos</div>
    `;
    catalogHead.insertBefore(section, catalogHead.firstChild);
    bindWorkspaceButtons(section);
  }

  function renderInitialChooser(documentRef) {
    if (documentRef.getElementById('v2WorkspaceChooser')) return;
    const overlay = documentRef.createElement('div');
    overlay.id = 'v2WorkspaceChooser';
    overlay.className = 'v2-workspace-chooser';
    overlay.innerHTML = `
      <section class="v2-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="v2WorkspaceChooserTitle" aria-describedby="v2WorkspaceChooserText">
        <p class="v2-workspace-eyebrow">Escolha por onde começar</p>
        <h2 id="v2WorkspaceChooserTitle">Qual produto você está procurando?</h2>
        <p id="v2WorkspaceChooserText">Você pode trocar de produto a qualquer momento. As artes escolhidas continuam no mesmo carrinho.</p>
        <div class="v2-workspace-cards">${workspaceButtons('card')}</div>
        <small>Preços, quantidades e regras continuam validados pelo sistema.</small>
      </section>
    `;
    documentRef.body.appendChild(overlay);
    bindWorkspaceButtons(overlay);
    if (typeof root?.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(() => overlay.classList.add('show'));
    } else {
      overlay.classList.add('show');
    }
    overlay.querySelector('[data-v2-workspace]')?.focus?.();
  }

  function closeInitialChooser(documentRef) {
    const overlay = documentRef.getElementById('v2WorkspaceChooser');
    if (!overlay) return;
    overlay.classList.remove('show');
    if (typeof root?.setTimeout === 'function') root.setTimeout(() => overlay.remove(), 180);
    else overlay.remove();
  }

  function workspaceButtons(kind) {
    return Object.values(WORKSPACES).map(workspace => {
      const card = kind === 'card';
      return `
        <button type="button" class="v2-workspace-${kind}" data-v2-workspace="${escapeHtml(workspace.id)}" ${card ? '' : 'role="tab"'} aria-selected="false">
          <span class="v2-workspace-icon" aria-hidden="true">${escapeHtml(workspace.icon)}</span>
          <span><b>${escapeHtml(workspace.label)}</b>${card ? `<small>${escapeHtml(workspace.description)}</small>` : ''}</span>
        </button>
      `;
    }).join('');
  }

  function bindWorkspaceButtons(container) {
    container.querySelectorAll('[data-v2-workspace]').forEach(button => {
      button.addEventListener('click', () => activate(button.dataset.v2Workspace, {
        reload: true,
        announce: true,
        focusCatalog: true
      }));
    });
  }

  function refreshWorkspaceUi(documentRef) {
    if (!documentRef) return;
    const active = resolveWorkspace(activeWorkspaceId);
    documentRef.querySelectorAll('[data-v2-workspace]').forEach(button => {
      const selected = button.dataset.v2Workspace === active?.id;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      if (button.getAttribute('role') === 'tab') button.tabIndex = selected ? 0 : -1;
    });
    documentRef.querySelectorAll('[data-v2-workspace-title]').forEach(element => {
      element.textContent = active?.title || 'Escolha um produto';
    });
    refreshSharedCart(documentRef);
  }

  function refreshSharedCart(documentRef) {
    if (!documentRef) return;
    const quantity = currentCartQuantity();
    const text = quantity > 0
      ? `Carrinho compartilhado: ${quantity} item(ns) nos dois produtos`
      : 'Mesmo carrinho para os dois produtos';
    documentRef.querySelectorAll('[data-v2-shared-cart]').forEach(element => {
      element.textContent = text;
    });
  }

  function observeSharedCart(documentRef) {
    const target = documentRef.getElementById('barItems');
    if (!target || typeof root?.MutationObserver !== 'function') return;
    observer = new root.MutationObserver(() => refreshSharedCart(documentRef));
    observer.observe(target, { childList: true, characterData: true, subtree: true });
  }

  function productMatches(item, productKey) {
    const key = clean(item?.productKey || item?.product).toLowerCase();
    const workspace = resolveWorkspace(key);
    return workspace?.productKey === productKey;
  }

  function requireActiveWorkspace() {
    const workspace = resolveWorkspace(activeWorkspaceId);
    if (!workspace) throw workspaceError('WORKSPACE_SELECTION_REQUIRED');
    return workspace;
  }

  function currentCartQuantity() {
    try {
      return Math.max(0, Number(hooks?.getCartQuantity?.() || 0));
    } catch (_) {
      return 0;
    }
  }

  function clearCatalogPlaceOnly() {
    try {
      root?.localStorage?.removeItem?.(LEGACY_PLACE_KEY);
    } catch (_) {}
  }

  function safeSessionGet() {
    try {
      return root?.sessionStorage?.getItem?.(SESSION_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function safeSessionSet(value) {
    try {
      root?.sessionStorage?.setItem?.(SESSION_KEY, value);
    } catch (_) {}
  }

  function updateProductQuery(workspaceId) {
    try {
      const url = new URL(root.location.href);
      url.searchParams.set('produto', workspaceId);
      root.history.replaceState(root.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function dispatchWorkspaceChange(workspace, changed) {
    try {
      const EventConstructor = root?.CustomEvent;
      if (typeof EventConstructor !== 'function') return;
      root.dispatchEvent(new EventConstructor('site-v2:workspace-change', {
        detail: Object.freeze({
          workspaceId: workspace.id,
          productKey: workspace.productKey,
          changed,
          cartQuantity: currentCartQuantity()
        })
      }));
    } catch (_) {}
  }

  function installStyles(documentRef) {
    if (documentRef.getElementById('v2WorkspaceStyles')) return;
    const style = documentRef.createElement('style');
    style.id = 'v2WorkspaceStyles';
    style.textContent = `
      .v2-workspace-nav{display:grid;grid-template-columns:minmax(150px,.8fr) minmax(280px,1.4fr) minmax(180px,.8fr);gap:14px;align-items:center;margin:0 0 18px;padding:14px;border:1px solid #eee2e5;border-radius:22px;background:linear-gradient(135deg,#fff,#fff9fb);box-shadow:0 14px 30px rgba(44,37,41,.05)}
      .v2-workspace-nav-copy{display:flex;flex-direction:column;gap:3px}.v2-workspace-nav-copy span{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#9b8f96}.v2-workspace-nav-copy strong{font:900 14px Montserrat,Arial,sans-serif;color:#343037}
      .v2-workspace-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:4px;border-radius:999px;background:#f7f2f4}.v2-workspace-tab{min-height:42px;border:1px solid transparent;border-radius:999px;background:transparent;color:#655d64;font:900 12px Montserrat,Arial,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px}.v2-workspace-tab.active{background:#fff;border-color:#a8e7f8;color:#117696;box-shadow:0 8px 18px rgba(56,186,227,.14)}
      .v2-workspace-icon{font-size:18px;line-height:1;color:#38bae3}.v2-workspace-cart-note{font-size:11px;line-height:1.35;color:#7d747a;text-align:right}
      .v2-workspace-chooser{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(38,31,35,.58);backdrop-filter:blur(10px);opacity:0;transition:opacity .18s ease}.v2-workspace-chooser.show{opacity:1}.v2-workspace-dialog{width:min(720px,100%);padding:30px;border-radius:30px;background:#fff;box-shadow:0 28px 80px rgba(24,19,22,.28);text-align:center}.v2-workspace-eyebrow{margin:0 0 8px;color:#d9366b;font:900 11px Montserrat,Arial,sans-serif;text-transform:uppercase;letter-spacing:.09em}.v2-workspace-dialog h2{margin:0;color:#302c31;font:900 clamp(23px,4vw,34px) Montserrat,Arial,sans-serif}.v2-workspace-dialog>p:not(.v2-workspace-eyebrow){max-width:570px;margin:12px auto 0;color:#756d73;line-height:1.55}.v2-workspace-dialog>small{display:block;margin-top:16px;color:#9b9197}
      .v2-workspace-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:24px}.v2-workspace-card{min-height:156px;padding:22px;border:1px solid #eee2e5;border-radius:24px;background:linear-gradient(145deg,#fff,#fff8fb);cursor:pointer;text-align:left;display:flex;align-items:flex-start;gap:14px;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}.v2-workspace-card:hover,.v2-workspace-card:focus-visible{transform:translateY(-2px);border-color:#9fe8fb;box-shadow:0 18px 34px rgba(56,186,227,.12);outline:none}.v2-workspace-card .v2-workspace-icon{display:grid;place-items:center;width:45px;height:45px;flex:0 0 45px;border-radius:16px;background:#e9f9fe}.v2-workspace-card b{display:block;margin:2px 0 8px;color:#302c31;font:900 18px Montserrat,Arial,sans-serif}.v2-workspace-card small{display:block;color:#746c72;font-size:12px;line-height:1.45}
      #content.v2-workspace-switching{opacity:.45;pointer-events:none;transition:opacity .16s ease}#viewTitle{outline:none}
      @media(max-width:760px){.v2-workspace-nav{grid-template-columns:1fr}.v2-workspace-cart-note{text-align:left}.v2-workspace-dialog{padding:24px 18px}.v2-workspace-cards{grid-template-columns:1fr}.v2-workspace-card{min-height:126px}.v2-workspace-tabs{width:100%}}
      @media(max-width:420px){.v2-workspace-tab{font-size:10.5px;padding:0 8px}.v2-workspace-nav{padding:12px;border-radius:18px}.v2-workspace-dialog h2{font-size:23px}}
      @media(prefers-reduced-motion:reduce){.v2-workspace-chooser,.v2-workspace-card,#content.v2-workspace-switching{transition:none!important;scroll-behavior:auto!important}}
    `;
    documentRef.head.appendChild(style);
  }

  function optionalFunction(value) {
    return typeof value === 'function' ? value : null;
  }

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function workspaceError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
    return value;
  }

  return Object.freeze({
    MARKER,
    SESSION_KEY,
    WORKSPACES,
    start,
    activate,
    getState,
    resolveWorkspace,
    resolveInitialWorkspace,
    workspaceForProduct,
    scopeCatalogParams,
    productMatches
  });
});
