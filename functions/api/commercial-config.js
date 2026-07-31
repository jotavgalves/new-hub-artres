import { json, loadConfig, saveConfig } from './_config.js';

const ROOTS = Object.freeze({
  '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
});

export async function onRequestGet(context) {
  try {
    const loaded = await loadConfig(context.env);
    const migrated = await ensureProductionProducts(context.env, loaded.config, loaded.storageReady);
    return json({ ok: true, config: publicCommercialConfig(migrated) }, 200, {
      'Cache-Control': 'private, max-age=0, must-revalidate'
    });
  } catch (error) {
    return json({
      ok: false,
      error: 'COMMERCIAL_CONFIG_FAILED',
      detail: String(error && error.message || error || '').slice(0, 200)
    }, 500);
  }
}

async function ensureProductionProducts(env, source, storageReady) {
  const config = clone(source || {});
  config.products = record(config.products);
  const currentPanel = config.products.panel150 || config.products['painel-150'];
  let changed = false;

  if (!currentPanel || typeof currentPanel !== 'object') {
    config.products.panel150 = panelDefaults();
    config.products['painel-150'] = clone(config.products.panel150);
    changed = true;
  } else {
    config.products.panel150 = { ...panelDefaults(), ...currentPanel, productKey: 'painel-150' };
    config.products['painel-150'] = clone(config.products.panel150);
  }

  config.productCatalog = Array.isArray(config.productCatalog) ? config.productCatalog : [];
  if (!config.productCatalog.some(item => item && item.productKey === 'painel-150')) {
    config.productCatalog.push({
      id: 'painel-150',
      label: config.products.panel150.label,
      productKey: 'painel-150',
      active: config.products.panel150.enabled !== false,
      editable: true
    });
    changed = true;
  }

  config.drives = Array.isArray(config.drives) ? config.drives : [];
  const panelDrive = config.drives.find(item => item && item.productKey === 'painel-150');
  if (!panelDrive || panelDrive.folderId !== ROOTS['painel-150']) {
    config.drives = config.drives.filter(item => !item || item.productKey !== 'painel-150');
    config.drives.push({
      id: 'painel-150',
      name: 'Drive Painel 150 cm',
      folderId: ROOTS['painel-150'],
      active: true,
      type: 'painel-150',
      productKey: 'painel-150',
      structure: 'theme-or-subtheme-images',
      filenamePattern: 'ID_TEMA_PRODUTO_DIMENSAO'
    });
    changed = true;
  }

  const bolinhasDrive = config.drives.find(item => item && item.productKey === '50x50');
  if (!bolinhasDrive || bolinhasDrive.folderId !== ROOTS['50x50']) {
    config.drives = config.drives.filter(item => !item || item.productKey !== '50x50');
    config.drives.unshift({
      id: 'bolinhas',
      name: 'Drive Bolinhas',
      folderId: ROOTS['50x50'],
      active: true,
      type: 'bolinhas',
      productKey: '50x50',
      structure: 'theme-or-subtheme-images',
      filenamePattern: 'ID_TEMA_PRODUTO_DIMENSAO'
    });
    changed = true;
  }

  if (!changed || !storageReady) return config;
  config.commercialVersion = positive(config.commercialVersion, config.ui && config.ui.cacheVersion, config.version, 1) + 1;
  config.commercialUpdatedAt = new Date().toISOString();
  config.ui = record(config.ui);
  config.ui.cacheVersion = config.commercialVersion;
  return saveConfig(env, config);
}

function publicCommercialConfig(config) {
  const products = config && config.products && typeof config.products === 'object' ? config.products : {};
  const bolinhas = normalizeProduct(products.bolinhas, {
    key: '50x50',
    label: 'Bolinhas 50x50',
    unitPrice: 9.9,
    minimum: 6,
    step: 2,
    initial: 6,
    scope: 'cart-product-total'
  });
  const panel = normalizeProduct(products.panel150 || products['painel-150'], {
    key: 'painel-150',
    label: 'Painel 150 cm',
    unitPrice: 59.9,
    minimum: 1,
    step: 1,
    initial: 1,
    scope: 'item'
  });
  const discount = percentage(
    config && config.ui && config.ui.discountPercent,
    config && config.campaign && config.campaign.discountPercent,
    0
  );
  const version = positive(
    config && config.commercialVersion,
    config && config.ui && config.ui.cacheVersion,
    config && config.version,
    1
  );
  return {
    schemaVersion: 1,
    version,
    currency: 'BRL',
    effectiveDiscountPercent: discount,
    updatedAt: validDate(config && config.commercialUpdatedAt),
    products: {
      '50x50': bolinhas,
      'painel-150': panel
    },
    protectedRoots: ROOTS
  };
}

function panelDefaults() {
  return {
    label: 'Painel 150 cm',
    productKey: 'painel-150',
    enabled: true,
    unitPrice: 59.9,
    priceLabel: 'R$ 59,90 cada',
    minQty: 1,
    step: 1,
    initialQty: 1,
    disableCustomization: true,
    skipProductsStep: true
  };
}

function normalizeProduct(input, defaults) {
  const raw = input && typeof input === 'object' ? input : {};
  const unitPrice = money(raw.unitPrice, defaults.unitPrice);
  const minimum = positive(raw.minQty, raw.minimum, defaults.minimum);
  const step = positive(raw.step, defaults.step);
  let initial = positive(raw.initialQty, raw.initial, defaults.initial);
  if (initial < minimum) initial = minimum;
  const remainder = (initial - minimum) % step;
  if (remainder) initial += step - remainder;
  return {
    key: defaults.key,
    label: clean(raw.label || defaults.label),
    enabled: raw.enabled !== false && unitPrice > 0,
    unitPrice,
    quantity: {
      minimum,
      step,
      initial,
      scope: defaults.scope
    }
  };
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function clone(value) {
  return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {}));
}
function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}
function money(value, fallback) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}
function positive(...values) {
  const fallback = Number(values[values.length - 1]) || 1;
  for (const value of values.slice(0, -1)) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}
function percentage(...values) {
  for (const value of values) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return Math.round(parsed * 100) / 100;
  }
  return 0;
}
function validDate(value) {
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}
