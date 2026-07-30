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

  async function start(input = {}) {
    if (started && activeConfig) return activeConfig;
    hooks = validateHooks(input);
    started = true;
    root?.document?.documentElement?.setAttribute?.('data-v2-commercial-config', MARKER);
    const config = await fetchCommercialConfig(input.fetch || root?.fetch?.bind(root));
    applyCommercialConfig(config);
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
    patchCommercialCopy(root?.document);
    hooks.renderCart();
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
      const discount = activeConfig.effectiveDiscountPercent;
      if (!result || typeof result !== 'object') return result;
      const replacement = discount > 0
        ? `${formatPercent(discount)} de desconto`
        : 'valores atualizados';
      return { ...result, msg: clean(result.msg).replace(/10% de desconto|desconto de 10%/gi, replacement) };
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

  function patchCommercialCopy(documentRef) {
    if (!documentRef || !activeConfig) return;
    const percent = activeConfig.effectiveDiscountPercent;
    const percentText = formatPercent(percent);
    const subtitleStrong = documentRef.querySelector('.subtitle strong');
    if (subtitleStrong) subtitleStrong.textContent = percent > 0 ? `${percentText} de desconto` : 'valores atualizados';
    const promoPill = documentRef.querySelector('.promoPill');
    const promoTitle = documentRef.querySelector('.promo h3');
    const promoText = documentRef.querySelector('.promo p:last-child');
    if (promoPill) promoPill.textContent = percent > 0 ? `${percentText} OFF por aqui` : 'Valores atualizados';
    if (promoTitle) promoTitle.textContent = percent > 0 ? 'Escolha suas artes e já envie com desconto' : 'Escolha suas artes com os valores atuais';
    if (promoText) promoText.textContent = percent > 0
      ? `O desconto de ${percentText} é aplicado automaticamente antes do envio.`
      : 'Os preços, mínimos e incrementos exibidos são controlados pelo painel administrativo.';

    documentRef.querySelectorAll('.discountCard').forEach(card => {
      card.hidden = percent <= 0;
      const span = card.querySelector('span');
      if (span) span.textContent = `${percentText} OFF por aqui`;
    });
    documentRef.querySelectorAll('.totalLine').forEach(line => {
      const label = line.querySelector('span');
      if (label && /Desconto por aqui/i.test(label.textContent || '')) {
        line.hidden = percent <= 0;
        label.textContent = `Desconto por aqui ${percentText}`;
      }
    });
    documentRef.querySelectorAll('.wa').forEach(link => {
      link.textContent = percent > 0 ? `Enviar pedido com ${percentText} OFF` : 'Enviar pedido';
    });
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
