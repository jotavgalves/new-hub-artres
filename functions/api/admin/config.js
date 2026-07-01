import { json, loadConfig, saveConfig } from "../_config.js";
import { requireAdmin } from "./_auth.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const loaded = await loadConfig(context.env);
  return json({ ok: true, ...loaded });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  try {
    const body = await context.request.json().catch(() => ({}));
    const config = await saveConfig(context.env, body.config || body);
    return json({ ok: true, config, source: "kv", storageReady: true });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message || error) }, 500);
  }
}
