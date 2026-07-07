import { json } from "../_config.js";
import { requireRole } from "./_auth.js";
import { saveOrderToSupabase, supabaseReady } from "../_supabase.js";

const ORDER_PREFIX = "ORDER:";

export async function onRequestPost(context) {
  const auth = await requireRole(context.request, context.env, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!supabaseReady(context.env)) return json({ ok: false, error: "SUPABASE_ENV_NAO_CONFIGURADO" }, 500);
  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

  const url = new URL(context.request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "300", 10) || 300, 500);
  const listed = await context.env.CONFIG_KV.list({ prefix: ORDER_PREFIX, limit });

  let migrated = 0;
  let skipped = 0;
  const errors = [];

  for (const key of listed.keys) {
    try {
      const raw = await context.env.CONFIG_KV.get(key.name);
      if (!raw) { skipped += 1; continue; }
      const order = JSON.parse(raw);
      if (!order || typeof order !== "object" || Array.isArray(order)) { skipped += 1; continue; }
      await saveOrderToSupabase(context.env, order);
      migrated += 1;
    } catch (error) {
      errors.push({ key: key.name, error: String(error && error.message || error).slice(0, 240) });
    }
  }

  return json({ ok: errors.length === 0, migrated, skipped, errors: errors.slice(0, 20), totalErrors: errors.length });
}
