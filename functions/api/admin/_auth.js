const COOKIE_NAME = "armazem_admin_session";
const SESSION_MAX_AGE = 60 * 60 * 12;

export function getAdminSecret(env) {
  return String(env && env.ADMIN_SECRET_KEY || "").trim();
}

export async function createSessionCookie(env) {
  const secret = getAdminSecret(env);
  if (!secret) throw new Error("ADMIN_SECRET_KEY_NAO_CONFIGURADA");
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = String(exp);
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

  const [expRaw, sig] = value.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, status: 401, error: "SESSAO_EXPIRADA" };
  }

  const expected = await sign(expRaw, secret);
  if (!timingSafeEqual(sig, expected)) return { ok: false, status: 401, error: "SESSAO_INVALIDA" };

  return { ok: true };
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

function base64url(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
