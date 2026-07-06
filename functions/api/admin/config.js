import { json, loadConfig, saveConfig } from "../_config.js";
import { requireAdmin, sanitizeUsers } from "./_auth.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const loaded = await loadConfig(context.env);
  return json({ ok: true, ...publicLoaded(loaded, auth) });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (auth.role !== "admin") return json({ ok: false, error: "ACESSO_NEGADO" }, 403);

  try {
    const body = await context.request.json().catch(() => ({}));
    const incoming = body.config || body;
    const current = await loadConfig(context.env);
    const protectedIncoming = protectUserStore(incoming, current.config || {});
    const config = await saveConfig(context.env, deepMerge(current.config || {}, protectedIncoming || {}));
    return json({ ok: true, ...publicLoaded({ config, source: "kv", storageReady: true }, auth) });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message || error) }, 500);
  }
}

function publicLoaded(loaded, auth) {
  const config = clone(loaded.config || {});
  config.permissions = config.permissions || {};
  config.permissions.users = auth.role === "admin" ? sanitizeUsers(config.permissions.users || []) : [];
  return { ...loaded, config, sessionUser: auth.user };
}

function protectUserStore(incoming, currentConfig) {
  const out = clone(incoming || {});
  if (out.permissions && Object.prototype.hasOwnProperty.call(out.permissions, "users")) {
    out.permissions.users = currentConfig.permissions && currentConfig.permissions.users || [];
  }
  return out;
}

function deepMerge(target, source) {
  const out = clone(target || {});
  const src = source && typeof source === "object" ? source : {};
  Object.keys(src).forEach(key => {
    if (Array.isArray(src[key])) out[key] = clone(src[key]);
    else if (src[key] && typeof src[key] === "object" && out[key] && typeof out[key] === "object" && !Array.isArray(src[key])) out[key] = deepMerge(out[key], src[key]);
    else out[key] = src[key];
  });
  return out;
}
function clone(value) { return JSON.parse(JSON.stringify(value || {})); }
