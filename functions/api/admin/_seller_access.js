import { loadConfig } from "../_config.js";
import { getAdminSecret } from "./_auth.js";

const COOKIE_NAME = "armazem_seller_session";
const SESSION_PREFIX = "SELLER_SESSION:";
const SESSION_TTL = 60 * 60 * 12;
const ITER = 120000;

export function adminUser() { return { id:"admin", username:"admin", name:"Admin", role:"admin", sellerId:"" }; }

export async function loginPanelUser(env, username, password) {
  const secret = getAdminSecret(env);
  if (!secret) return { ok:false, status:500, error:"ADMIN_SECRET_KEY_NAO_CONFIGURADA" };
  const login = norm(username || "admin");
  const pass = String(password || "").trim();
  if (!pass) return { ok:false, status:401, error:"SENHA_INVALIDA" };
  if (login === "admin") return pass === secret ? { ok:true, user:adminUser() } : { ok:false, status:401, error:"SENHA_INVALIDA" };
  const { config } = await loadConfig(env);
  const users = normalizeUsers(config.permissions && config.permissions.users);
  const user = users.find(u => u.active !== false && (u.username === login || u.id === login));
  if (!user || !(await checkPass(pass, user.passwordHash))) return { ok:false, status:401, error:"USUARIO_OU_SENHA_INVALIDOS" };
  return { ok:true, user:publicUser(user) };
}

export async function createSellerCookie(env, user) {
  if (!env.CONFIG_KV || !user || user.role !== "vendedora") return clearSellerCookie();
  const id = crypto.randomUUID();
  await env.CONFIG_KV.put(SESSION_PREFIX + id, JSON.stringify({ ...publicUser(user), exp: Date.now() + SESSION_TTL * 1000 }), { expirationTtl: SESSION_TTL });
  return `${COOKIE_NAME}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

export function clearSellerCookie() { return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

export async function currentPanelUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const sid = String(cookies[COOKIE_NAME] || "").trim();
  if (!sid || !env.CONFIG_KV) return adminUser();
  const raw = await env.CONFIG_KV.get(SESSION_PREFIX + sid);
  if (!raw) return adminUser();
  try { const user = JSON.parse(raw); return user && user.exp > Date.now() ? publicUser(user) : adminUser(); }
  catch (_) { return adminUser(); }
}

export async function requireMaster(request, env) {
  const user = await currentPanelUser(request, env);
  if (user.role !== "admin") return { ok:false, status:403, error:"ACESSO_NEGADO", user };
  return { ok:true, user };
}

export function publicUser(user) {
  const role = norm(user.role) === "admin" ? "admin" : "vendedora";
  const id = norm(user.id || user.username || (role === "admin" ? "admin" : "vendedora"));
  return { id, username:norm(user.username || id), name:clean(user.name || id), role, sellerId:role === "admin" ? "" : norm(user.sellerId || id) };
}
export function publicUsers(users) { return normalizeUsers(users).map(publicUser); }
export function normalizeUsers(users) { return (Array.isArray(users) ? users : []).map((u,i)=>({ id:norm(u.id||u.username||`usuario-${i+1}`), username:norm(u.username||u.id||`usuario-${i+1}`), name:clean(u.name||u.label||u.username||u.id), role:"vendedora", sellerId:norm(u.sellerId||u.seller||u.username||u.id), active:u.active!==false, passwordHash:clean(u.passwordHash||""), createdAt:clean(u.createdAt||""), updatedAt:clean(u.updatedAt||"") })).filter(u=>u.id&&u.username&&u.name&&u.sellerId); }

export async function makePass(password) {
  const pass = String(password || "");
  if (pass.length < 4) throw new Error("SENHA_MUITO_CURTA");
  const salt = crypto.randomUUID().replace(/-/g, "");
  const hash = await digest(pass, salt, ITER);
  return `pbkdf2:${ITER}:${salt}:${hash}`;
}
async function checkPass(password, stored) { const p = clean(stored).split(":"); if (p.length !== 4 || p[0] !== "pbkdf2") return false; return (await digest(String(password||""), p[2], parseInt(p[1],10))) === p[3]; }
async function digest(password, salt, iter) { const enc = new TextEncoder(); const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]); const bits = await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt:enc.encode(salt), iterations:iter }, key, 256); return Array.from(new Uint8Array(bits)).map(b=>b.toString(16).padStart(2,"0")).join(""); }

export function canSeeOrder(user, order) { if (!user || user.role === "admin") return true; const seller = order && order.seller || {}; const want = norm(user.sellerId); return [seller.id, seller.sellerId, seller.username, seller.label, seller.name].map(norm).includes(want); }
export function filterOrders(user, orders) { return (Array.isArray(orders) ? orders : []).filter(o => canSeeOrder(user, o)); }
function parseCookies(header) { const out={}; header.split(";").forEach(p=>{ const i=p.indexOf("="); if(i>-1) out[p.slice(0,i).trim()] = p.slice(i+1).trim(); }); return out; }
function clean(v){ return String(v||"").replace(/\s+/g," ").trim(); }
function norm(v){ return clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,""); }
