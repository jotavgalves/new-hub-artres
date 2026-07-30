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
  const RECOVERY_KEY = 'armazem:v2-checkout-whatsapp-recovery';
  const RECOVERY_VERSION = 1;
  const RECOVERY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const RECOVERY_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
  let installed = false;

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.documentElement.dataset.v2CheckoutWhatsapp = MARKER;
    setTimeout(() => renderVisualWhatsAppRecovery(), 0);
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
    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    rememberVisualWhatsAppRecoveryFromMessage({ message, whatsappUrl });
    return whatsappUrl;
  }

  function createVisualWhatsAppRecovery(input = {}, now = Date.now()) {
    const orderNumber = clean(input.orderNumber).slice(0, 40);
    const whatsappUrl = String(input.whatsappUrl || '');
    const createdAtMs = finiteTimestamp(input.createdAtMs ?? now);
    if (!/^PED[0-9]{7}[A-Z]$/.test(orderNumber)) {
      throw whatsappError('WHATSAPP_RECOVERY_ORDER_INVALID');
    }
    if (!isSafeVisualWhatsAppUrl(whatsappUrl)) {
      throw whatsappError('WHATSAPP_RECOVERY_URL_INVALID');
    }
    if (!createdAtMs) throw whatsappError('WHATSAPP_RECOVERY_TIME_INVALID');
    return deepFreeze({
      version: RECOVERY_VERSION,
      orderNumber,
      whatsappUrl,
      createdAtMs
    });
  }

  function parseVisualWhatsAppRecovery(value, now = Date.now()) {
    let source = value;
    if (typeof source === 'string') {
      try { source = JSON.parse(source); } catch (_) { return null; }
    }
    const row = record(source);
    if (Number(row.version) !== RECOVERY_VERSION) return null;
    const createdAtMs = finiteTimestamp(row.createdAtMs);
    const current = finiteTimestamp(now);
    if (!createdAtMs || !current) return null;
    if (createdAtMs > current + RECOVERY_FUTURE_TOLERANCE_MS) return null;
    if (current - createdAtMs > RECOVERY_MAX_AGE_MS) return null;
    try {
      return createVisualWhatsAppRecovery(row, createdAtMs);
    } catch (_) {
      return null;
    }
  }

  function isSafeVisualWhatsAppUrl(value) {
    let url;
    try { url = new URL(String(value || '')); } catch (_) { return false; }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'wa.me' ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    ) return false;
    if (!/^\/[0-9]{10,15}$/.test(url.pathname)) return false;
    if ([...url.searchParams.keys()].some(key => key !== 'text')) return false;
    const message = url.searchParams.get('text') || '';
    return Boolean(message.trim()) && new TextEncoder().encode(message).byteLength <= 32 * 1024;
  }

  function rememberVisualWhatsAppRecoveryFromMessage(input = {}) {
    const orderNumber = extractOrderNumber(input.message);
    if (!orderNumber) return null;
    let recovery;
    try {
      recovery = createVisualWhatsAppRecovery({
        orderNumber,
        whatsappUrl: input.whatsappUrl,
        createdAtMs: Date.now()
      });
    } catch (_) {
      return null;
    }
    writeVisualWhatsAppRecovery(recovery);
    renderVisualWhatsAppRecovery(recovery);
    return recovery;
  }

  function readVisualWhatsAppRecovery() {
    if (typeof sessionStorage === 'undefined') return null;
    let raw = '';
    try { raw = sessionStorage.getItem(RECOVERY_KEY) || ''; } catch (_) { return null; }
    const recovery = parseVisualWhatsAppRecovery(raw);
    if (!recovery && raw) clearVisualWhatsAppRecovery();
    return recovery;
  }

  function writeVisualWhatsAppRecovery(value) {
    const recovery = parseVisualWhatsAppRecovery(value);
    if (!recovery || typeof sessionStorage === 'undefined') return false;
    try {
      sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearVisualWhatsAppRecovery() {
    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.removeItem(RECOVERY_KEY); } catch (_) {}
    }
    if (typeof document !== 'undefined') document.getElementById('v2CheckoutRecovery')?.remove();
  }

  function renderVisualWhatsAppRecovery(value) {
    if (typeof document === 'undefined') return false;
    document.getElementById('v2CheckoutRecovery')?.remove();
    const recovery = value ? parseVisualWhatsAppRecovery(value) : readVisualWhatsAppRecovery();
    if (!recovery || !document.body) return false;

    const container = document.createElement('div');
    container.id = 'v2CheckoutRecovery';
    container.setAttribute('role', 'status');
    container.style.cssText = 'position:fixed;z-index:100000;left:14px;right:14px;bottom:14px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;padding:12px 14px;border-radius:18px;background:#222124;color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.28);font:700 13px Arial';

    const text = document.createElement('span');
    text.textContent = `Pedido ${recovery.orderNumber} registrado.`;

    const reopen = document.createElement('button');
    reopen.type = 'button';
    reopen.textContent = 'Abrir WhatsApp novamente';
    reopen.style.cssText = 'min-height:38px;border:0;border-radius:12px;padding:0 13px;background:#25d366;color:#fff;font:800 12px Arial;cursor:pointer';
    reopen.addEventListener('click', () => openRecoveredWhatsApp(recovery.whatsappUrl));

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Ocultar recuperação do pedido');
    dismiss.textContent = '×';
    dismiss.style.cssText = 'width:38px;height:38px;border:1px solid rgba(255,255,255,.28);border-radius:12px;background:transparent;color:#fff;font:800 20px Arial;cursor:pointer';
    dismiss.addEventListener('click', clearVisualWhatsAppRecovery);

    container.append(text, reopen, dismiss);
    document.body.append(container);
    return true;
  }

  function openRecoveredWhatsApp(whatsappUrl) {
    if (!isSafeVisualWhatsAppUrl(whatsappUrl) || typeof window === 'undefined') {
      throw whatsappError('WHATSAPP_RECOVERY_URL_INVALID');
    }
    const opened = window.open(whatsappUrl, '_blank');
    if (opened) {
      try { opened.opener = null; } catch (_) {}
      return true;
    }
    window.location.assign(whatsappUrl);
    return true;
  }

  function extractOrderNumber(message) {
    const matched = String(message || '').match(/^Pedido:\s*(PED[0-9]{7}[A-Z])\s*$/m);
    return matched ? matched[1] : '';
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

  function finiteTimestamp(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
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
    RECOVERY_KEY,
    RECOVERY_MAX_AGE_MS,
    install,
    createVisualWhatsAppSnapshot,
    normalizeVisualWhatsAppItem,
    createVisualWhatsAppMessage,
    createVisualWhatsAppUrl,
    createVisualWhatsAppRecovery,
    parseVisualWhatsAppRecovery,
    isSafeVisualWhatsAppUrl,
    rememberVisualWhatsAppRecoveryFromMessage,
    readVisualWhatsAppRecovery,
    writeVisualWhatsAppRecovery,
    clearVisualWhatsAppRecovery,
    renderVisualWhatsAppRecovery,
    openRecoveredWhatsApp,
    formatVisualMeasurements
  });
});