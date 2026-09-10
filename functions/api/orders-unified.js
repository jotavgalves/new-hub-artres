import { json, loadConfig } from './_config.js';
import { baseIndexParams, readIndex } from './_catalog_index.js';
import { reconcileCartItems } from './reconcile-cart.js';
import { onRequestPost as createLegacyOrder } from './orders.js';

const ROOTS = Object.freeze({
  '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-',
  'painel-romano': '15f6Ge0jZCHSIWMhmEUOs4bfXy9y5U3wk'
});
const IDEMPOTENCY_PREFIX = 'ORDER_UNIFIED_IDEMPOTENCY:';

export async function onRequestPost(context) {
  let cartRepair = { changed:false, migrations:[], removed:[] };
  try {
    const body = await context.request.json().catch(() => ({}));
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
    if (!rawItems.length) return json({ ok:false, error:'CARRINHO_VAZIO_OU_INVALIDO' }, 400);

    const idempotencyKey = cleanIdempotency(context.request.headers.get('Idempotency-Key'));
    if (idempotencyKey && context.env.CONFIG_KV) {
      const replay = await context.env.CONFIG_KV.get(IDEMPOTENCY_PREFIX + idempotencyKey, 'json').catch(() => null);
      if (replay && replay.ok && replay.orderNumber) return json({ ...replay, action:'REPLAY' }, 200);
    }

    const romanRaw = rawItems.filter(item => canonicalProduct(item && (item.productKey || item.product)) === 'painel-romano');
    const standardRaw = rawItems.filter(item => canonicalProduct(item && (item.productKey || item.product)) !== 'painel-romano');

    let standardItems = [];
    if (standardRaw.length) {
      const reconciliation = await reconcileCartItems(context.env, standardRaw);
      cartRepair = normalizeRepair(reconciliation);
      standardItems = normalizeItems(reconciliation.items);
    }
    const romanItems = normalizeItems(romanRaw);
    const requested = mergeItems(standardItems.concat(romanItems));
    if (!requested.length) return json({ ok:false, error:'CARRINHO_ATUALIZADO_SEM_ITENS', cartRepair }, 409);

    const { config } = await loadConfig(context.env);
    const commercial = commercialConfig(config);
    const standardIds = requested.filter(item => item.productKey !== 'painel-romano').map(item => item.driveFileId);
    const rows = await catalogRows(context.env, standardIds);
    const byId = new Map(rows.map(row => [String(row.drive_id || ''), row]));
    const orderItems = [];

    for (const item of requested) {
      const product = commercial.products[item.productKey];
      if (!product || !product.enabled || !(product.unitPrice > 0)) {
        return json({ ok:false, error:'PRODUTO_INDISPONIVEL', productKey:item.productKey, cartRepair }, 422);
      }

      if (item.productKey === 'painel-romano') {
        const art = await romanArtwork(context.env, item.driveFileId);
        if (!art) return json({ ok:false, error:'ARTE_PRODUTO_INCOMPATIVEL', productKey:item.productKey, cartRepair }, 422);
        orderItems.push({
          driveFileId:item.driveFileId,
          code:art.code,
          theme:art.theme,
          product:'painel-romano',
          productKey:'painel-romano',
          productName:product.label,
          qty:item.quantity,
          image:art.image,
          catalogRootDriveId:ROOTS['painel-romano'],
          rootVerified:true,
          size:'1X2',
          sizeKey:'100x200',
          details:{ ...(item.details || {}), size:'1X2', sizeKey:'100x200', width:100, height:200, unit:'cm', fixed:true }
        });
        continue;
      }

      const row = byId.get(item.driveFileId);
      const expectedRoot = ROOTS[item.productKey];
      if (!row || !expectedRoot || String(row.root_drive_id || '') !== expectedRoot) {
        return json({ ok:false, error:'ARTE_PRODUTO_INCOMPATIVEL', productKey:item.productKey, cartRepair }, 422);
      }
      orderItems.push({
        driveFileId:item.driveFileId,
        code:clean(row.code || row.name).replace(/^#/, ''),
        theme:clean(row.theme || 'Sem tema'),
        product:item.productKey,
        productKey:item.productKey,
        productName:product.label,
        qty:item.quantity,
        image:String(row.thumbnail_url || '').slice(0, 1000),
        catalogRootDriveId:expectedRoot,
        rootVerified:true,
        size:item.productKey === 'painel-150' ? '150X150' : '50X50',
        sizeKey:item.productKey === 'painel-150' ? '150x150' : '50x50',
        details:item.details || {}
      });
    }

    const quantityError = validateQuantities(orderItems, commercial.products);
    if (quantityError) return json({ ok:false, error:quantityError, cartRepair }, 422);

    const customer = normalizeCustomer(body.customer);
    if (!customer.name) return json({ ok:false, error:'NOME_CLIENTE_OBRIGATORIO', cartRepair }, 400);
    if (customer.whatsapp.length < 10) return json({ ok:false, error:'WHATSAPP_CLIENTE_INVALIDO', cartRepair }, 400);
    const seller = normalizeSeller(body.seller);
    if (!seller.id || !seller.label) return json({ ok:false, error:'VENDEDORA_OBRIGATORIA', cartRepair }, 400);

    const gross = round(orderItems.reduce((sum, item) => sum + item.qty * commercial.products[item.product].unitPrice, 0));
    const discount = round(gross * commercial.discountPercent / 100);
    const net = round(Math.max(0, gross - discount));
    const totals = { gross, subtotal:gross, discount, discountPercent:commercial.discountPercent, net, total:net, currency:'BRL' };

    const payload = {
      seller,
      customer,
      items:orderItems,
      qty:orderItems.reduce((sum, item) => sum + item.qty, 0),
      totals,
      checkoutSnapshotVersion:commercial.version,
      userAgent:context.request.headers.get('User-Agent') || ''
    };

    const nextRequest = new Request(context.request.url.replace(/\/orders-unified(?:\?.*)?$/, '/orders'), {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Accept:'application/json' },
      body:JSON.stringify(payload)
    });
    const response = await createLegacyOrder({ ...context, request:nextRequest, checkoutConfig:config });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true || !result.order) {
      return json({ ok:false, error:result.error || 'ORDER_SAVE_FAILED', cartRepair }, response.status || 500);
    }

    const orderNumber = String(result.order.orderNumber || result.order.orderCode || result.order.displayId || result.order.id || '').trim();
    const accepted = {
      ok:true,
      saved:true,
      action:'CREATED',
      recovered:false,
      orderNumber,
      order:result.order,
      totals,
      commercialVersion:commercial.version,
      cartRepair
    };
    if (idempotencyKey && context.env.CONFIG_KV) {
      await context.env.CONFIG_KV.put(IDEMPOTENCY_PREFIX + idempotencyKey, JSON.stringify(accepted), { expirationTtl:86400 }).catch(() => {});
    }
    return json(accepted, 201);
  } catch (error) {
    return json({ ok:false, error:'ORDER_UNIFIED_FAILED', detail:String(error && error.message || error || '').slice(0, 220), cartRepair }, 500);
  }
}

