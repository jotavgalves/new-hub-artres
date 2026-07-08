import { json, loadConfig, saveConfig } from "../_config.js";
import { supabaseReady, supabaseRequest } from "../_supabase.js";
import { hashPassword, normalizeUsers, requireRole, safeUser } from "./_auth.js";

export async function onRequestGet(context) {
  const auth = await requireRole(context.request, context.env, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const { config, storageReady } = await loadConfig(context.env);
  const migrated = await migrateKvUsersToSupabase(context.env, config);
  const users = await listUsers(context.env, config);

  return json({
    ok: true,
    storageReady,
    supabaseReady: supabaseReady(context.env),
    migrated,
    users: users.map(publicUser),
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
  await migrateKvUsersToSupabase(context.env, config);

  const username = sanitizeId(body.username || body.login || body.id);
  const id = sanitizeId(body.id || username);
  const name = clean(body.name || body.label || username);
  const sellerId = sanitizeId(body.sellerId || body.seller || username);
  const active = body.active !== false;
  const password = String(body.password || "").trim();

  if (!id || !username || !name) return json({ ok: false, error: "USUARIO_OBRIGATORIO" }, 400);
  if (username === "admin" || id === "admin") return json({ ok: false, error: "ADMIN_EH_USUARIO_RESERVADO" }, 400);
  if (!sellerId) return json({ ok: false, error: "VENDEDORA_OBRIGATORIA" }, 400);

  const users = await listUsers(context.env, config);
  const existing = users.find(u => u.id === id || u.username === username);
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

  await upsertUser(context.env, user);
  await ensureConfigMode(context.env, config);
  const savedUsers = await listUsers(context.env, config);
  return json({ ok: true, user: safeUser(user), users: savedUsers.map(publicUser), source: supabaseReady(context.env) ? "supabase" : "kv" });
}

export async function onRequestDelete(context) {
  const auth = await requireRole(context.request, context.env, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(context.request.url);
  const body = await context.request.json().catch(() => ({}));
  const id = sanitizeId(url.searchParams.get("id") || body.id || body.username);
  if (!id || id === "admin") return json({ ok: false, error: "USUARIO_INVALIDO" }, 400);

  const { config } = await loadConfig(context.env);
  await migrateKvUsersToSupabase(context.env, config);
  await deleteUser(context.env, config, id);
  const users = await listUsers(context.env, config);
  return json({ ok: true, deleted: true, id, users: users.map(publicUser), source: supabaseReady(context.env) ? "supabase" : "kv" });
}

async function listUsers(env, config) {
  if (!supabaseReady(env)) return normalizeUsers(config.permissions && config.permissions.users);
  const rows = await supabaseRequest(env, "/staff_users?select=*&order=name.asc");
  return (Array.isArray(rows) ? rows : []).map(userFromRow);
}

async function upsertUser(env, user) {
  if (!supabaseReady(env)) throw new Error("SUPABASE_ENV_NAO_CONFIGURADO");
  await supabaseRequest(env, "/staff_users?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: rowFromUser(user)
  });
}

async function deleteUser(env, config, id) {
  if (!supabaseReady(env)) throw new Error("SUPABASE_ENV_NAO_CONFIGURADO");
  await supabaseRequest(env, `/staff_users?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function migrateKvUsersToSupabase(env, config) {
  if (!supabaseReady(env)) return false;
  const legacy = normalizeUsers(config.permissions && config.permissions.users).filter(u => u.id !== "admin" && u.username !== "admin");
  if (!legacy.length) return false;
  const current = await listUsers(env, { permissions: { users: [] } });
  const known = new Set(current.flatMap(u => [u.id, u.username]));
  const missing = legacy.filter(u => !known.has(u.id) && !known.has(u.username));
  if (!missing.length) return false;
  await supabaseRequest(env, "/staff_users?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: missing.map(rowFromUser)
  });
  return true;
}

async function ensureConfigMode(env, config) {
  config.permissions = {
    ...(config.permissions || {}),
    mode: "users",
    roles: ["admin", "vendedora"],
    users: []
  };
  try { await saveConfig(env, config); } catch (_) {}
}

function rowFromUser(user) {
  return {
    id: sanitizeId(user.id || user.username),
    username: sanitizeId(user.username || user.id),
    name: clean(user.name || user.username || user.id),
    role: user.role === "admin" ? "admin" : "vendedora",
    seller_id: sanitizeId(user.sellerId || user.seller || user.username || user.id),
    active: user.active !== false,
    password_hash: String(user.passwordHash || ""),
    created_at: user.createdAt || new Date().toISOString(),
    updated_at: user.updatedAt || new Date().toISOString()
  };
}

function userFromRow(row = {}) {
  return {
    id: sanitizeId(row.id),
    username: sanitizeId(row.username || row.id),
    name: clean(row.name || row.username || row.id),
    role: row.role === "admin" ? "admin" : "vendedora",
    sellerId: sanitizeId(row.seller_id || row.sellerId || row.username || row.id),
    active: row.active !== false,
    passwordHash: clean(row.password_hash || row.passwordHash || ""),
    createdAt: clean(row.created_at || row.createdAt || ""),
    updatedAt: clean(row.updated_at || row.updatedAt || "")
  };
}

function publicUser(user = {}) {
  return {
    id: sanitizeId(user.id || user.username),
    username: sanitizeId(user.username || user.id),
    name: clean(user.name || user.username || user.id),
    role: user.role === "admin" ? "admin" : "vendedora",
    sellerId: sanitizeId(user.sellerId || user.seller || user.username || user.id),
    active: user.active !== false,
    createdAt: clean(user.createdAt || ""),
    updatedAt: clean(user.updatedAt || "")
  };
}

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120); }
function sanitizeId(value) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
