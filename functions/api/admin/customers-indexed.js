import { json } from "../_config.js";
import { canAccessOrder, requireAdmin } from "./_auth.js";
import { formatOrderNumber } from "../_order_numbers.js";
import { listOrdersFromSupabase, supabaseReady } from "../_supabase.js";

const ORDER_PREFIX = "ORDER:";
const COUNTER_PREFIX = "ORDER_COUNTER:";

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context.request, context.env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const warnings = [];
    let supabaseOrders = [];
    let kvOrders = [];
    let skipped = 0;

    if (supabaseReady(context.env)) {
      try {
        supabaseOrders = await listOrdersFromSupabase(context.env, auth, 500) || [];
      } catch (error) {
        warnings.push({ source: "supabase", error: message(error) });
      }
    }

    if (context.env.CONFIG_KV) {
      try {
        const loaded = await loadIndexedKvOrders(context.env, auth, 500);
        kvOrders = loaded.orders;
        skipped += loaded.skipped;
      } catch (error) {
        warnings.push({ source: "kv-index", error: message(error) });
      }
    }

    if (!supabaseOrders.length && !kvOrders.length && warnings.length) {
      return json({ ok: false, error: "CUSTOMERS_INDEXED_FAILED", detail: warnings.map(w => w.source + ": " + w.error).join(" | "), warnings }, 500);
    }

    if (!supabaseOrders.length && !kvOrders.length && !supabaseReady(context.env) && !context.env.CONFIG_KV) {
      return json({ ok: false, error: "SEM_FONTE_DE_PEDIDOS_CONFIGURADA" }, 500);
    }

    const orders = mergeOrders(supabaseOrders, kvOrders);
    const map = new Map();
    for (const order of orders) addCustomer(map, order);

    const customers = Array.from(map.values()).sort((a,b) => String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || "")));
    return json({ ok: true, total: customers.length, skipped, source: sourceName(supabaseOrders, kvOrders), customers, warnings, sessionUser: auth.user });
  } catch (error) {
    return json({ ok: false, error: "CUSTOMERS_INDEXED_FAILED", detail: message(error) }, 500);
  }
}

async function loadIndexedKvOrders(env, auth, limit) {
  const ids = await counterOrderIds(env, limit);
  const orders = [];
  let skipped = 0;
  for (const id of ids) {
    try {
      const raw = await env.CONFIG_KV.get(`${ORDER_PREFIX}${id}`);
      if (!raw) { skipped += 1; continue; }
      const order = parseOrder(raw);
      if (!order || !safeCanAccessOrder(auth, order)) { skipped += 1; continue; }
      orders.push(order);
    } catch (_) { skipped += 1; }
  }
  return { orders, skipped };
}

function mergeOrders(primary, fallback) {
  const map = new Map();
  for (const order of [...(Array.isArray(fallback) ? fallback : []), ...(Array.isArray(primary) ? primary : [])]) {
    if (!order || typeof order !== "object" || Array.isArray(order)) continue;
    const key = String(order.orderNumber || order.orderCode || order.displayId || order.id || order.legacyId || "").trim();
    if (!key) continue;
    map.set(key, order);
  }
  return [...map.values()];
}

function sourceName(supabaseOrders, kvOrders) {
  if (supabaseOrders.length && kvOrders.length) return "supabase+ORDER_COUNTER";
  if (supabaseOrders.length) return "supabase";
  return "ORDER_COUNTER";
}

function addCustomer(map, order) {
  const customer = order.customer || {};
  const phone = digits(customer.whatsapp || customer.phone || order.customer_whatsapp || order.customerPhone);
  if (!phone) return;
  const name = upper(customer.name || order.customerName || order.customer_name || "CLIENTE SEM NOME");
  const current = map.get(phone) || { id: phone, name, phone, whatsapp: phone, ordersCount: 0, lastOrderAt: "", sellers: [], codes: [], totalQty: 0, totalNet: 0, orderIds: [] };
  current.name = name && name !== "CLIENTE SEM NOME" ? name : current.name;
  current.ordersCount += 1;
  current.totalQty += Number(order.qty || 0);
  current.totalNet += Number(order.totals && (order.totals.net || order.totals.total || order.totals.final) || 0);
  const orderId = String(order.orderNumber || order.orderCode || order.displayId || order.id || "").trim();
  if (orderId && !current.orderIds.includes(orderId)) current.orderIds.push(orderId);
  const created = order.createdAt || order.created_at || "";
  if (String(created) > String(current.lastOrderAt || "")) current.lastOrderAt = created;
  const seller = order.seller && (order.seller.label || order.seller.name || order.seller.id) || order.seller_name;
  if (seller && !current.sellers.includes(seller)) current.sellers.push(seller);
  for (const item of (Array.isArray(order.items) ? order.items : [])) {
    const code = cleanCode(item && (item.code || item.id || item.codigo));
    if (code && !current.codes.includes(code)) current.codes.push(code);
  }
  map.set(phone, current);
}

async function counterOrderIds(env, limit) {
  const out = [];
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 4 && out.length < limit; year--) {
    const yy = String(year).slice(-2);
    const raw = await env.CONFIG_KV.get(`${COUNTER_PREFIX}${yy}`);
    const next = parseInt(raw || "", 10);
    if (!Number.isFinite(next) || next <= 1) continue;
    for (let seq = next - 1; seq >= 1 && out.length < limit; seq--) out.push(formatOrderNumber(yy, seq));
  }
  return out;
}
function parseOrder(raw) { try { const order = JSON.parse(raw); return order && typeof order === "object" && !Array.isArray(order) ? order : null; } catch (_) { return null; } }
function safeCanAccessOrder(auth, order) { try { return canAccessOrder(auth, order); } catch (_) { return false; } }
function digits(value) { return String(value || "").replace(/\D/g, ""); }
function upper(value) { return String(value || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR"); }
function cleanCode(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80); }
function message(error) { return String(error && error.message || error || "ERRO_DESCONHECIDO").slice(0, 300); }
