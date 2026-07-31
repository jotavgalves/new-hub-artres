(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.SiteV2CommercialConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const MARKER = 'site-v2-commercial-config-v1';
  const ENDPOINT = '/api/commercial-config';
  const PRODUCT_KEYS = Object.freeze(['50x50', 'painel-150']);
  let activeConfig = null;
  let hooks = null;
  let started = false;
  let hooksWrapped = false;
  let refreshTimer = null;
  let copyObserver = null;
  let copyPatchScheduled = false;

  async function start(input = {}) {
    if (started && activeConfig) return activeConfig;
    hooks = validateHooks(input);
    started = true;
    root?.document?.documentElement?.setAttribute?.('data-v2-commercial-config', MARKER);
    const config = await fetchCommercialConfig(input.fetch || root?.fetch?.bind(root));
    applyCommercialConfig(config);
    observeCommercialCopy(root?.document);
    scheduleRefresh(input.refreshMs);
    return activeConfig;
  }

  async function refresh(fetchImpl = root?.fetch?.bind(root)) {
    const config = await fetchCommercialConfig(fetchImpl);
    if (!activeConfig || config.version !== activeConfig.version) {
      applyCommercialConfig(config);
      hooks?.notify?.('Preços e quantidades foram atualizados.');
    }
    return activeConfig;
  }

  async function fetchCommercialConfig(fetchImpl) {
    if (typeof fetchImpl !== 'function') throw configError('COMMERCIAL_CONFIG_FETCH_UNAVAILABLE');
    const response = await fetchImpl(ENDPOINT, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    let payload;
    try { payload = await response.json(); } catch (_) { throw configError('COMMERCIAL_CONFIG_RESPONSE_INVALID'); }
    if (!response.ok || payload?.ok !== true) {
      throw configError(publicCode(payload?.error || `HTTP_${response.status}`));
    }
    return validatePublicConfig(payload.config);
  }

  function applyCommercialConfig(config) {
    activeConfig = config;
    if (!hooksWrapped) {
      wrapProductConfig();
      wrapPrice();
      wrapDiscount();
      wrapQuantityRule();
      wrapCartRule();
      wrapRenderCart();
      hooksWrapped = true;
    }
    hooks.renderCart();
    patchCommercialCopy(root?.document);
    return activeConfig;
  }

  function validatePublicConfig(input = {}) {
    const source = record(input);
    const version = positiveInteger(source.version);
    const discount = percentage(source.effectiveDiscountPercent);
    const productsSource = record(source.products);
    if (source.schemaVersion !== 1 || !version || discount === null || source.currency !== 'BRL') {
      throw configError('COMMERCIAL_CONFIG_CONTRACT_INVALID');
    }

    const products = {};
    for (const key of PRODUCT_KEYS) {
      const product = record(productsSource[key]);
      const quantity = record(product.quantity);
      const unitPrice = money(product.unitPrice);
      const minimum = positiveInteger(quantity.minimum);
      const step = positiveInteger(quantity.step);
      const initial = positiveInteger(quantity.initial);
      if (!clean(product.label) || unitPrice === null || !minimum || !step || !initial) {
        throw configError(`COMMERCIAL_CONFIG_PRODUCT_INVALID:${key}`);
      }
      products[key] = Object.freeze({
        key,
        label: clean(product.label),
        enabled: product.enabled === true,
        unitPrice,
        quantity: Object.freeze({
          minimum,
          step,
          initial,
          scope: quantity.scope === 'item' ? 'item' : 'cart-product-total'
        })
      });
    }

    return deepFreeze({
      schemaVersion: 1,
      version,
      currency: 'BRL',
      effectiveDiscountPercent: discount,
      products,
      updatedAt: validIsoDate(source.updatedAt)
    });
  }

  function wrapProductConfig() {
    const original = hooks.getProductConfig();
    hooks.setProductConfig(function configuredProductConfig(productKey) {
      const legacy = original(productKey);
      const commercial = activeConfig?.products?.[productKey];
      if (!commercial) return legacy;
      return {
        ...legacy,
        label: commercial.label,
        unitPrice: commercial.unitPrice,
        baseQty: commercial.quantity.minimum,
        basePrice: roundMoney(commercial.unitPrice * commercial.quantity.minimum),
        afterStep: commercial.quantity.step,
        initialQuantity: commercial.quantity.initial,
        checkoutEnabled: commercial.enabled
      };
    });
  }

  function wrapPrice() {
    const original = hooks.getPrice();
    hooks.setPrice(function configuredPrice(productKey, quantity, item) {
      const commercial = activeConfig?.products?.[productKey];
      if (!commercial) return original(productKey, quantity, item);
      const qty = Number(quantity || 0);
      return qty > 0 ? roundMoney(qty * commercial.unitPrice) : 0;
    });
  }

  function wrapDiscount() {
    hooks.setDiscount(function configuredDiscount() {
      return roundMoney(hooks.getGross() * (activeConfig.effectiveDiscountPercent / 100));
    });
  }

  function wrapQuantityRule() {
    hooks.setRule50(function configuredBolinhasRule() {
      const product = activeConfig.products['50x50'];
      const quantity = hooks.getCartItems()
        .filter(item => item.product === '50x50')
        .reduce((sum, item) => sum + positiveInteger(item.qty), 0);
      if (!quantity) return null;
      if (!product.enabled) return {
        type: 'bad', title: product.label, msg: 'Este produto está temporariamente indisponível.'
      };
      const { minimum, step } = product.quantity;
      if (quantity < minimum) return {
        type: 'bad', title: product.label, msg: `Faltam ${minimum - quantity} para fechar o mínimo de ${minimum}.`
      };
      const remainder = (quantity - minimum) % step;
      if (remainder !== 0) return {
        type: 'warn', title: product.label, msg: `Adicione mais ${step - remainder} para respeitar o incremento de ${step}.`
      };
      return {
        type: 'ok', title: product.label,
        msg: quantity === minimum
          ? `Mínimo de ${minimum} fechado. Os próximos incrementos são de ${step}.`
          : 'Quantidade dentro da regra comercial.'
      };
    });
  }

  function wrapCartRule() {
    const original = hooks.getCartRule();
    hooks.setCartRule(function configuredCartRule() {
      const result = original();
      if (!result || typeof result !== 'object') return result;
      const discount = activeConfig.effectiveDiscountPercent;
      const percentText = formatPercent(discount);
      let msg = clean(result.msg);
      if (discount > 0) {
        msg = msg
          .replace(/10% de desconto|desconto de 10%/gi, `${percentText} de desconto`)
          .replace(/10% OFF/gi, `${percentText} OFF`);
      } else {
        msg = msg
          .replace(
            /Seu pedido ainda está vazio\. Escolha o tema da festa e adicione as artes que mais gostar\. O desconto de 10% entra automaticamente\.?/gi,
            'Seu pedido ainda está vazio. Escolha o tema da festa e adicione as artes que mais gostar.'
          )
          .replace(
            /Perfeito\. Sua seleção está pronta para enviar com 10% de desconto por aqui\.?/gi,
            'Perfeito. Sua seleção está pronta para enviar com os valores atuais.'
          )
          .replace(/10% de desconto|desconto de 10%/gi, 'valores atuais');
      }
      return { ...result, msg };
    });
  }

  function wrapRenderCart() {
    const original = hooks.getRenderCart();
    hooks.setRenderCart(function configuredRenderCart(...args) {
      const result = original(...args);
      patchCommercialCopy(root?.document);
      return result;
    });
  }

  function observeCommercialCopy(documentRef) {
    if (!documentRef?.body || copyObserver || typeof root?.MutationObserver !== 'function') return;
    copyObserver = new root.MutationObserver(() => scheduleCommercialCopyPatch(documentRef));
    copyObserver.observe(documentRef.body, { childList: true, subtree: true, characterData: true });
  }

  function scheduleCommercialCopyPatch(documentRef) {
    if (copyPatchScheduled) return;
    copyPatchScheduled = true;
    const schedule = typeof root?.queueMicrotask === 'function'
      ? root.queueMicrotask.bind(root)
      : callback => Promise.resolve().then(callback);
    schedule(() => {
      copyPatchScheduled = false;
      patchCommercialCopy(documentRef);
    });
  }

  function patchCommercialCopy(documentRef) {
    if (!documentRef || !activeConfig) return;
    const percent = activeConfig.effectiveDiscountPercent;
    const percentText = formatPercent(percent);
    const hasDiscount = percent > 0;

    const subtitleStrong = documentRef.querySelector('.subtitle strong');
    setText(subtitleStrong, hasDiscount ? `${percentText} de desconto` : 'valores atualizados');

    const promoPill = documentRef.querySelector('.promoPill');
    const promoTitle = documentRef.querySelector('.promo h3');
    const promoText = documentRef.querySelector('.promo p:last-child');
    setText(promoPill, hasDiscount ? `${percentText} OFF por aqui` : 'Valores atualizados');
    setText(promoTitle, hasDiscount
      ? 'Escolha suas artes e já envie com desconto'
      : 'Escolha suas artes com os valores atuais');
    setText(promoText, hasDiscount
      ? `O desconto de ${percentText} é aplicado automaticamente antes do envio.`
      : 'Os preços, mínimos e incrementos exibidos são controlados pelo painel administrativo.');

    const viewCaption = documentRef.querySelector('#viewCaption');
    if (viewCaption) {
      const current = clean(viewCaption.textContent);
      if (hasDiscount && /10%|desconto/i.test(current)) {
        setText(viewCaption, current.replace(/10%/g, percentText));
      } else if (!hasDiscount && /desconto|10%/i.test(current)) {
        setText(viewCaption, 'Toque na arte para ver melhor. Quando gostar, adicione ao seu pedido.');
      }
    }

    documentRef.querySelectorAll('.discountCard').forEach(card => {
      card.style.display = hasDiscount ? '' : 'none';
      card.setAttribute('aria-hidden', hasDiscount ? 'false' : 'true');
      const span = card.querySelector('span');
      setText(span, `${percentText} OFF por aqui`);
      const small = card.querySelector('small');
      if (small) setText(small, `O desconto de ${percentText} entra automaticamente no total antes do envio.`);
    });

    documentRef.querySelectorAll('.totalLine').forEach(line => {
      const label = line.querySelector('span');
      if (label && /Desconto por aqui/i.test(label.textContent || '')) {
        line.style.display = hasDiscount ? '' : 'none';
        line.setAttribute('aria-hidden', hasDiscount ? 'false' : 'true');
        setText(label, `Desconto por aqui ${percentText}`);
      }
    });

    documentRef.querySelectorAll('.total').forEach(total => {
      const label = total.querySelector('span');
      setText(label, hasDiscount ? 'Total com desconto' : 'Total');
    });

    documentRef.querySelectorAll('.wa').forEach(link => {
      setText(link, hasDiscount ? `Enviar pedido com ${percentText} OFF` : 'Enviar pedido');
    });

    documentRef.querySelectorAll('.emptyCart').forEach(empty => {
      const nextHtml = hasDiscount
        ? `<b>Seu pedido ainda está vazio</b>Escolha um tema que combine com sua festa e adicione as artes que mais gostar. O desconto de ${percentText} será aplicado automaticamente no final.`
        : '<b>Seu pedido ainda está vazio</b>Escolha um tema que combine com sua festa e adicione as artes que mais gostar.';
      if (empty.innerHTML !== nextHtml) empty.innerHTML = nextHtml;
    });

    documentRef.querySelectorAll('.ruleCard').forEach(card => {
      if (card.querySelector('b')) return;
      const current = clean(card.textContent);
      if (!/10%|desconto/i.test(current)) return;
      const next = hasDiscount
        ? current.replace(/10%/g, percentText)
        : current
            .replace(/O desconto de 10% entra automaticamente\.?/gi, '')
            .replace(/com 10% de desconto por aqui/gi, 'com os valores atuais')
            .replace(/10% de desconto|desconto de 10%/gi, 'valores atuais')
            .replace(/\s+/g, ' ')
            .trim();
      setText(card, next);
    });
  }

  function setText(node, value) {
    if (!node) return;
    const next = String(value ?? '');
    if (node.textContent !== next) node.textContent = next;
  }

  function validateHooks(input) {
    const required = [
      'getProductConfig','setProductConfig','getPrice','setPrice','setDiscount','getGross',
      'getRule50','setRule50','getCartRule','setCartRule','getRenderCart','setRenderCart',
      'renderCart','getCartItems'
    ];
    for (const name of required) {
      if (typeof input[name] !== 'function') throw configError(`COMMERCIAL_CONFIG_HOOK_REQUIRED:${name}`);
    }
    return Object.freeze({ ...input, notify: typeof input.notify === 'function' ? input.notify : null });
  }

  function scheduleRefresh(value) {
    const refreshMs = Math.max(60_000, Number(value || 60_000));
    if (typeof root?.setInterval !== 'function' || refreshTimer) return;
    refreshTimer = root.setInterval(() => { void refresh().catch(() => {}); }, refreshMs);
  }

  function getState() {
    return Object.freeze({ started, hooksWrapped, marker: MARKER, config: activeConfig });
  }

  function money(value) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? roundMoney(parsed) : null;
  }
  function percentage(value) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? roundMoney(parsed) : null;
  }
  function positiveInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
  function formatPercent(value) { return `${String(roundMoney(value)).replace('.', ',')}%`; }
  function validIsoDate(value) { const date = new Date(String(value || '')); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; }
  function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function publicCode(value) { const text = String(value || 'COMMERCIAL_CONFIG_FAILED'); return /^[A-Z0-9_:.-]{3,160}$/.test(text) ? text : 'COMMERCIAL_CONFIG_FAILED'; }
  function configError(code) { const error = new Error(code); error.code = code; return error; }
  function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); return value; }

  return Object.freeze({ MARKER, ENDPOINT, PRODUCT_KEYS, start, refresh, fetchCommercialConfig, validatePublicConfig, getState });
});
