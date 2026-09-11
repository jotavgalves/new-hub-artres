import { json, loadConfig, saveConfig } from './_config.js';

const ROOTS = Object.freeze({
  '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-',
  'painel-romano': '15f6Ge0jZCHSIWMhmEUOs4bfXy9y5U3wk',
  'retangular-1x2': '1fB01auWnc01DEy2EJfGK62l0MCgQLpXu'
});

const RECTANGULAR_PRICE_MIGRATION = 'retangular-price-78-v1';
const ROMAN_PRICE_MIGRATION = 'roman-price-78-v1';

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
  config.migrations = record(config.migrations);
  const currentPanel = config.products.panel150 || config.products['painel-150'];
  const currentRoman = config.products.painelRomano || config.products['painel-romano'];
  const currentRectangular = config.products.retangular1x2 || config.products['retangular-1x2'];
  let changed = false;

  if (!currentPanel || typeof currentPanel !== 'object') {
    config.products.panel150 = panelDefaults();
    config.products['painel-150'] = clone(config.products.panel150);
    changed = true;
  } else {
    config.products.panel150 = { ...panelDefaults(), ...currentPanel, productKey: 'painel-150' };
    config.products['painel-150'] = clone(config.products.panel150);
  }

  if (!currentRoman || typeof currentRoman !== 'object') {
    config.products.painelRomano = panelRomanDefaults();
    config.products['painel-romano'] = clone(config.products.painelRomano);
    changed = true;
  } else {
    config.products.painelRomano = { ...panelRomanDefaults(), ...currentRoman, productKey: 'painel-romano' };
    config.products['painel-romano'] = clone(config.products.painelRomano);
  }

  if (!currentRectangular || typeof currentRectangular !== 'object') {
    config.products.retangular1x2 = rectangularDefaults();
    config.products['retangular-1x2'] = clone(config.products.retangular1x2);
    changed = true;
  } else {
    const oldLabel = clean(currentRectangular.label || '');
    const legacyLabels = new Set(['', 'Retangular 1x2', 'Painel Retangular 1x2']);
    const normalizedLabel = legacyLabels.has(oldLabel) ? 'Painel Retangular' : oldLabel;
    config.products.retangular1x2 = { ...rectangularDefaults(), ...currentRectangular, label: normalizedLabel, productKey: 'retangular-1x2', catalogReady: true };
    config.products['retangular-1x2'] = clone(config.products.retangular1x2);
    if (currentRectangular.catalogReady !== true || normalizedLabel !== oldLabel) changed = true;
  }

  if (config.migrations[RECTANGULAR_PRICE_MIGRATION] !== true) {
    const rectangular = config.products.retangular1x2;
    if (!(Number(rectangular.unitPrice) > 0)) {
      rectangular.unitPrice = 78;
      rectangular.enabled = true;
      rectangular.priceLabel = 'R$ 78,00 cada';
      config.products['retangular-1x2'] = clone(rectangular);
    }
    config.migrations[RECTANGULAR_PRICE_MIGRATION] = true;
    changed = true;
  }

  if (config.migrations[ROMAN_PRICE_MIGRATION] !== true) {
    const roman = config.products.painelRomano;
    roman.unitPrice = 78;
    roman.enabled = true;
    roman.priceLabel = 'R$ 78,00 cada';
    config.products['painel-romano'] = clone(roman);
    config.migrations[ROMAN_PRICE_MIGRATION] = true;
    changed = true;
  }

  config.productCatalog = Array.isArray(config.productCatalog) ? config.productCatalog : [];
  if (!config.productCatalog.some(item => item && item.productKey === 'painel-150')) {
    config.productCatalog.push({ id:'painel-150', label:config.products.panel150.label, productKey:'painel-150', active:config.products.panel150.enabled !== false, editable:true });
    changed = true;
  }
  const romanCatalog = config.productCatalog.find(item => item && item.productKey === 'painel-romano');
  const desiredRomanCatalog = { id:'painel-romano', label:config.products.painelRomano.label, productKey:'painel-romano', active:config.products.painelRomano.enabled !== false, editable:true };
  if (!romanCatalog || romanCatalog.label !== desiredRomanCatalog.label || romanCatalog.active !== desiredRomanCatalog.active) {
    config.productCatalog = config.productCatalog.filter(item => !item || item.productKey !== 'painel-romano');
    config.productCatalog.push(desiredRomanCatalog);
    changed = true;
  }
  const rectangularCatalog = config.productCatalog.find(item => item && item.productKey === 'retangular-1x2');
  const desiredRectangularCatalog = { id:'retangular-1x2', label:config.products.retangular1x2.label, productKey:'retangular-1x2', active:config.products.retangular1x2.enabled !== false, editable:true, catalogReady:true };
  if (!rectangularCatalog || rectangularCatalog.label !== desiredRectangularCatalog.label || rectangularCatalog.active !== desiredRectangularCatalog.active || rectangularCatalog.catalogReady !== true) {
    config.productCatalog = config.productCatalog.filter(item => !item || item.productKey !== 'retangular-1x2');
    config.productCatalog.push(desiredRectangularCatalog);
    changed = true;
  }

  config.drives = Array.isArray(config.drives) ? config.drives : [];
  const panelDrive = config.drives.find(item => item && item.productKey === 'painel-150');
  if (!panelDrive || panelDrive.folderId !== ROOTS['painel-150']) {
    config.drives = config.drives.filter(item => !item || item.productKey !== 'painel-150');
    config.drives.push({ id:'painel-150', name:'Drive Painel 150 cm', folderId:ROOTS['painel-150'], active:true, type:'painel-150', productKey:'painel-150', structure:'theme-or-subtheme-images', filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO' });
    changed = true;
  }

  const romanDrive = config.drives.find(item => item && item.productKey === 'painel-romano');
  if (!romanDrive || romanDrive.folderId !== ROOTS['painel-romano']) {
    config.drives = config.drives.filter(item => !item || item.productKey !== 'painel-romano');
    config.drives.push({ id:'painel-romano', name:'Drive Painel Romano 1x2', folderId:ROOTS['painel-romano'], active:true, type:'painel-romano', productKey:'painel-romano', structure:'theme-or-subtheme-images', filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO' });
    changed = true;
  }

  const rectangularDrive = config.drives.find(item => item && item.productKey === 'retangular-1x2');
  if (!rectangularDrive || rectangularDrive.folderId !== ROOTS['retangular-1x2'] || rectangularDrive.name !== 'Drive Painel Retangular') {
    config.drives = config.drives.filter(item => !item || item.productKey !== 'retangular-1x2');
    config.drives.push({ id:'retangular-1x2', name:'Drive Painel Retangular', folderId:ROOTS['retangular-1x2'], active:true, type:'retangular-1x2', productKey:'retangular-1x2', structure:'theme-or-subtheme-images', filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO' });
    changed = true;
  }

  const bolinhasDrive = config.drives.find(item => item && item.productKey === '50x50');
  if (!bolinhasDrive || bolinhasDrive.folderId !== ROOTS['50x50']) {
    config.drives = config.drives.filter(item => !item || item.productKey !== '50x50');
    config.drives.unshift({ id:'bolinhas', name:'Drive Bolinhas', folderId:ROOTS['50x50'], active:true, type:'bolinhas', productKey:'50x50', structure:'theme-or-subtheme-images', filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO' });
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
  const bolinhas = normalizeProduct(products.bolinhas, { key:'50x50', label:'Bolinhas 50x50', unitPrice:9.9, minimum:6, step:2, initial:6, scope:'cart-product-total' });
  const panel = normalizeProduct(products.panel150 || products['painel-150'], { key:'painel-150', label:'Painel 150 cm', unitPrice:59.9, minimum:1, step:1, initial:1, scope:'item' });
  const roman = normalizeProduct(products.painelRomano || products['painel-romano'], { key:'painel-romano', label:'Painel Romano 1x2', unitPrice:78, minimum:1, step:1, initial:1, scope:'item' });
  const rectangularBase = normalizeProduct(products.retangular1x2 || products['retangular-1x2'], { key:'retangular-1x2', label:'Painel Retangular', unitPrice:78, minimum:1, step:1, initial:1, scope:'item' });
  const rectangular = { ...rectangularBase, catalogReady:true, size:'1X2', sizeKey:'100x200' };
  const discount = percentage(config && config.ui && config.ui.discountPercent, config && config.campaign && config.campaign.discountPercent, 0);
  const version = positive(config && config.commercialVersion, config && config.ui && config.ui.cacheVersion, config && config.version, 1);
  return {
    schemaVersion:1,
    version,
    currency:'BRL',
    effectiveDiscountPercent:discount,
    updatedAt:validDate(config && config.commercialUpdatedAt),
    products:{ '50x50':bolinhas, 'painel-150':panel, 'painel-romano':roman, 'retangular-1x2':rectangular },
    protectedRoots:ROOTS
  };
}

function panelDefaults() {
  return { label:'Painel 150 cm', productKey:'painel-150', enabled:true, unitPrice:59.9, priceLabel:'R$ 59,90 cada', minQty:1, step:1, initialQty:1, disableCustomization:true, skipProductsStep:true };
}
function panelRomanDefaults() {
  return { label:'Painel Romano 1x2', productKey:'painel-romano', enabled:true, unitPrice:78, priceLabel:'R$ 78,00 cada', minQty:1, step:1, initialQty:1, disableCustomization:true, skipProductsStep:true, fixedSize:'1X2', sizeKey:'100x200' };
}
function rectangularDefaults() {
  return { label:'Painel Retangular', productKey:'retangular-1x2', enabled:true, unitPrice:78, priceLabel:'R$ 78,00 cada', minQty:1, step:1, initialQty:1, disableCustomization:true, skipProductsStep:true, fixedSize:'1X2', sizeKey:'100x200', catalogReady:true };
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
  return { key:defaults.key, label:clean(raw.label || defaults.label), enabled:raw.enabled !== false && unitPrice > 0, unitPrice, quantity:{ minimum, step, initial, scope:defaults.scope } };
}

function record(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) { return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {})); }
function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120); }
function money(value, fallback) { const parsed = Number(String(value ?? '').replace(',', '.')); return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback; }
function positive(...values) { const fallback = Number(values[values.length - 1]) || 1; for (const value of values.slice(0, -1)) { const parsed = Number.parseInt(value, 10); if (Number.isFinite(parsed) && parsed > 0) return parsed; } return fallback; }
function percentage(...values) { for (const value of values) { const parsed = Number(String(value ?? '').replace(',', '.')); if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return Math.round(parsed * 100) / 100; } return 0; }
function validDate(value) { const parsed = new Date(String(value || '')); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString(); }
