import { json, loadConfig } from './_config.js';
import { baseIndexParams, readIndex } from './_catalog_index.js';
import { orderFromRow, supabaseReady, supabaseRequest } from './_supabase.js';
import { onRequestPost as createLegacyOrder } from './orders.js';

const ROOTS = Object.freeze({
  '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
});
const IDEMPOTENCY_PREFIX = 'ORDER_V2_IDEMPOTENCY:';
const ORDER_PREFIX = 'ORDER:';
const MAX_RECOVERY_ORDERS = 500;

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    if (!rawItems.length) return json({ ok: false, error: 'CARRINHO_VAZIO_OU_INVALIDO' }, 400);

    const idempotencyKey = cleanIdempotency(context.request.headers.get('Idempotency-Key'));
    if (idempotencyKey && context.env.CONFIG_KV) {
      const replay = await context.env.CONFIG_KV.get(IDEMPOTENCY_PREFIX + idempotencyKey, 'json').catch(() => null);
      if (replay && replay.ok && replay.orderNumber) return json({ ...replay, action: 'REPLAY' }, 200);
    }

    if (idempotencyKey) {
      const recoveredOrder = await findOrderByCheckoutReference(context.env, idempotencyKey);
      if (recoveredOrder) {
        const recovered = acceptedFromOrder(recoveredOrder, 'REPLAY', true);
        if (context.env.CONFIG_KV) {
          await context.env.CONFIG_KV.put(
            IDEMPOTENCY_PREFIX + idempotencyKey,
            JSON.stringify(recovered),
            { expirationTtl: 86400 }
          ).catch(() => {});
        }
        return json(recovered, 200);
      }
    }

    const { config } = await loadConfig(context.env);
    const commercial = commercialConfig(config);
    const normalized = normalizeRequestedItems(rawItems);
    if (!normalized.length) return json({ ok: false, error: 'CARRINHO_VAZIO_OU_INVALIDO' }, 400);

    const rows = await catalogRows(context.env, normalized.map(item => item.driveFileId));
    const rowById = new Map(rows.map(row => [String(row.drive_id || ''), row]));
    const orderItems = [];

    for (const item of normalized) {
      const row = rowById.get(item.driveFileId);
      if (!row) return json({ ok: false, error: 'ARTE_NAO_ENCONTRADA' }, 422);
      const expectedRoot = ROOTS[item.productKey];
      if (!expectedRoot || String(row.root_drive_id || '') !== expectedRoot) {
        return json({ ok: false, error: 'ARTE_PRODUTO_INCOMPATIVEL' }, 422);
      }
      const product = commercial.products[item.productKey];
      if (!product || !product.enabled) return json({ ok: false, error: 'PRODUTO_INDISPONIVEL' }, 422);
      orderItems.push({
        driveFileId: item.driveFileId,
        code: clean(row.code || row.name).replace(/^#/, ''),
        theme: clean(row.theme || 'Sem tema'),
        product: item.productKey,
        productName: product.label,
        qty: item.quantity,
        image: String(row.thumbnail_url || '').slice(0, 1000),
        catalogRootDriveId: expectedRoot,
        rootVerified: true,
        size: item.productKey === 'painel-150' ? '150X150' : '50X50'
      });
    }

    const quantityError = validateQuantities(orderItems, commercial.products);
    if (quantityError) return json({ ok: false, error: quantityError }, 422);

    const gross = round(orderItems.reduce((sum, item) => sum + item.qty * commercial.products[item.product].unitPrice, 0));
    const discount = round(gross * commercial.discountPercent / 100);
    const net = round(Math.max(0, gross - discount));
    const customer = normalizeCustomer(body.customer);
    if (!customer.name) return json({ ok: false, error: 'NOME_CLIENTE_OBRIGATORIO' }, 400);
    if (customer.whatsapp.length < 10) return json({ ok: false, error: 'WHATSAPP_CLIENTE_INVALIDO' }, 400);
    const seller = normalizeSeller(body.seller);
    if (!seller.id || !seller.label) return json({ ok: false, error: 'VENDEDORA_OBRIGATORIA' }, 400);

    const storedCustomer = idempotencyKey
      ? { ...customer, checkoutReference: idempotencyKey }
      : customer;
    const payload = {
      seller,
      customer: storedCustomer,
      items: orderItems,
      qty: orderItems.reduce((sum, item) => sum + item.qty, 0),
      totals: {
        gross,
        subtotal: gross,
        discount,
        discountPercent: commercial.discountPercent,
        net,
        total: net,
        currency: 'BRL'
      },
      checkoutSnapshotVersion: commercial.version,
      userAgent: context.request.headers.get('User-Agent') || ''
    };

    const nextRequest = new Request(context.request.url.replace(/\/orders-v2(?:\?.*)?$/, '/orders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    const response = await createLegacyOrder({ ...context, request: nextRequest });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true || !result.order) {
      return json({ ok: false, error: result.error || 'ORDER_SAVE_FAILED' }, response.status || 500);
    }

    const accepted = acceptedFromOrder({
      ...result.order,
      customer
    }, 'CREATED', false, commercial.version, payload.totals);
    if (idempotencyKey && context.env.CONFIG_KV) {
      await context.env.CONFIG_KV.put(
        IDEMPOTENCY_PREFIX + idempotencyKey,
        JSON.stringify(accepted),
        { expirationTtl: 86400 }
      ).catch(() => {});
    }
    return json(accepted, 201);
  } catch (error) {
    return json({
      ok: false,
      error: 'ORDER_V2_FAILED'
    }, 500);
  }
}

