import { json, loadConfig } from './_config.js';

export async function onRequestGet(context) {
  try {
    const { config } = await loadConfig(context.env);
    return json({ ok: true, config: publicCommercialConfig(config) }, 200, {
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

function publicCommercialConfig(config) {
  const products = config && config.products && typeof config.products === 'object' ? config.products : {};
  const bolinhas = normalizeProduct(products.bolinhas, {
    key: '50x50',
    label: 'Bolinhas 50x50',
    unitPrice: 9.9,
    minimum: 6,
    step: 2,
    initial: 6,
    scope: 'cart-product-total',
    enabled: true
  });
  const panel = normalizeProduct(products.panel150 || products['painel-150'], {
    key: 'painel-150',
    label: 'Painel 150 cm',
    unitPrice: 59.9,
    minimum: 1,
    step: 1,
    initial: 1,
    scope: 'item',
    enabled: true
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
    protectedRoots: {
      '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
      'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
    }
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
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : '1970-01-01T00:00:00.000Z';
}
