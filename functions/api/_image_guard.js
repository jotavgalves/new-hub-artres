const TOKEN_VERSION = 'v1';
const KEY_CACHE = new WeakMap();
const TOKEN_CACHE = new Map();

export async function sealMediaId(env, rawId) {
  const id = cleanDriveId(rawId);
  if (!id) throw new Error('MEDIA_ID_INVALIDO');
  const cached = TOKEN_CACHE.get(id);
  if (cached) return cached;

  const key = await encryptionKey(env);
  const iv = await deterministicIv(key, id);
  const plain = new TextEncoder().encode(id);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plain));
  const token = TOKEN_VERSION + '.' + base64url(joinBytes(iv, encrypted));
  if (TOKEN_CACHE.size > 4000) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(id, token);
  return token;
}

export async function openMediaId(env, token) {
  const value = String(token || '').trim();
  if (!value.startsWith(TOKEN_VERSION + '.')) throw new Error('MEDIA_TOKEN_INVALIDO');
  const raw = fromBase64url(value.slice(TOKEN_VERSION.length + 1));
  if (raw.length < 29) throw new Error('MEDIA_TOKEN_INVALIDO');
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  const key = await encryptionKey(env);
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, cipher);
  const id = cleanDriveId(new TextDecoder().decode(plain));
  if (!id) throw new Error('MEDIA_ID_INVALIDO');
  return id;
}

export function extractDriveId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^[A-Za-z0-9_-]{20,128}$/.test(raw)) return raw;
  try {
    const url = new URL(raw, 'https://local.invalid');
    const queryId = cleanDriveId(url.searchParams.get('id') || '');
    if (queryId) return queryId;
    const match = url.pathname.match(/\/d\/([A-Za-z0-9_-]{20,128})/);
    if (match) return cleanDriveId(match[1]);
  } catch (_) {}
  const fallback = raw.match(/(?:id=|\/d\/)([A-Za-z0-9_-]{20,128})/);
  return fallback ? cleanDriveId(fallback[1]) : '';
}

function cleanDriveId(value) {
  const id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{20,128}$/.test(id) ? id : '';
}

async function encryptionKey(env) {
  if (env && typeof env === 'object' && KEY_CACHE.has(env)) return KEY_CACHE.get(env);
  const promise = createKey(env);
  if (env && typeof env === 'object') KEY_CACHE.set(env, promise);
  return promise;
}

async function createKey(env) {
  const direct = String(env && (env.IMAGE_ROUTE_SECRET || env.MEDIA_ROUTE_SECRET || env.ADMIN_SECRET || env.ADMIN_PASSWORD || env.GOOGLE_API_KEY || env.GOOGLE_DRIVE_API_KEY || env.DRIVE_API_KEY) || '').trim();
  let material = direct;

  if (!material && env && env.CONFIG_KV) {
    const keyName = 'MEDIA_ROUTE_SECRET_V1';
    material = String(await env.CONFIG_KV.get(keyName) || '').trim();
    if (!material) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const generated = base64url(bytes);
      await env.CONFIG_KV.put(keyName, generated);
      material = String(await env.CONFIG_KV.get(keyName) || generated).trim();
    }
  }

  if (!material) throw new Error('MEDIA_ROUTE_SECRET_NAO_CONFIGURADO');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('armazem-media-route-v1:' + material));
  return crypto.subtle.importKey('raw', digest, { name:'AES-GCM' }, false, ['encrypt','decrypt']);
}

async function deterministicIv(key, id) {
  const raw = await crypto.subtle.exportKey ? null : null;
  // O IV precisa ser estável para que a mesma arte mantenha a mesma URL durante a navegação.
  // Derivamos 96 bits a partir do identificador usando SHA-256 e um namespace separado.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('armazem-media-iv-v1:' + id)));
  return digest.slice(0, 12);
}

function joinBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(value || '').length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