async function findOrderByCheckoutReference(env, reference) {
  const wanted = cleanIdempotency(reference);
  if (!wanted) return null;

  if (supabaseReady(env)) {
    try {
      const rows = await supabaseRequest(
        env,
        `/orders?select=*,order_items(*)&deleted_at=is.null&raw->customer->>checkoutReference=eq.${encodeURIComponent(wanted)}&order=created_at.desc&limit=1`
      );
      if (Array.isArray(rows) && rows[0]) return orderFromRow(rows[0]);
    } catch (_) {}
  }

  if (!env.CONFIG_KV) return null;
  try {
    const listed = await env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit: MAX_RECOVERY_ORDERS });
    for (const entry of listed.keys || []) {
      const order = await env.CONFIG_KV.get(entry.name, 'json').catch(() => null);
      if (cleanIdempotency(order?.customer?.checkoutReference) === wanted) return order;
    }
  } catch (_) {}
  return null;
}

function acceptedFromOrder(order, action, recovered = false, commercialVersion, authoritativeTotals) {
  const orderNumber = String(order?.orderNumber || order?.orderCode || order?.displayId || order?.id || '').trim();
  const customer = normalizeCustomer(order?.customer);
  const publicOrder = {
    ...order,
    customer
  };
  return {
    ok: true,
    saved: true,
    action,
    recovered,
    orderNumber,
    order: publicOrder,
    totals: authoritativeTotals || order?.totals || {},
    commercialVersion: positive(commercialVersion, order?.checkoutIntegrity?.snapshotVersion, 1)
  };
}

async function catalogRows(env, ids) {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 200) return [];
  const params = baseIndexParams(200);
  params.set('type', 'eq.artwork');
  params.set('drive_id', 'in.(' + unique.map(id => '"' + id + '"').join(',') + ')');
  return readIndex(env, params);
}

function normalizeRequestedItems(items) {
  const map = new Map();
  for (const raw of items) {
    const driveFileId = cleanDriveId(raw && (raw.driveFileId || raw.id));
    const productKey = canonicalProduct(raw && (raw.productKey || raw.product));
    const quantity = Math.min(999, Math.max(1, Number.parseInt(raw && (raw.quantity || raw.qty), 10) || 0));
    if (!driveFileId || !productKey || !quantity) continue;
    const key = driveFileId + ':' + productKey;
    if (map.has(key)) map.get(key).quantity += quantity;
    else map.set(key, { driveFileId, productKey, quantity });
  }
  return [...map.values()];
}

function validateQuantities(items, products) {
  const bolinhas = items.filter(item => item.product === '50x50').reduce((sum, item) => sum + item.qty, 0);
  if (bolinhas) {
    const rule = products['50x50'];
    if (bolinhas < rule.minimum || (bolinhas - rule.minimum) % rule.step !== 0) return 'QUANTIDADE_BOLINHAS_INVALIDA';
  }
  for (const item of items.filter(item => item.product === 'painel-150')) {
    const rule = products['painel-150'];
    if (item.qty < rule.minimum || (item.qty - rule.minimum) % rule.step !== 0) return 'QUANTIDADE_PAINEL_150_INVALIDA';
  }
  return '';
}

function commercialConfig(config) {
  const products = config && config.products && typeof config.products === 'object' ? config.products : {};
  return {
    version: positive(config && config.commercialVersion, config && config.ui && config.ui.cacheVersion, config && config.version, 1),
    discountPercent: percentage(config && config.ui && config.ui.discountPercent, 0),
    products: {
      '50x50': product(products.bolinhas, {
        label: 'Bolinhas 50x50', unitPrice: 9.9, minimum: 6, step: 2, initial: 6, enabled: true
      }),
      'painel-150': product(products.panel150 || products['painel-150'], {
        label: 'Painel 150 cm', unitPrice: 0, minimum: 1, step: 1, initial: 1, enabled: false
      })
    }
  };
}

function product(input, defaults) {
  const raw = input && typeof input === 'object' ? input : {};
  const unitPrice = money(raw.unitPrice, defaults.unitPrice);
  return {
    label: clean(raw.label || defaults.label),
    unitPrice,
    minimum: positive(raw.minQty, raw.minimum, defaults.minimum),
    step: positive(raw.step, defaults.step),
    initial: positive(raw.initialQty, raw.initial, defaults.initial),
    enabled: raw.enabled !== false && (defaults.enabled || unitPrice > 0)
  };
}

function normalizeCustomer(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    name: clean(raw.name).slice(0, 160),
    whatsapp: digits(raw.whatsapp || raw.phone).slice(0, 20),
    phone: digits(raw.whatsapp || raw.phone).slice(0, 20)
  };
}
function normalizeSeller(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return { id: clean(raw.id).slice(0, 80), label: clean(raw.label).slice(0, 120) };
}
function canonicalProduct(value) {
  const text = clean(value).toLowerCase();
  if (text === '50x50' || text === 'bolinhas' || text === 'bolinha') return '50x50';
  if (text === 'painel-150' || text === 'painel150' || text === 'painel') return 'painel-150';
  return '';
}
function cleanDriveId(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_-]{5,200}$/.test(text) ? text : '';
}
function cleanIdempotency(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{16,160}$/.test(text) ? text : '';
}
function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function money(value, fallback) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? round(parsed) : fallback;
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
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return round(parsed);
  }
  return 0;
}
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }