import { acceptedCatalogEnabled, acceptedImageSource } from './_accepted_catalog.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
let tokenCache = null;

export async function onRequestGet(context) {
  try {
    if (!acceptedCatalogEnabled(context.env)) return jsonError('CATALOG_IMAGE_NOT_ENABLED', 404);
    const url = new URL(context.request.url);
    const driveFileId = driveIdentity(url.searchParams.get('id'));
    const source = await acceptedImageSource(context.env, driveFileId);

    const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    const cacheKey = new Request(canonicalCacheUrl(url, source), { method: 'GET' });
    if (cache) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const accessToken = await serviceAccountAccessToken(context.env);
    const media = await resolveDriveMedia(source.driveFileId, accessToken);
    const response = await fetchDriveImage(source, media, accessToken);
    const output = await safeImageResponse(response, source, media);
    if (cache) context.waitUntil(cache.put(cacheKey, output.clone()));
    return output;
  } catch (error) {
    const code = publicCode(error && (error.code || error.message), 'CATALOG_IMAGE_FAILED');
    const status = /NOT_FOUND|OUTSIDE_ROOT|ID_INVALID/.test(code) ? 404
      : /NOT_CONFIGURED|SERVICE_ACCOUNT/.test(code) ? 503
        : 502;
    return jsonError(code, status);
  }
}

async function resolveDriveMedia(catalogDriveFileId, accessToken) {
  const entry = await getDriveMetadata(catalogDriveFileId, accessToken);
  if (entry.mimeType !== SHORTCUT_MIME) {
    if (entry.mimeType === FOLDER_MIME) throw imageError('CATALOG_IMAGE_TARGET_IS_FOLDER');
    return entry;
  }
  const targetId = driveIdentity(entry.shortcutDetails && entry.shortcutDetails.targetId);
  const target = await getDriveMetadata(targetId, accessToken);
  if (target.mimeType === FOLDER_MIME || target.mimeType === SHORTCUT_MIME) {
    throw imageError('CATALOG_IMAGE_SHORTCUT_TARGET_INVALID');
  }
  return target;
}

async function getDriveMetadata(fileId, accessToken) {
  const params = new URLSearchParams({
    supportsAllDrives: 'true',
    fields: 'id,mimeType,thumbnailLink,modifiedTime,size,md5Checksum,shortcutDetails(targetId,targetMimeType)'
  });
  const payload = await googleJson(`${DRIVE_FILES}/${encodeURIComponent(fileId)}?${params}`, accessToken);
  return {
    id: driveIdentity(payload.id),
    mimeType: safeText(payload.mimeType, 300),
    thumbnailLink: safeHttpsUrl(payload.thumbnailLink),
    modifiedTime: safeText(payload.modifiedTime, 100),
    size: nonNegativeInteger(payload.size),
    md5Checksum: safeHex(payload.md5Checksum),
    shortcutDetails: payload.shortcutDetails && typeof payload.shortcutDetails === 'object'
      ? {
          targetId: String(payload.shortcutDetails.targetId || '').trim(),
          targetMimeType: safeText(payload.shortcutDetails.targetMimeType, 300)
        }
      : null
  };
}

async function fetchDriveImage(source, media, accessToken) {
  if (needsRenderedThumbnail(source, media)) {
    const thumbnailLink = String(media.thumbnailLink || '').trim();
    if (!thumbnailLink.startsWith('https://')) throw imageError('CATALOG_IMAGE_THUMBNAIL_UNAVAILABLE');
    const rendered = thumbnailLink.replace(/=s\d+(?:-[a-z])?$/i, '=s1600');
    return googleFetch(rendered, accessToken, 'image/avif,image/webp,image/png,image/jpeg,*/*');
  }
  const params = new URLSearchParams({ alt: 'media', supportsAllDrives: 'true' });
  return googleFetch(`${DRIVE_FILES}/${encodeURIComponent(media.id)}?${params}`, accessToken, 'image/avif,image/webp,image/png,image/jpeg,*/*');
}

async function googleJson(url, accessToken) {
  const response = await googleFetch(url, accessToken, 'application/json');
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch (_) { throw imageError('GOOGLE_DRIVE_METADATA_JSON_INVALID'); }
  return payload;
}

