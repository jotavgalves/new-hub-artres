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
    const incoming = body.config || body;
    const current = await loadConfig(context.env);
    const config = await saveConfig(context.env, deepMerge(current.config || {}, incoming || {}));
    return json({ ok: true, config, source: "kv", storageReady: true });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message || error) }, 500);
  }
}

function deepMerge(target, source) {
  const out = clone(target || {});
  const src = source && typeof source === "object" ? source : {};
  Object.keys(src).forEach(key => {
    if (Array.isArray(src[key])) out[key] = clone(src[key]);
    else if (src[key] && typeof src[key] === "object" && out[key] && typeof out[key] === "object" && !Array.isArray(out[key])) out[key] = deepMerge(out[key], src[key]);
    else out[key] = src[key];
  });
  return out;
}
function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
