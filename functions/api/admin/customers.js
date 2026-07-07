import { json } from "../_config.js";
import { canAccessOrder, requireAdmin } from "./_auth.js";
import { listOrdersFromSupabase, supabaseReady } from "../_supabase.js";

const ORDER_PREFIX = "ORDER:";

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context.request, context.env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    if (supabaseReady(context.env)) {
      try {
        const orders = await listOrdersFromSupabase(context.env, auth, 500);
        const customers = customersFromOrders(orders);
        return json({ ok: true, source: "supabase", total: customers.length, customers, sessionUser: auth.user });
      } catch (error) {
        if (!context.env.CONFIG_KV) return json({ ok: false, error: "SUPABASE_CUSTOMERS_LIST_FAILED", detail: errorMessage(error) }, 500);
      }
    }

    if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);
    const listed = await context.env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit: 300 });
    const orders = [];

    for (const key of listed.keys) {
      const raw = await context.env.CONFIG_KV.get(key.name);
      if (!raw) continue;
      let order;
      try { order = JSON.parse(raw); } catch (_) { continue; }
      if (!isOrderObject(order)) continue;
      if (!canAccessOrder(auth, order)) continue;
      orders.push(order);
    }

    const customers = customersFromOrders(orders);
    return json({ ok: true, source: "kv", total: customers.length, customers, sessionUser: auth.user });
  } catch (error) {
    return json({ ok: false, error: "CUSTOMERS_LIST_FAILED", detail: errorMessage(error) }, 500);
  }
}

function customersFromOrders(orders) {
  const map = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const customer = order.customer || {};
    const phone = digits(customer.whatsapp || customer.phone || order.customer_whatsapp);
    if (!phone) continue;
    const name = upper(customer.name || order.customerName || order.customer_name || "CLIENTE SEM NOME");
    const current = map.get(phone) || {
      id: phone,
      name,
      phone,
      whatsapp: phone,
      ordersCount: 0,
      lastOrderAt: "",
      sellers: [],
      codes: [],
      totalQty: 0,
      totalNet: 0,
      orderIds: []
    };
    current.name = name && name !== "CLIENTE SEM NOME" ? name : current.name;
    current.ordersCount += 1;
    current.totalQty += Number(order.qty || 0);
    current.totalNet += Number(order.totals && (order.totals.net || order.totals.total || order.totals.final) || 0);
    current.orderIds.push(order.id);
    if (String(order.createdAt || order.created_at || "") > String(current.lastOrderAt || "")) current.lastOrderAt = order.createdAt || order.created_at;
    const seller = order.seller && (order.seller.label || order.seller.name || order.seller.id) || order.seller_name;
    if (seller && !current.sellers.includes(seller)) current.sellers.push(seller);
    for (const item of safeItems(order.items)) {
      const code = cleanCode(item.code);
      if (code && !current.codes.includes(code)) current.codes.push(code);
    }
    map.set(phone, current);
  }
  return Array.from(map.values()).sort((a,b) => String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || "")));
}

function digits(value) { return String(value || "").replace(/\D/g, ""); }
function upper(value) { return String(value || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR"); }
function cleanCode(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80); }
function isOrderObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function safeItems(value) { return Array.isArray(value) ? value : []; }
function errorMessage(error) { return String(error && error.message || error || "ERRO_DESCONHECIDO").slice(0, 300); }
