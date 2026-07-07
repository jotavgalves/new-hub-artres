import { json } from "../_config.js";
import { canAccessOrder, requireAdmin } from "./_auth.js";

const ORDER_PREFIX = "ORDER:";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

  const listed = await context.env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit: 300 });
  const map = new Map();

  for (const key of listed.keys) {
    const raw = await context.env.CONFIG_KV.get(key.name);
    if (!raw) continue;
    let order;
    try { order = JSON.parse(raw); } catch (_) { continue; }
    if (!isOrderObject(order)) continue;
    if (!canAccessOrder(auth, order)) continue;

    const customer = order.customer || {};
    const phone = digits(customer.whatsapp || customer.phone);
    if (!phone) continue;
    const name = upper(customer.name || "CLIENTE SEM NOME");
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
    current.totalNet += Number(order.totals && order.totals.net || 0);
    current.orderIds.push(order.id);
    if (String(order.createdAt || "") > String(current.lastOrderAt || "")) current.lastOrderAt = order.createdAt;
    const seller = order.seller && order.seller.label;
    if (seller && !current.sellers.includes(seller)) current.sellers.push(seller);
    for (const item of safeItems(order.items)) {
      const code = cleanCode(item.code);
      if (code && !current.codes.includes(code)) current.codes.push(code);
    }
    map.set(phone, current);
  }

  const customers = Array.from(map.values()).sort((a,b) => String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || "")));
  return json({ ok: true, total: customers.length, customers, sessionUser: auth.user });
}

function digits(value) { return String(value || "").replace(/\D/g, ""); }
function upper(value) { return String(value || "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR"); }
function cleanCode(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80); }
function isOrderObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function safeItems(value) { return Array.isArray(value) ? value : []; }