async function googleFetch(url, accessToken, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: accept || '*/*'
      }
    });
    if (!response.ok) {
      let payload = {};
      try { payload = await response.clone().json(); } catch (_) {}
      throw imageError(googleError(payload, `GOOGLE_DRIVE_IMAGE_${response.status}`));
    }
    return response;
  } catch (error) {
    if (error && error.name === 'AbortError') throw imageError('GOOGLE_DRIVE_IMAGE_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function safeImageResponse(response, source, media) {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw imageError('CATALOG_IMAGE_TOO_LARGE');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) throw imageError('CATALOG_IMAGE_SIZE_INVALID');
  const sourceType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentType = safeContentType(sourceType, source, media);
  const etag = media.md5Checksum
    ? `"${media.md5Checksum}"`
    : `W/"catalog-${source.catalogVersion}-${source.driveFileId}-${bytes.byteLength}"`;
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': 'inline',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin'
    }
  });
}

async function serviceAccountAccessToken(env) {
  const credentials = parseCredentials(env && env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
  const now = Date.now();
  if (tokenCache && tokenCache.email === credentials.clientEmail && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.accessToken;
  }
  const assertion = await createAssertion(credentials);
  const response = await fetch(credentials.tokenUri, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = {}; }
  if (!response.ok) throw imageError(googleError(payload, `GOOGLE_TOKEN_${response.status}`));
  const accessToken = String(payload.access_token || '').trim();
  const expiresIn = Math.min(Math.max(Number.parseInt(payload.expires_in, 10) || 3600, 60), 7200);
  if (accessToken.length < 20) throw imageError('GOOGLE_ACCESS_TOKEN_INVALID');
  tokenCache = {
    email: credentials.clientEmail,
    accessToken,
    expiresAt: now + expiresIn * 1000
  };
  return accessToken;
}

async function createAssertion(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (credentials.privateKeyId) header.kid = credentials.privateKeyId;
  const claims = {
    iss: credentials.clientEmail,
    scope: DRIVE_SCOPE,
    aud: credentials.tokenUri,
    iat: now,
    exp: now + 3300
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(credentials.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function parseCredentials(value) {
  const text = String(value || '').trim();
  if (!text) throw imageError('GOOGLE_DRIVE_SERVICE_ACCOUNT_NOT_CONFIGURED');
  let payload;
  try { payload = JSON.parse(text); } catch (_) { throw imageError('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON_INVALID'); }
  const clientEmail = String(payload.client_email || '').trim();
  const privateKey = String(payload.private_key || '').replace(/\\n/g, '\n').trim();
  const tokenUri = String(payload.token_uri || TOKEN_URL).trim();
  if (!/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/i.test(clientEmail)) {
    throw imageError('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL_INVALID');
  }
  if (!privateKey.includes('BEGIN PRIVATE KEY')) throw imageError('GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY_INVALID');
  let url;
  try { url = new URL(tokenUri); } catch (_) { throw imageError('GOOGLE_DRIVE_SERVICE_ACCOUNT_TOKEN_URI_INVALID'); }
  if (url.protocol !== 'https:') throw imageError('GOOGLE_DRIVE_SERVICE_ACCOUNT_TOKEN_URI_INVALID');
  return {
    clientEmail,
    privateKey,
    tokenUri: url.href,
    privateKeyId: String(payload.private_key_id || '').trim()
  };
}

function needsRenderedThumbnail(source, media) {
  return source.pdfPreview === true ||
    media.mimeType === 'application/pdf' ||
    media.mimeType === 'image/tiff' ||
    ['pdf', 'tif', 'tiff'].includes(source.extension);
}

function safeContentType(value, source, media) {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(value)) return value;
  if (needsRenderedThumbnail(source, media)) return 'image/jpeg';
  if (source.extension === 'png') return 'image/png';
  if (source.extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function canonicalCacheUrl(url, source) {
  const cacheUrl = new URL(url.origin + url.pathname);
  cacheUrl.searchParams.set('id', source.driveFileId);
  cacheUrl.searchParams.set('v', source.modifiedTime || String(source.catalogVersion));
  return cacheUrl.href;
}

function base64UrlJson(value) {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function driveIdentity(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{5,500}$/.test(text)) throw imageError('CATALOG_IMAGE_ID_INVALID');
  return text;
}

function safeText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function safeHex(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{16,128}$/.test(text) ? text : '';
}

function safeHttpsUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch (_) {
    return '';
  }
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function googleError(payload, fallback) {
  const value = String(payload && (
    payload.error && (payload.error.status || payload.error.message) || payload.error
  ) || fallback).trim();
  return publicCode(value, fallback);
}

function publicCode(value, fallback) {
  const text = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ ok: false, error: publicCode(code, 'CATALOG_IMAGE_FAILED') }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function imageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
