import { loadConfig } from "../_config.js";
import { hydrateOrderNumbers } from "../_order_numbers.js";

export const ORDER_PREFIX = "ORDER:";
const DEFAULT_STATUSES = ["Novo", "Em atendimento", "Em produção", "Separado", "Fechado", "Cancelado"];

export async function loadProductionConfig(env) {
  const { config } = await loadConfig(env);
  return { config, production: normalizeProductionApi(config.productionApi || {}) };
}

export function normalizeProductionApi(input = {}) {
  return {
    enabled: input.enabled !== false,
    allowStatusUpdate: input.allowStatusUpdate !== false,
    statusOnFetch: clean(input.statusOnFetch || ""),
    statusOnComplete: clean(input.statusOnComplete || "Separado"),
    actorName: clean(input.actorName || "Armazem"),
    exposeCustomer: input.exposeCustomer !== false,
    exposeTotals: input.exposeTotals !== false
  };
}

export function desktopToken(env) {
  return String(env && (env.ARMAZEM_DESKTOP_TOKEN || env.DESKTOP_APP_TOKEN || env.PRODUCTION_API_TOKEN) || "").trim();
}

export async function requireDesktopToken(request, env) {
  const configured = desktopToken(env);
  if (!configured) return { ok: false, status: 500, error: "TOKEN_DO_APP_NAO_CONFIGURADO" };
  const header = String(request.headers.get("authorization") || "");
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  const token = (bearer && bearer[1] || request.headers.get("x-armazem-token") || "").trim();
  if (!token || token !== configured) return { ok: false, status: 401, error: "TOKEN_INVALIDO" };
  return { ok: true };
}

export async function findOrderByNumber(env, number) {
  if (!env.CONFIG_KV) return { order: null, key: "", error: "CONFIG_KV_NAO_CONFIGURADO" };
  const wanted = clean(number).toUpperCase();
  if (!wanted) return { order: null, key: "", error: "NUMERO_OBRIGATORIO" };

  const exactRaw = await env.CONFIG_KV.get(`${ORDER_PREFIX}${wanted}`);
  if (exactRaw) {
    try {
      const order = JSON.parse(exactRaw);
      hydrateOrderNumbers([order]);
      return { order, key: `${ORDER_PREFIX}${wanted}` };
    } catch (_) {}
  }

  const orders = [];
  let cursor = undefined;
  do {
    const listed = await env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit: 1000, cursor });
    for (const item of listed.keys || []) {
      const raw = await env.CONFIG_KV.get(item.name);
      if (!raw) continue;
      try { orders.push({ order: JSON.parse(raw), key: item.name }); } catch (_) {}
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);

  hydrateOrderNumbers(orders.map(x => x.order));
  const hit = orders.find(x => orderMatches(x.order, wanted));
  return hit || { order: null, key: "", error: "PEDIDO_NAO_ENCONTRADO" };
}

export function buildProductionPayload(order, config = {}) {
  const production = normalizeProductionApi(config.productionApi || {});
  const items = normalizeItems(order.items || []);
  const customer = production.exposeCustomer ? (order.customer || null) : null;
  const totals = production.exposeTotals ? (order.totals || {}) : {};
  const orderNumber = order.orderNumber || order.orderCode || order.displayId || order.id;
  return {
    ok: true,
    orderNumber,
    id: order.id,
    status: order.status || "Novo",
    createdAt: order.createdAt || "",
    updatedAt: order.updatedAt || "",
    customer,
    seller: order.seller || null,
    totals,
    qty: Number(order.qty || items.reduce((s, i) => s + (Number(i.qty) || 0), 0)),
    items,
    codes: unique(items.map(i => i.code).filter(Boolean)),
    codesText: unique(items.map(i => i.code).filter(Boolean)).join("\n"),
    folderName: folderSafe(`${orderNumber} - ${customer && customer.name || "Cliente"}`)
  };
}

export async function updateOrderProductionStatus(env, found, status, actorName, message = "") {
  if (!found || !found.order || !found.key) return null;
  const order = found.order;
  const at = new Date().toISOString();
  order.status = clean(status || order.status || "Em produção") || "Em produção";
  order.updatedAt = at;
  order.production = {
    ...(order.production || {}),
    lastAppUpdateAt: at,
    lastAppActor: actorName || "Armazem",
    lastAppStatus: order.status
  };
  order.events = Array.isArray(order.events) ? order.events.slice(-80) : [];
  order.events.push({ at, by: actorName || "Armazem", type: "production-status", status: order.status, message: clean(message) });
  await env.CONFIG_KV.put(found.key, JSON.stringify(order, null, 2));
  return order;
}

export function jsonCors(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Armazem-Token",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Armazem-Token" } });
}

export function productionStatuses(config = {}) {
  const list = Array.isArray(config.orderSettings && config.orderSettings.statuses) ? config.orderSettings.statuses : [];
  return unique([...list, ...DEFAULT_STATUSES]).filter(Boolean);
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(item => ({
    code: cleanCode(item.code || item.codigo || item.id),
    theme: clean(item.theme || item.tema),
    product: clean(item.product || item.productName || item.produto),
    productName: clean(item.productName || item.product || item.produto),
    qty: Number(item.qty || item.quantity || item.quantidade || 1) || 1,
    image: String(item.image || item.thumbnail || "").slice(0, 1000)
  })).filter(item => item.code);
}
function orderMatches(order, wanted) {
  return [order.id, order.orderNumber, order.orderCode, order.displayId, order.legacyId]
    .map(v => clean(v).toUpperCase())
    .includes(wanted);
}
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function cleanCode(value) { return String(value || "").replace(/\D/g, "").trim(); }
function unique(list) { return [...new Set((list || []).map(x => clean(x)).filter(Boolean))]; }
function folderSafe(value) { return clean(value).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120); }
