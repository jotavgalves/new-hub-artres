import { json } from "../_config.js";
import { canAccessOrder, requireAdmin } from "./_auth.js";
import { formatOrderNumber } from "../_order_numbers.js";

const ORDER_PREFIX = "ORDER:";
const COUNTER_PREFIX = "ORDER_COUNTER:";

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context.request, context.env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
    if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

    const ids = await counterOrderIds(context.env, 500);
    const map = new Map();
    let skipped = 0;

    for (const id of ids) {
      try {
        const raw = await context.env.CONFIG_KV.get(`${ORDER_PREFIX}${id}`);
        if (!raw) { skipped += 1; continue; }
        const order = parseOrder(raw);
        if (!order || !safeCanAccessOrder(auth, order)) { skipped += 1; continue; }
        addCustomer(map, order);
      } catch (_) { skipped += 1; }
    }

    const customers = Array.from(map.values()).sort((a,b) => String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || "")));
    return json({ ok: true, total: customers.length, skipped, source: "ORDER_COUNTER", customers, sessionUser: auth.user });
  } catch (error) {
    return json({ ok: false, error: "CUSTOMERS_INDEXED_FAILED", detail: message(error) }, 500);
  }
}

function addCustomer(map, order) {
  const customer = order.customer || {};
  const phone = digits(customer.whatsapp || customer.phone);
  if (!phone) return;
  const name = upper(customer.name || "CLIENTE SEM NOME");
  const current = map.get(phone) || { id: phone, name, phone, whatsapp: phone, ordersCount: 0, lastOrderAt: "", sellers: [], codes: [], totalQty: 0, totalNet: 0, orderIds: [] };
  current.name = name && name !== "CLIENTE SEM NOME" ? name : current.name;
  current.ordersCount += 1;
  current.totalQty += Number(order.qty || 0);
  current.totalNet += Number(order.totals && order.totals.net || 0);
  current.orderIds.push(order.id);
  if (String(order.createdAt || "") > String(current.lastOrderAt || "")) current.lastOrderAt = order.createdAt;
  const seller = order.seller && order.seller.label;
  if (seller && !current.sellers.includes(seller)) current.sellers.push(seller);
  for (const item of (Array.isArray(order.items) ? order.items : [])) {
    const code = cleanCode(item.code);
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
