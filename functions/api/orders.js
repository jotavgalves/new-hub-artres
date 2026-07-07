import { json, loadConfig } from "./_config.js";
import { canAccessOrder, filterOrdersForUser, requireAdmin } from "./admin/_auth.js";
import { hydrateOrderNumbers, nextOrderNumber } from "./_order_numbers.js";

const ORDER_PREFIX = "ORDER:";
const DELETED_ORDER_PREFIX = "ORDER_DELETED:";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10) || 300, 500);
  const listed = await context.env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit });
  const orders = [];
  for (const key of listed.keys) {
    const raw = await context.env.CONFIG_KV.get(key.name);
    if (!raw) continue;
    const order = parseStoredOrder(raw);
    if (order) orders.push(order);
  }
  hydrateOrderNumbers(orders);
  const visibleOrders = filterOrdersForUser(auth, orders);
  visibleOrders.sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return json({ ok: true, total: visibleOrders.length, orders: visibleOrders, sessionUser: auth.user });
}

export async function onRequestPost(context) {
  if (!context.env.CONFIG_KV) return json({ ok: true, saved: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 200);
  const { config } = await loadConfig(context.env);
  if (config.orderSettings && config.orderSettings.saveOrders === false) return json({ ok: true, saved: false, disabled: true });

  const body = await context.request.json().catch(() => ({}));
  const order = await normalizeOrder(body, config, context.env);
  await context.env.CONFIG_KV.put(`${ORDER_PREFIX}${order.id}`, JSON.stringify(order, null, 2));
  return json({ ok: true, saved: true, order });
}

export async function onRequestPatch(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

  const body = await context.request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "ID_OBRIGATORIO" }, 400);

  const key = `${ORDER_PREFIX}${id}`;
  const raw = await context.env.CONFIG_KV.get(key);
  if (!raw) return json({ ok: false, error: "PEDIDO_NAO_ENCONTRADO" }, 404);
  const order = parseStoredOrder(raw);
  if (!order) return json({ ok: false, error: "PEDIDO_INVALIDO" }, 422);
  if (!canAccessOrder(auth, order)) return json({ ok: false, error: "ACESSO_NEGADO" }, 403);

  order.status = String(body.status || order.status || "Novo");
  order.updatedAt = new Date().toISOString();
  await context.env.CONFIG_KV.put(key, JSON.stringify(order, null, 2));
  return json({ ok: true, order });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (auth.role !== "admin") return json({ ok: false, error: "ACESSO_NEGADO" }, 403);
  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

  const url = new URL(context.request.url);
  let id = String(url.searchParams.get("id") || "").trim();
  if (!id) {
    const body = await context.request.json().catch(() => ({}));
    id = String(body.id || "").trim();
  }
  if (!id) return json({ ok: false, error: "ID_OBRIGATORIO" }, 400);

  const key = `${ORDER_PREFIX}${id}`;
  const raw = await context.env.CONFIG_KV.get(key);
  if (!raw) return json({ ok: false, error: "PEDIDO_NAO_ENCONTRADO" }, 404);

  const order = parseStoredOrder(raw);
  if (!order) return json({ ok: false, error: "PEDIDO_INVALIDO" }, 422);
  order.deletedAt = new Date().toISOString();
  await context.env.CONFIG_KV.put(`${DELETED_ORDER_PREFIX}${id}`, JSON.stringify(order, null, 2));
  await context.env.CONFIG_KV.delete(key);
  return json({ ok: true, deleted: true, id });
}

async function normalizeOrder(body, config, env) {
  const createdAt = new Date().toISOString();
  const orderNumber = await nextOrderNumber(env, createdAt);
  const legacyId = `${createdAt.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
  const items = Array.isArray(body.items) ? body.items.slice(0, 200).map(item => ({
    code: clean(item.code),
    theme: clean(item.theme),
    product: clean(item.product),
    productName: clean(item.productName),
    qty: Number(item.qty || item.quantity || 1),
    image: String(item.image || item.thumbnail || "").slice(0, 1000)
  })) : [];
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
    qty: Number(body.qty || items.reduce((s,i)=>s+(Number(i.qty)||0),0)),
    source: "catalog",
    userAgent: String(contextSafe(body.userAgent || "")).slice(0, 300)
  };
}
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
