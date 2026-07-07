import { json } from "./_config.js";
import { canAccessOrder, requireAdmin } from "./admin/_auth.js";
import { formatOrderNumber, hydrateOrderNumbers } from "./_order_numbers.js";
import { listOrdersFromSupabase, supabaseReady } from "./_supabase.js";

const ORDER_PREFIX = "ORDER:";
const COUNTER_PREFIX = "ORDER_COUNTER:";

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context.request, context.env);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

    const url = new URL(context.request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10) || 300, 500);
    const warnings = [];
    let supabaseOrders = [];
    let kvOrders = [];
    let skipped = 0;

    if (supabaseReady(context.env)) {
      try {
        supabaseOrders = await listOrdersFromSupabase(context.env, auth, limit) || [];
      } catch (error) {
        warnings.push({ source: "supabase", error: message(error) });
      }
    }

    if (context.env.CONFIG_KV) {
      try {
        const loaded = await loadIndexedKvOrders(context.env, auth, limit);
        kvOrders = loaded.orders;
        skipped += loaded.skipped;
      } catch (error) {
        warnings.push({ source: "kv-index", error: message(error) });
      }
    }

    if (!supabaseOrders.length && !kvOrders.length && warnings.length) {
      return json({ ok: false, error: "ORDERS_INDEXED_FAILED", detail: warnings.map(w => w.source + ': ' + w.error).join(' | '), warnings }, 500);
    }

    const orders = mergeOrders(supabaseOrders, kvOrders);
    orders.sort((a,b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return json({ ok: true, total: orders.length, skipped, source: sourceName(supabaseOrders, kvOrders), orders, warnings, sessionUser: auth.user });
  } catch (error) {
    return json({ ok: false, error: "ORDERS_INDEXED_FAILED", detail: message(error) }, 500);
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
      if (order && safeCanAccessOrder(auth, order)) orders.push(order);
      else skipped += 1;
    } catch (_) { skipped += 1; }
  }

  try { hydrateOrderNumbers(orders); } catch (_) {}
  return { orders, skipped };
}

async function counterOrderIds(env, limit) {
  const out = [];
  const currentYear = new Date().getFullYear();
  for (let year = currentYear; year >= currentYear - 4 && out.length < limit; year--) {
    const yy = String(year).slice(-2);
    const raw = await env.CONFIG_KV.get(`${COUNTER_PREFIX}${yy}`);
    const next = parseInt(raw || "", 10);
    if (!Number.isFinite(next) || next <= 1) continue;
    for (let seq = next - 1; seq >= 1 && out.length < limit; seq--) {
      out.push(formatOrderNumber(yy, seq));
    }
  }
  return out;
}

function mergeOrders(primary, fallback) {
  const map = new Map();
  for (const order of [...(Array.isArray(fallback) ? fallback : []), ...(Array.isArray(primary) ? primary : [])]) {
    if (!order || typeof order !== "object" || Array.isArray(order)) continue;
    const key = String(order.orderNumber || order.orderCode || order.displayId || order.id || "").trim();
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

function parseOrder(raw) {
  try {
    const order = JSON.parse(raw);
    return order && typeof order === "object" && !Array.isArray(order) ? order : null;
  } catch (_) { return null; }
}
function safeCanAccessOrder(auth, order) {
  try { return canAccessOrder(auth, order); }
  catch (_) { return false; }
}
function message(error) { return String(error && error.message || error || "ERRO_DESCONHECIDO").slice(0, 300); }
