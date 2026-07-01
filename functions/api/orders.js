import { json, loadConfig } from "./_config.js";
import { requireAdmin } from "./admin/_auth.js";

const ORDER_PREFIX = "ORDER:";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 300);
  const listed = await context.env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit });
  const orders = [];
  for (const key of listed.keys) {
    const raw = await context.env.CONFIG_KV.get(key.name);
    if (!raw) continue;
    try { orders.push(JSON.parse(raw)); } catch (_) {}
  }
  orders.sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return json({ ok: true, total: orders.length, orders });
}

export async function onRequestPost(context) {
  if (!context.env.CONFIG_KV) return json({ ok: true, saved: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 200);
  const { config } = await loadConfig(context.env);
  if (config.orderSettings && config.orderSettings.saveOrders === false) return json({ ok: true, saved: false, disabled: true });

  const body = await context.request.json().catch(() => ({}));
  const order = normalizeOrder(body, config);
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
  const order = JSON.parse(raw);
  order.status = String(body.status || order.status || "Novo");
  order.updatedAt = new Date().toISOString();
  await context.env.CONFIG_KV.put(key, JSON.stringify(order, null, 2));
  return json({ ok: true, order });
}

function normalizeOrder(body, config) {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[^0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}`;
  const items = Array.isArray(body.items) ? body.items.slice(0, 200).map(item => ({
    code: clean(item.code),
    theme: clean(item.theme),
    product: clean(item.product),
    productName: clean(item.productName),
    qty: Number(item.qty || item.quantity || 1),
    image: String(item.image || item.thumbnail || "").slice(0, 1000)
  })) : [];
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    status: config.orderSettings && config.orderSettings.defaultStatus || "Novo",
    seller: body.seller || null,
    totals: body.totals || {},
    items,
    qty: Number(body.qty || items.reduce((s,i)=>s+(Number(i.qty)||0),0)),
    source: "catalog",
    userAgent: String(contextSafe(body.userAgent || "")).slice(0, 300)
  };
}
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 200); }
function contextSafe(value) { return value == null ? "" : value; }
