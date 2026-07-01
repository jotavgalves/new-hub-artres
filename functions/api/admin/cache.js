import { json, loadConfig, saveConfig } from "../_config.js";
import { requireAdmin } from "./_auth.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { config } = await loadConfig(context.env);
  config.ui = config.ui || {};
  config.ui.cacheVersion = Number(config.ui.cacheVersion || 1) + 1;
  const saved = await saveConfig(context.env, config);
  return json({ ok: true, cacheVersion: saved.ui.cacheVersion, config: saved });
}