async function catalogRows(env, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return [];
  const params = baseIndexParams(200);
  params.set('type', 'eq.artwork');
  params.set('drive_id', 'in.(' + unique.map(id => '"' + id + '"').join(',') + ')');
  return readIndex(env, params);
}

async function romanArtwork(env, fileId) {
  const apiKey = driveApiKey(env);
  if (!apiKey) throw new Error('GOOGLE_DRIVE_API_KEY_NAO_CONFIGURADA');
  const file = await driveFile(apiKey, fileId);
  if (!file || file.trashed || !String(file.mimeType || '').startsWith('image/')) return null;
  let parentId = Array.isArray(file.parents) && file.parents[0] ? String(file.parents[0]) : '';
  const path = [];
  let verified = parentId === ROOTS['painel-romano'];
  for (let depth = 0; parentId && !verified && depth < 12; depth += 1) {
    const folder = await driveFile(apiKey, parentId);
    if (!folder || folder.trashed) break;
    if (String(folder.id || '') === ROOTS['painel-romano']) { verified = true; break; }
    path.unshift(clean(folder.name));
    parentId = Array.isArray(folder.parents) && folder.parents[0] ? String(folder.parents[0]) : '';
    if (parentId === ROOTS['painel-romano']) verified = true;
  }
  if (!verified) return null;
  const name = clean(file.name || 'Sem nome');
  return {
    code:extractCode(name) || clean(file.id).slice(0, 80),
    theme:path[0] || 'Sem tema',
    image:`https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1200`
  };
}

