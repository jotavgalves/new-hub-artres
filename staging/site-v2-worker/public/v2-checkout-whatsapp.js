(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) {
    root.SiteV2CheckoutWhatsApp = api;
    if (root.document) api.install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MARKER = 'site-v2-visual-checkout-whatsapp-v1';
  let installed = false;

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.documentElement.dataset.v2CheckoutWhatsapp = MARKER;
  }

  function createVisualWhatsAppSnapshot(rawItems = [], canonicalItems = []) {
    if (!Array.isArray(rawItems) || !Array.isArray(canonicalItems) || rawItems.length !== canonicalItems.length) {
      throw whatsappError('WHATSAPP_ITEM_SNAPSHOT_INVALID');
    }
    if (!rawItems.length) throw whatsappError('WHATSAPP_ITEMS_REQUIRED');
    return Object.freeze(rawItems.map((item, index) => normalizeVisualWhatsAppItem(item, canonicalItems[index])));
  }

  function normalizeVisualWhatsAppItem(rawItem = {}, canonicalItem = {}) {
    const raw = record(rawItem);
    const canonical = record(canonicalItem);
    const rawDetails = record(raw.details);
    const canonicalDetails = record(canonical.details);
    const productKey = clean(canonical.productKey || raw.productKey || raw.product);
    const variantKey = clean(canonical.variantKey || raw.variantKey || rawDetails.variantKey || 'default');
    const sizeKey = clean(canonical.sizeKey || raw.sizeKey || rawDetails.sizeKey || 'default');
    const quantity = positiveInteger(canonical.quantity ?? raw.quantity ?? raw.qty);

    if (!productKey) throw whatsappError('WHATSAPP_ITEM_PRODUCT_REQUIRED');
    if (!quantity) throw whatsappError('WHATSAPP_ITEM_QUANTITY_INVALID');

    const variantLabel = firstText(
      raw.variantLabel,
      rawDetails.variantLabel,
      raw.variant,
      rawDetails.variant,
      productKey === 'sacolinha' ? rawDetails.size : '',
      variantKey === 'default' ? '' : variantKey
    );
    const sizeLabel = firstText(
      raw.sizeLabel,
      rawDetails.sizeLabel,
      productKey === 'sacolinha' ? '' : raw.size,
      productKey === 'sacolinha' ? '' : rawDetails.size,
      sizeKey === 'default' ? '' : sizeKey
    );

    return deepFreeze({
      code: firstText(raw.code, raw.codigo, raw.artCode, raw.artworkCode),
      theme: firstText(raw.theme, raw.themeName, raw.tema),
      productKey,
      productLabel: firstText(raw.productName, raw.productLabel, raw.nomeProduto, raw.product, productKey),
      variantKey,
      variantLabel,
      sizeKey,
      sizeLabel,
      quantity,
      measurements: cloneSerializable(firstPresent([
        canonicalDetails.measurements,
        rawDetails.measurements,
        raw.measurements,
        raw.medidas,
        rawDetails.medidas
      ])),
      observations: clean(firstPresent([
        canonicalDetails.observations,
        rawDetails.observations,
        raw.observations,
        raw.observacoes,
        rawDetails.observacoes,
        rawDetails.observacao
      ])).slice(0, 800)
    });
  }

  function createVisualWhatsAppMessage(input = {}) {
    const orderNumber = clean(input.orderNumber).slice(0, 40);
    const seller = record(input.seller);
    const sellerLabel = clean(seller.label || seller.name || seller.id).slice(0, 120);
    const items = Array.isArray(input.items) ? input.items : [];

    if (!orderNumber) throw whatsappError('WHATSAPP_ORDER_NUMBER_REQUIRED');
    if (!sellerLabel) throw whatsappError('WHATSAPP_SELLER_REQUIRED');
    if (!items.length) throw whatsappError('WHATSAPP_ITEMS_REQUIRED');

    const lines = [
      `Oi, ${sellerLabel}! Meu pedido foi registrado no site.`,
      '',
      `Pedido: ${orderNumber}`,
      '',
      'Minha seleção:'
    ];

    items.forEach((source, index) => {
      const item = normalizePreparedItem(source);
      const heading = item.code
        ? `${index + 1}. Arte #${item.code} | ${item.productLabel}`
        : `${index + 1}. ${item.productLabel}`;
      lines.push('', heading);
      if (item.theme) lines.push(`Tema: ${item.theme}`);
      lines.push(`Quantidade: ${item.quantity} un.`);
      if (item.variantLabel) lines.push(`Variante: ${item.variantLabel}`);
      if (item.sizeLabel) lines.push(`Tamanho: ${item.sizeLabel}`);

      const measurements = formatVisualMeasurements(item.measurements);
      if (measurements.length === 1) lines.push(`Medidas: ${measurements[0]}`);
      else if (measurements.length > 1) {
        lines.push('Medidas:');
        for (const measurement of measurements) lines.push(`- ${measurement}`);
      }
      if (item.observations) lines.push(`Observações: ${item.observations}`);
    });

    lines.push('', 'Pode conferir os itens e me ajudar a finalizar?');
    return lines.join('\n');
  }

  function createVisualWhatsAppUrl(input = {}) {
    const phone = digits(input.phone).slice(0, 15);
    const message = String(input.message || '');
    if (phone.length < 10) throw whatsappError('WHATSAPP_PHONE_INVALID');
    if (!message.trim()) throw whatsappError('WHATSAPP_MESSAGE_REQUIRED');
    if (new TextEncoder().encode(message).byteLength > 32 * 1024) {
      throw whatsappError('WHATSAPP_MESSAGE_TOO_LARGE');
    }
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }

  function formatVisualMeasurements(value) {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value !== 'object') {
      const text = clean(value);
      return text ? [text] : [];
    }
    if (Array.isArray(value)) {
      return value.map(entry => clean(entry)).filter(Boolean).slice(0, 20);
    }

    const measurements = record(value);
    const unit = clean(measurements.unit || measurements.unidade || 'cm') || 'cm';
    const lines = [];

    if (truthy(measurements.unknown) || truthy(measurements.desconhecida)) {
      lines.push('A confirmar com a vendedora');
    }

    const diameter = firstPresent([
      measurements.diameter,
      measurements.diameterCm,
      measurements.diametro,
      measurements.diametroCm
    ]);
    if (present(diameter)) lines.push(`Diâmetro: ${measurementValue(diameter, unit)}`);

    const width = firstPresent([
      measurements.width,
      measurements.widthCm,
      measurements.largura,
      measurements.larguraCm
    ]);
    const height = firstPresent([
      measurements.height,
      measurements.heightCm,
      measurements.altura,
      measurements.alturaCm
    ]);
    const pair = dimensionPair(width, height, unit);
    if (pair) lines.push(pair);

    const roman = record(measurements.roman || measurements.romano);
    const romanPair = dimensionPair(
      firstPresent([roman.width, roman.widthCm, roman.largura, roman.larguraCm]),
      firstPresent([roman.height, roman.heightCm, roman.altura, roman.alturaCm]),
      clean(roman.unit || roman.unidade || unit) || unit,
      'Romano'
    );
    if (romanPair) lines.push(romanPair);

    const panel = record(measurements.panel || measurements.painel);
    const panelDiameter = firstPresent([
      panel.diameter,
      panel.diameterCm,
      panel.diametro,
      panel.diametroCm
    ]);
    if (present(panelDiameter)) {
      lines.push(`Painel: diâmetro ${measurementValue(panelDiameter, clean(panel.unit || unit) || unit)}`);
    }

    const cylinders = record(measurements.cylinders || measurements.cilindros);
    for (const key of ['p', 'm', 'g']) {
      const cylinder = record(cylinders[key] || cylinders[key.toUpperCase()]);
      if (!Object.keys(cylinder).length) continue;
      const cylinderUnit = clean(cylinder.unit || cylinder.unidade || unit) || unit;
      const cylinderWidth = firstPresent([cylinder.width, cylinder.widthCm, cylinder.largura, cylinder.larguraCm]);
      const cylinderHeight = firstPresent([cylinder.height, cylinder.heightCm, cylinder.altura, cylinder.alturaCm]);
      const cap = firstPresent([
        cylinder.cap,
        cylinder.capCm,
        cylinder.tampa,
        cylinder.tampaCm,
        cylinder.lid,
        cylinder.lidCm
      ]);
      const dimensions = dimensionPair(cylinderWidth, cylinderHeight, cylinderUnit, `Cilindro ${key.toUpperCase()}`);
      const capText = present(cap) ? `tampa ${measurementValue(cap, cylinderUnit)}` : '';
      if (dimensions && capText) lines.push(`${dimensions}; ${capText}`);
      else if (dimensions) lines.push(dimensions);
      else if (capText) lines.push(`Cilindro ${key.toUpperCase()}: ${capText}`);
    }

    if (!lines.length && truthy(measurements.customized || measurements.personalizada)) {
      lines.push('Medidas personalizadas informadas');
    }

    return [...new Set(lines)].slice(0, 20);
  }

  function normalizePreparedItem(source) {
    const item = record(source);
    const quantity = positiveInteger(item.quantity);
    const productLabel = clean(item.productLabel || item.productKey).slice(0, 160);
    if (!quantity) throw whatsappError('WHATSAPP_ITEM_QUANTITY_INVALID');
    if (!productLabel) throw whatsappError('WHATSAPP_ITEM_PRODUCT_REQUIRED');
    return {
      code: clean(item.code).slice(0, 80),
      theme: clean(item.theme).slice(0, 240),
      productLabel,
      variantLabel: clean(item.variantLabel).slice(0, 160),
      sizeLabel: clean(item.sizeLabel).slice(0, 160),
      quantity,
      measurements: cloneSerializable(item.measurements),
      observations: clean(item.observations).slice(0, 800)
    };
  }

  function dimensionPair(width, height, unit, prefix = '') {
    if (!present(width) && !present(height)) return '';
    const label = prefix ? `${prefix}: ` : '';
    if (present(width) && present(height)) {
      return `${label}${plainMeasurement(width)} x ${measurementValue(height, unit)}`;
    }
    if (present(width)) return `${label}largura ${measurementValue(width, unit)}`;
    return `${label}altura ${measurementValue(height, unit)}`;
  }

  function measurementValue(value, unit) {
    const text = plainMeasurement(value);
    if (!text) return '';
    if (/[a-zA-ZÀ-ÿ]/.test(text)) return text;
    return `${text} ${unit}`.trim();
  }

  function plainMeasurement(value) {
    if (!present(value)) return '';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value).replace('.', ',') : '';
    return clean(value).replace(/\s+/g, ' ');
  }

  function firstText(...values) {
    for (const value of values) {
      const text = clean(value);
      if (text) return text;
    }
    return '';
  }

  function firstPresent(values) {
    return values.find(present);
  }

  function present(value) {
    return value !== undefined && value !== null && value !== '';
  }

  function truthy(value) {
    return value === true || value === 1 || String(value || '').toLowerCase() === 'true';
  }

  function positiveInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  function clean(value) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function digits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function cloneSerializable(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return clean(value);
    }
  }

  function whatsappError(code) {
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
    install,
    createVisualWhatsAppSnapshot,
    normalizeVisualWhatsAppItem,
    createVisualWhatsAppMessage,
    createVisualWhatsAppUrl,
    formatVisualMeasurements
  });
});
