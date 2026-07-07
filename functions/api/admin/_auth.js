import { loadConfig } from "../_config.js";

const COOKIE_NAME = "armazem_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 12;
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_ALGO = "pbkdf2_sha256";

export function getAdminSecret(env) {
  return String(env && env.ADMIN_SECRET_KEY || "").trim();
}

export async function createSessionCookie(env, user = adminUser()) {
  const secret = getAdminSecret(env);
  if (!secret) throw new Error("ADMIN_SECRET_KEY_NAO_CONFIGURADA");

  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const session = sanitizeSessionUser({ ...user, exp });
  const payload = encodeJson(session);
  const sig = await sign(payload, secret);
  return `${COOKIE_NAME}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function requireAdmin(request, env) {
  const secret = getAdminSecret(env);
  if (!secret) return { ok: false, status: 500, error: "ADMIN_SECRET_KEY_NAO_CONFIGURADA" };

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const value = cookies[COOKIE_NAME];
  if (!value || !value.includes(".")) return { ok: false, status: 401, error: "NAO_AUTENTICADO" };

  const idx = value.lastIndexOf(".");
  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = await sign(payload, secret);
  if (!timingSafeEqual(sig, expected)) return { ok: false, status: 401, error: "SESSAO_INVALIDA" };

  const session = parseSessionPayload(payload);
  if (!session || !Number.isFinite(Number(session.exp)) || Number(session.exp) < Math.floor(Date.now() / 1000)) {
    return { ok: false, status: 401, error: "SESSAO_EXPIRADA" };
  }

  const user = sanitizeSessionUser(session);
  return { ok: true, user, role: user.role, sellerId: user.sellerId, isAdmin: user.role === "admin" };
}

export async function requireRole(request, env, roles = ["admin"]) {
  const auth = await requireAdmin(request, env);
  if (!auth.ok) return auth;
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(auth.role)) {
    return { ok: false, status: 403, error: "ACESSO_NEGADO", user: auth.user, role: auth.role, sellerId: auth.sellerId };
  }
  return auth;
}

export async function authenticateUser(env, username, password) {
  const secret = getAdminSecret(env);
  if (!secret) return { ok: false, status: 500, error: "ADMIN_SECRET_KEY_NAO_CONFIGURADA" };

  const login = clean(username || "admin").toLowerCase();
  const pass = String(password || "").trim();
  if (!pass) return { ok: false, status: 401, error: "SENHA_INVALIDA" };

  if (login === "admin") {
    if (pass !== secret) return { ok: false, status: 401, error: "SENHA_INVALIDA" };
    return { ok: true, user: adminUser() };
  }

  const { config } = await loadConfig(env);
  const users = normalizeUsers(config.permissions && config.permissions.users);
  const user = users.find(u => u.active !== false && [u.username, u.id].map(x => clean(x).toLowerCase()).includes(login));
  if (!user) return { ok: false, status: 401, error: "USUARIO_OU_SENHA_INVALIDOS" };
  const verified = await verifyPassword(pass, user.passwordHash || "");
  if (!verified) return { ok: false, status: 401, error: "USUARIO_OU_SENHA_INVALIDOS" };
  return { ok: true, user: safeUser(user) };
}

export function adminUser() {
  return { id: "admin", userId: "admin", username: "admin", name: "Admin", role: "admin", sellerId: "" };
}

export function safeUser(user = {}) {
  return sanitizeSessionUser(user);
}

export function sanitizeUsers(users = []) {
  return normalizeUsers(users).map(safeUser);
}

export function normalizeUsers(users = []) {
  return (Array.isArray(users) ? users : [])
    .map((user, index) => {
      const id = sanitizeId(user.id || user.username || `usuario-${index + 1}`);
      const username = sanitizeId(user.username || id);
      const role = clean(user.role || "vendedora").toLowerCase() === "admin" ? "admin" : "vendedora";
      const sellerId = role === "admin" ? "" : sanitizeId(user.sellerId || user.seller || username);
      return {
        id,
        username,
        name: clean(user.name || user.label || username),
        role,
        sellerId,
        active: user.active !== false,
        passwordHash: clean(user.passwordHash || user.hash || ""),
        createdAt: clean(user.createdAt || ""),
        updatedAt: clean(user.updatedAt || "")
      };
    })
    .filter(user => user.id && user.username && user.name && user.role && (user.role === "admin" || user.sellerId));
}

export async function hashPassword(password) {
  const pass = String(password || "");
  if (pass.length < 4) throw new Error("SENHA_MUITO_CURTA");
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = base64url(saltBytes.buffer);
  const hash = await pbkdf2(pass, salt, PASSWORD_ITERATIONS);
  return `${PASSWORD_ALGO}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export async function verifyPassword(password, storedHash) {
  const value = clean(storedHash);
  const parts = value.split("$");
  if (parts.length !== 4 || parts[0] !== PASSWORD_ALGO) return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isFinite(iterations) || !salt || !expected) return false;
  const actual = await pbkdf2(String(password || ""), salt, iterations);
  return timingSafeEqual(actual, expected);
}

export function canAccessOrder(auth, order) {
  if (!auth || !auth.ok) return false;
  if (auth.role === "admin") return true;
  if (auth.role !== "vendedora" || !auth.sellerId) return false;
  const seller = order && order.seller || {};
  const wanted = sanitizeId(auth.sellerId);
  return [seller.id, seller.sellerId, seller.username, seller.label, seller.name]
    .map(sanitizeId)
    .filter(Boolean)
    .includes(wanted);
}

export function filterOrdersForUser(auth, orders = []) {
  return (Array.isArray(orders) ? orders : []).filter(order => canAccessOrder(auth, order));
}

async function pbkdf2(password, salt, iterations) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations }, key, 256);
  return base64url(bits);
}

async function sign(value, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buffer = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return base64url(buffer);
}

function parseSessionPayload(payload) {
  const legacyExp = Number(payload);
  if (Number.isFinite(legacyExp)) return { ...adminUser(), exp: legacyExp };
  try { return JSON.parse(decodeJson(payload)); }
  catch (_) { return null; }
}

function sanitizeSessionUser(user = {}) {
  const role = clean(user.role || "admin").toLowerCase() === "vendedora" ? "vendedora" : "admin";
  const id = sanitizeId(user.userId || user.id || user.username || (role === "admin" ? "admin" : "vendedora"));
  return {
    id,
    userId: id,
    username: sanitizeId(user.username || id),
    name: clean(user.name || (role === "admin" ? "Admin" : id)),
    role,
    sellerId: role === "admin" ? "" : sanitizeId(user.sellerId || user.seller || id),
    exp: Number(user.exp) || undefined
  };
}

function encodeJson(value) {
  return base64url(new TextEncoder().encode(JSON.stringify(value)).buffer);
}

function decodeJson(value) {
  const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64url(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseCookies(header) {
  const out = {};
  header.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function sanitizeId(value) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