async function driveFile(apiKey, fileId) {
  const id = cleanDriveId(fileId);
  if (!id) return null;
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('fields', 'id,name,mimeType,parents,trashed');
  url.searchParams.set('supportsAllDrives', 'true');
  const response = await fetch(url.toString(), { headers:{ Accept:'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GOOGLE_DRIVE_${response.status}`);
  return response.json();
}

function commercialConfig(config) {
  const products = config && config.products && typeof config.products === 'object' ? config.products : {};
  return {
    version:positive(config && config.commercialVersion, config && config.ui && config.ui.cacheVersion, config && config.version, 1),
    discountPercent:percentage(config && config.ui && config.ui.discountPercent, config && config.campaign && config.campaign.discountPercent, 0),
    products:{
      '50x50':product(products.bolinhas, { label:'Bolinhas 50x50', unitPrice:9.9, minimum:6, step:2, initial:6 }),
      'painel-150':product(products.panel150 || products['painel-150'], { label:'Painel 150 cm', unitPrice:59.9, minimum:1, step:1, initial:1 }),
      'painel-romano':product(products.painelRomano || products['painel-romano'], { label:'Painel Romano 1x2', unitPrice:0, minimum:1, step:1, initial:1 })
    }
  };
}

function product(input, defaults) {
  const raw = input && typeof input === 'object' ? input : {};
  const unitPrice = money(raw.unitPrice, defaults.unitPrice);
  return {
    label:clean(raw.label || defaults.label),
    unitPrice,
    minimum:positive(raw.minQty, raw.minimum, defaults.minimum),
    step:positive(raw.step, defaults.step),
    initial:positive(raw.initialQty, raw.initial, defaults.initial),
    enabled:raw.enabled !== false && unitPrice > 0
  };
}

function validateQuantities(items, products) {
  const bolinhas = items.filter(item => item.product === '50x50').reduce((sum, item) => sum + item.qty, 0);
  if (bolinhas) {
    const rule = products['50x50'];
    if (bolinhas < rule.minimum || (bolinhas - rule.minimum) % rule.step !== 0) return 'QUANTIDADE_BOLINHAS_INVALIDA';
  }
  for (const key of ['painel-150', 'painel-romano']) {
    const rule = products[key];
    for (const item of items.filter(entry => entry.product === key)) {
      if (item.qty < rule.minimum || (item.qty - rule.minimum) % rule.step !== 0) {
        return key === 'painel-romano' ? 'QUANTIDADE_PAINEL_ROMANO_INVALIDA' : 'QUANTIDADE_PAINEL_150_INVALIDA';
      }
    }
  }
  return '';
}

function normalizeItems(items) {
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const driveFileId = cleanDriveId(raw && (raw.driveFileId || raw.id));
    const productKey = canonicalProduct(raw && (raw.productKey || raw.product));
    const quantity = Math.min(999, Math.max(1, Number.parseInt(raw && (raw.quantity || raw.qty), 10) || 0));
    if (!driveFileId || !productKey || !quantity) continue;
    out.push({
      driveFileId,
      productKey,
      quantity,
      sizeKey:clean(raw && (raw.sizeKey || raw.size)).slice(0, 120),
      details:raw && raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details) ? raw.details : {}
    });
  }
  return out;
}

function mergeItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.driveFileId + ':' + item.productKey;
    if (map.has(key)) map.get(key).quantity += item.quantity;
    else map.set(key, { ...item });
  }
  return [...map.values()];
}

function normalizeRepair(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    changed:Boolean(raw.changed),
    migrations:Array.isArray(raw.migrations) ? raw.migrations.slice(0, 200) : [],
    removed:Array.isArray(raw.removed) ? raw.removed.slice(0, 200) : []
  };
}

function canonicalProduct(value) {
  const text = clean(value).toLowerCase();
  if (text === '50x50' || text === 'bolinhas' || text === 'bolinha') return '50x50';
  if (text === 'painel-150' || text === 'painel150' || text === 'painel') return 'painel-150';
  if (text === 'painel-romano' || text === 'painel romano' || text === 'painel-romano-1x2') return 'painel-romano';
  return '';
}
function normalizeCustomer(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const whatsapp = digits(raw.whatsapp || raw.phone).slice(0, 20);
  return { name:clean(raw.name).slice(0, 160), whatsapp, phone:whatsapp };
}
function normalizeSeller(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return { id:clean(raw.id).slice(0, 80), label:clean(raw.label).slice(0, 120) };
}
function extractCode(name) {
  const base = clean(name).replace(/\.[a-z0-9]{2,5}$/i, '');
  const match = base.match(/(?:^|[^0-9])#?([0-9]{2,7})(?:[^0-9]|$)/);
  return match ? match[1] : '';
}
function driveApiKey(env) { return String(env && (env.GOOGLE_API_KEY || env.GOOGLE_DRIVE_API_KEY || env.DRIVE_API_KEY) || '').trim(); }
function cleanDriveId(value) { const text=String(value || '').trim(); return /^[A-Za-z0-9_-]{5,200}$/.test(text) ? text : ''; }
function cleanIdempotency(value) { const text=String(value || '').trim(); return /^[A-Za-z0-9._:-]{16,160}$/.test(text) ? text : ''; }
function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function money(value, fallback) { const parsed=Number(String(value == null ? '' : value).replace(',', '.')); return Number.isFinite(parsed)&&parsed>=0 ? round(parsed) : fallback; }
function positive(...values) { const fallback=Number(values[values.length-1])||1; for (const value of values.slice(0,-1)) { const parsed=Number.parseInt(value,10); if (Number.isFinite(parsed)&&parsed>0) return parsed; } return fallback; }
function percentage(...values) { for (const value of values) { const parsed=Number(String(value == null ? '' : value).replace(',', '.')); if (Number.isFinite(parsed)&&parsed>=0&&parsed<=100) return round(parsed); } return 0; }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
