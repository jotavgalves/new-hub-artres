import { json, loadConfig } from "./_config.js";
import { canAccessOrder, requireAdmin } from "./admin/_auth.js";
import { hydrateOrderNumbers, nextOrderNumber } from "./_order_numbers.js";
import { nextOrderNumberFromSupabase } from "./_supabase_counter.js";
import { listOrdersFromSupabase, saveOrderToSupabase, softDeleteOrderInSupabase, supabaseReady, updateOrderStatusInSupabase } from "./_supabase.js";

const ORDER_PREFIX = "ORDER:";
const DELETED_ORDER_PREFIX = "ORDER_DELETED:";

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context.request, context.env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const url = new URL(context.request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10) || 300, 500);
    const warnings = [];
    let skipped = 0;
    let supabaseOrders = [];
    let kvOrders = [];

    if (supabaseReady(context.env)) {
      try {
        supabaseOrders = await listOrdersFromSupabase(context.env, auth, limit) || [];
      } catch (error) {
        warnings.push({ source: "supabase", error: errorMessage(error) });
      }
    }

    if (context.env.CONFIG_KV) {
      try {
        const loaded = await loadOrdersFromKv(context.env, auth, limit);
        kvOrders = loaded.orders;
        skipped += loaded.skipped;
      } catch (error) {
        warnings.push({ source: "kv", error: errorMessage(error) });
      }
    } else if (!supabaseOrders.length) {
      return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);
    }

    if (!supabaseOrders.length && !kvOrders.length && warnings.length) {
      return json({ ok: false, error: "ORDERS_LIST_FAILED", warnings }, 500);
    }

    const orders = mergeOrders(supabaseOrders, kvOrders);
    orders.sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return json({ ok: true, source: sourceName(supabaseOrders, kvOrders), total: orders.length, skipped, orders, warnings, sessionUser: auth.user });
  } catch (error) {
    return json({ ok: false, error: "ORDERS_LIST_FAILED", detail: errorMessage(error) }, 500);
  }
}

export async function onRequestPost(context) {
  const hasKv = Boolean(context.env.CONFIG_KV);
  const { config } = await loadConfig(context.env);
  if (config.orderSettings && config.orderSettings.saveOrders === false) return json({ ok: true, saved: false, disabled: true });

  const body = await context.request.json().catch(() => ({}));
  const order = await normalizeOrder(body, config, context.env);
  if (!order.items.length) return json({ ok: false, saved: false, error: "CARRINHO_VAZIO_OU_INVALIDO" }, 400);

  let supabaseSaved = false;
  let supabaseError = "";
  let kvSaved = false;
  let kvError = "";

  if (supabaseReady(context.env)) {
    try { await saveOrderToSupabase(context.env, order); supabaseSaved = true; }
    catch (error) { supabaseError = errorMessage(error); }
  }

  if (hasKv) {
    try { await context.env.CONFIG_KV.put(`${ORDER_PREFIX}${order.id}`, JSON.stringify(order, null, 2)); kvSaved = true; }
    catch (error) { kvError = errorMessage(error); }
  }

  if (!supabaseSaved && !kvSaved) return json({ ok: false, saved: false, error: "ORDER_SAVE_FAILED", supabaseError, kvError }, 500);
  return json({ ok: true, saved: true, storage: supabaseSaved && kvSaved ? "supabase+kv" : (supabaseSaved ? "supabase" : "kv"), supabaseSaved, supabaseError, kvSaved, kvError, order });
}

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "ID_OBRIGATORIO" }, 400);
  const status = String(body.status || "Novo");

  if (supabaseReady(context.env)) {
    try {
      const updated = await updateOrderStatusInSupabase(context.env, auth, id, status);
      if (updated) {
        if (context.env.CONFIG_KV) { try { await context.env.CONFIG_KV.put(`${ORDER_PREFIX}${updated.id}`, JSON.stringify(updated, null, 2)); } catch (_) {} }
        return json({ ok: true, source: "supabase", order: updated });
      }
      if (!context.env.CONFIG_KV) return json({ ok: false, error: "PEDIDO_NAO_ENCONTRADO" }, 404);
    } catch (error) {
      if (!context.env.CONFIG_KV) return json({ ok: false, error: "SUPABASE_ORDER_PATCH_FAILED", detail: errorMessage(error) }, 500);
    }
  }

  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);
  const key = `${ORDER_PREFIX}${id}`;
  const raw = await context.env.CONFIG_KV.get(key);
  if (!raw) return json({ ok: false, error: "PEDIDO_NAO_ENCONTRADO" }, 404);
  const order = parseStoredOrder(raw);
  if (!order) return json({ ok: false, error: "PEDIDO_INVALIDO" }, 422);
  if (!canAccessOrder(auth, order)) return json({ ok: false, error: "ACESSO_NEGADO" }, 403);

  order.status = status;
  order.updatedAt = new Date().toISOString();
  await context.env.CONFIG_KV.put(key, JSON.stringify(order, null, 2));
  if (supabaseReady(context.env)) { try { await saveOrderToSupabase(context.env, order); } catch (_) {} }
  return json({ ok: true, source: "kv", order });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (auth.role !== "admin") return json({ ok: false, error: "ACESSO_NEGADO" }, 403);

  const url = new URL(context.request.url);
  let id = String(url.searchParams.get("id") || "").trim();
  if (!id) {
    const body = await context.request.json().catch(() => ({}));
    id = String(body.id || "").trim();
  }
  if (!id) return json({ ok: false, error: "ID_OBRIGATORIO" }, 400);

  if (supabaseReady(context.env)) {
    try {
      const deleted = await softDeleteOrderInSupabase(context.env, id);
      if (deleted && !context.env.CONFIG_KV) return json({ ok: true, source: "supabase", deleted: true, id });
    } catch (error) {
      if (!context.env.CONFIG_KV) return json({ ok: false, error: "SUPABASE_ORDER_DELETE_FAILED", detail: errorMessage(error) }, 500);
    }
  }

  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);
  const key = `${ORDER_PREFIX}${id}`;
  const raw = await context.env.CONFIG_KV.get(key);
  if (!raw) {
    if (supabaseReady(context.env)) return json({ ok: true, source: "supabase", deleted: true, id });
    return json({ ok: false, error: "PEDIDO_NAO_ENCONTRADO" }, 404);
  }

  const order = parseStoredOrder(raw);
  if (!order) return json({ ok: false, error: "PEDIDO_INVALIDO" }, 422);
  order.deletedAt = new Date().toISOString();
  await context.env.CONFIG_KV.put(`${DELETED_ORDER_PREFIX}${id}`, JSON.stringify(order, null, 2));
  await context.env.CONFIG_KV.delete(key);
  return json({ ok: true, source: "kv", deleted: true, id });
}

