import { json, loadConfig, saveConfig } from "../_config.js";
import { hashPassword, normalizeUsers, requireRole, safeUser, sanitizeUsers } from "./_auth.js";

export async function onRequestGet(context) {
  const auth = await requireRole(context.request, context.env, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const { config, storageReady } = await loadConfig(context.env);
  return json({
    ok: true,
    storageReady,
    users: sanitizeUsers(config.permissions && config.permissions.users),
    sellers: config.sellers || [],
    roles: ["vendedora"]
  });
}

export async function onRequestPost(context) {
  const auth = await requireRole(context.request, context.env, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const now = new Date().toISOString();
  const { config } = await loadConfig(context.env);
  const users = normalizeUsers(config.permissions && config.permissions.users);

  const username = sanitizeId(body.username || body.login || body.id);
  const id = sanitizeId(body.id || username);
  const name = clean(body.name || body.label || username);
  const sellerId = sanitizeId(body.sellerId || body.seller || username);
  const active = body.active !== false;
  const password = String(body.password || "").trim();

  if (!id || !username || !name) return json({ ok: false, error: "USUARIO_OBRIGATORIO" }, 400);
  if (username === "admin" || id === "admin") return json({ ok: false, error: "ADMIN_EH_USUARIO_RESERVADO" }, 400);
  if (!sellerId) return json({ ok: false, error: "VENDEDORA_OBRIGATORIA" }, 400);

  const existingIndex = users.findIndex(u => u.id === id || u.username === username);
  const existing = existingIndex >= 0 ? users[existingIndex] : null;
  if (!existing && !password) return json({ ok: false, error: "SENHA_OBRIGATORIA" }, 400);

  const user = {
    id,
    username,
    name,
    role: "vendedora",
    sellerId,
    active,
    passwordHash: password ? await hashPassword(password) : existing.passwordHash,
    createdAt: existing && existing.createdAt || now,
    updatedAt: now
  };

  if (existingIndex >= 0) users[existingIndex] = user;
  else users.push(user);

  config.permissions = {
    ...(config.permissions || {}),
    mode: "users",
    roles: ["admin", "vendedora"],
    users
  };

  const saved = await saveConfig(context.env, config);
  const savedUser = normalizeUsers(saved.permissions && saved.permissions.users).find(u => u.id === user.id);
  return json({ ok: true, user: safeUser(savedUser), users: sanitizeUsers(saved.permissions && saved.permissions.users) });
}

export async function onRequestDelete(context) {
  const auth = await requireRole(context.request, context.env, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(context.request.url);
  const body = await context.request.json().catch(() => ({}));
  const id = sanitizeId(url.searchParams.get("id") || body.id || body.username);
  if (!id || id === "admin") return json({ ok: false, error: "USUARIO_INVALIDO" }, 400);

  const { config } = await loadConfig(context.env);
  const users = normalizeUsers(config.permissions && config.permissions.users).filter(u => u.id !== id && u.username !== id);
  config.permissions = {
    ...(config.permissions || {}),
    mode: "users",
    roles: ["admin", "vendedora"],
    users
  };

  const saved = await saveConfig(context.env, config);
  return json({ ok: true, deleted: true, id, users: sanitizeUsers(saved.permissions && saved.permissions.users) });
}

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120); }
function sanitizeId(value) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
