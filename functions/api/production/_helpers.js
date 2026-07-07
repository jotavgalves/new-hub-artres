import { loadConfig } from "../_config.js";
import { hydrateOrderNumbers } from "../_order_numbers.js";
import { findOrderInSupabase, saveOrderToSupabase, supabaseReady } from "../_supabase.js";

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
  const wanted = clean(number).toUpperCase();
  if (!wanted) return { order: null, key: "", error: "NUMERO_OBRIGATORIO" };

  if (supabaseReady(env)) {
    try {
      const order = await findOrderInSupabase(env, wanted);
      if (order) return { order, key: `SUPABASE:${order.id}`, source: "supabase" };
    } catch (_) {}
  }

  if (!env.CONFIG_KV) return { order: null, key: "", error: "CONFIG_KV_NAO_CONFIGURADO" };

  const exactRaw = await env.CONFIG_KV.get(`${ORDER_PREFIX}${wanted}`);
  if (exactRaw) {
    try {
      const order = JSON.parse(exactRaw);
      hydrateOrderNumbers([order]);
      return { order, key: `${ORDER_PREFIX}${wanted}`, source: "kv" };
    } catch (_) {}
  }

  const orders = [];
  let cursor = undefined;
  do {
    const listed = await env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit: 1000, cursor });
    for (const item of listed.keys || []) {
      const raw = await env.CONFIG_KV.get(item.name);
      if (!raw) continue;
      try { orders.push({ order: JSON.parse(raw), key: item.name, source: "kv" }); } catch (_) {}
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);

  hydrateOrderNumbers(orders.map(x => x.order));
  const hit = orders.find(x => orderMatches(x.order, wanted));
  return hit || { order: null, key: "", error: "PEDIDO_NAO_ENCONTRADO" };
}

export function buildProductionPayload(order) {
  const items = normalizeItems(order.items || []);
  const customer = order.customer || {};
  const seller = order.seller || {};
  const orderNumber = order.orderNumber || order.orderCode || order.displayId || order.id;
  return {
    ok: true,
    orderNumber,
    customerName: clean(customer.name || customer.nome || ""),
    createdAt: order.createdAt || "",
    createdAtFormatted: formatDate(order.createdAt),
    sellerName: clean(seller.label || seller.name || seller.nome || ""),
    items: items.map(item => ({ id: item.id, quantity: item.quantity }))
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

  if (found.source === "supabase" || String(found.key).startsWith("SUPABASE:")) {
    await saveOrderToSupabase(env, order);
    return order;
  }

  await env.CONFIG_KV.put(found.key, JSON.stringify(order, null, 2));
  if (supabaseReady(env)) { try { await saveOrderToSupabase(env, order); } catch (_) {} }
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
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach(item => {
    const id = cleanCode(item.code || item.codigo || item.id);
    if (!id) return;
    const qty = Number(item.qty || item.quantity || item.quantidade || 1) || 1;
    map.set(id, (map.get(id) || 0) + qty);
  });
  return [...map.entries()].map(([id, quantity]) => ({ id, quantity }));
}
function orderMatches(order, wanted) {
  return [order.id, order.orderNumber, order.orderCode, order.displayId, order.legacyId]
    .map(v => clean(v).toUpperCase())
    .includes(wanted);
}
function formatDate(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Recife" }); }
  catch (_) { return clean(value); }
}
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function cleanCode(value) { return String(value || "").replace(/\D/g, "").trim(); }
function unique(list) { return [...new Set((list || []).map(x => clean(x)).filter(Boolean))]; }
