(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root && root.document) api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MARKER = 'site-v2-visual-checkout-context-v1';
  const LEGACY_MEASUREMENT_KEYS = Object.freeze([
    'diameter',
    'width',
    'height',
    'unit',
    'roman',
    'cylinders',
    'panel',
    'unknown',
    'customized'
  ]);
  let installed = false;

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.documentElement.dataset.v2CheckoutContext = MARKER;
    document.addEventListener('click', event => {
      const anchor = event.target?.closest?.('a.wa');
      if (!anchor) return;

      try {
        const lines = typeof cart !== 'undefined' && Array.isArray(cart) ? cart : [];
        for (const item of lines) preserveVisualCheckoutItem(item);

        const sellerValue = typeof seller !== 'undefined' ? seller : null;
        const sellerProfiles = typeof SELLERS !== 'undefined' && isRecord(SELLERS) ? SELLERS : {};
        const sellerSnapshot = canonicalVisualSeller(sellerValue, sellerProfiles);
        if (sellerSnapshot) document.documentElement.dataset.v2CheckoutSeller = sellerSnapshot.id;
      } catch (_) {
        // O bridge continuará responsável por falhar fechado caso o carrinho seja inválido.
      }
    }, true);
  }

  function preserveVisualCheckoutItem(item) {
    if (!isRecord(item)) return item;
    const details = isRecord(item.details) ? item.details : {};

    if (details.measurements === undefined) {
      const measurements = canonicalVisualMeasurements(item, details);
      if (measurements !== undefined) details.measurements = measurements;
    }

    if (details.observations === undefined) {
      const observations = canonicalVisualObservations(item, details);
      if (observations !== undefined) details.observations = observations;
    }

    item.details = details;
    return item;
  }

  function canonicalVisualMeasurements(item, details = {}) {
    const explicit = firstPresent([
      details.measurements,
      item?.measurements,
      item?.medidas,
      details.medidas
    ]);
    if (explicit !== undefined) return cloneSerializable(explicit);

    const legacy = {};
    for (const key of LEGACY_MEASUREMENT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(details, key)) {
        legacy[key] = cloneSerializable(details[key]);
      }
    }

    return Object.keys(legacy).length ? legacy : undefined;
  }

  function canonicalVisualObservations(item, details = {}) {
    const value = firstPresent([
      details.observations,
      item?.observations,
      item?.observation,
      item?.observacoes,
      item?.observacao,
      details.observation,
      details.observacoes,
      details.observacao
    ]);
    return value === undefined ? undefined : cloneSerializable(value);
  }

  function canonicalVisualSeller(value, sellers = {}) {
    const direct = isRecord(value) ? value : {};
    const id = clean(
      typeof value === 'string'
        ? value
        : direct.id || direct.sellerId || direct.username || direct.key
    );
    if (!id) return null;

    const profile = isRecord(sellers?.[id]) ? sellers[id] : {};
    const label = clean(direct.label || direct.name || profile.label || profile.name || id);
    return label ? Object.freeze({ id, label }) : null;
  }

  function firstPresent(values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
  }

  function cloneSerializable(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return String(value);
    }
  }

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  return Object.freeze({
    MARKER,
    install,
    preserveVisualCheckoutItem,
    canonicalVisualMeasurements,
    canonicalVisualObservations,
    canonicalVisualSeller
  });
});