async function loadOrdersFromKv(env, auth, limit) {
  const listed = await env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit });
  const orders = [];
  let skipped = 0;
  for (const key of listed.keys || []) {
    try {
      const raw = await env.CONFIG_KV.get(key.name);
      if (!raw) { skipped += 1; continue; }
      const order = parseStoredOrder(raw);
      if (order) orders.push(order);
      else skipped += 1;
    } catch (_) {
      skipped += 1;
    }
  }
  try { hydrateOrderNumbers(orders); } catch (_) {}
  return { orders: orders.filter(order => safeCanAccessOrder(auth, order)), skipped };
}

function mergeOrders(primary, fallback) {
  const map = new Map();
  for (const order of [...(Array.isArray(fallback) ? fallback : []), ...(Array.isArray(primary) ? primary : [])]) {
    if (!isOrderObject(order)) continue;
    const key = String(order.orderNumber || order.orderCode || order.displayId || order.id || "").trim();
    if (!key) continue;
    map.set(key, order);
  }
  return [...map.values()];
}

function sourceName(supabaseOrders, kvOrders) {
  if (supabaseOrders.length && kvOrders.length) return "supabase+kv";
  if (supabaseOrders.length) return "supabase";
  return "kv";
}

async function nextOrderNumberSafe(env, createdAt) {
  if (supabaseReady(env)) {
    try {
      const value = await nextOrderNumberFromSupabase(env, createdAt);
      if (value) return value;
    } catch (_) {}
  }
  return nextOrderNumber(env, createdAt);
}

async function normalizeOrder(body, config, env) {
  const createdAt = new Date().toISOString();
  const orderNumber = await nextOrderNumberSafe(env, createdAt);
  const legacyId = `${createdAt.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
  const items = normalizeOrderItems(rawItems);
  const qty = items.reduce((s,i)=>s+(Number(i.qty)||0),0);
  return {
    id: orderNumber,
    orderNumber,
    orderCode: orderNumber,
    displayId: orderNumber,
    legacyId,
    createdAt,
    updatedAt: createdAt,
    status: config.orderSettings && config.orderSettings.defaultStatus || "Novo",
    seller: body.seller || null,
    customer: body.customer || null,
    totals: body.totals || {},
    items,
    qty,
    checkoutIntegrity: {
      rawItems: rawItems.length,
      normalizedItems: items.length,
      rawQty: Number(body.qty || 0) || 0,
      normalizedQty: qty,
      snapshotVersion: Number(body.checkoutSnapshotVersion || 1) || 1
    },
    source: "catalog",
    userAgent: String(contextSafe(body.userAgent || "")).slice(0, 300)
  };
}

function normalizeOrderItems(rawItems) {
  const map = new Map();
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const item = {
      code: cleanCode(raw && raw.code),
      theme: clean(raw && raw.theme),
      product: clean(raw && raw.product),
      productName: clean(raw && raw.productName || raw && raw.product_name),
      qty: Math.max(1, Math.min(999, Number(raw && (raw.qty || raw.quantity) || 1) || 1)),
      image: String(raw && (raw.image || raw.thumbnail) || "").slice(0, 1000)
    };
    if (!item.code) continue;
    const key = itemKey(item);
    if (!key) continue;
    if (map.has(key)) {
      const prev = map.get(key);
      prev.qty = Math.max(prev.qty, item.qty);
      if (!prev.image && item.image) prev.image = item.image;
    } else {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function itemKey(item) { return [item.code, item.theme, item.product, item.productName].map(v => String(v || "").toLowerCase()).join("|"); }
function cleanCode(value) { return String(value || "").replace(/^#/, "").replace(/\s+/g, " ").trim().slice(0, 80); }
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 200); }
function contextSafe(value) { return value == null ? "" : value; }
function parseStoredOrder(raw) {
  try {
    const order = JSON.parse(raw);
    return isOrderObject(order) ? order : null;
  } catch (_) {
    return null;
  }
}
function isOrderObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function safeCanAccessOrder(auth, order) {
  try { return isOrderObject(order) && canAccessOrder(auth, order); }
  catch (_) { return false; }
}
function errorMessage(error) { return String(error && error.message || error || "ERRO_DESCONHECIDO").slice(0, 300); }
