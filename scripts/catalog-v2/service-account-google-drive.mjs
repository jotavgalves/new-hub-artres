import { createSign } from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function parseServiceAccountCredentials(value) {
  let parsed = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) throw serviceError('GOOGLE_SERVICE_ACCOUNT_JSON_REQUIRED');
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw serviceError('GOOGLE_SERVICE_ACCOUNT_JSON_INVALID');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw serviceError('GOOGLE_SERVICE_ACCOUNT_JSON_INVALID');
  }
  const clientEmail = String(parsed.client_email || parsed.clientEmail || '').trim();
  const privateKey = String(parsed.private_key || parsed.privateKey || '').replace(/\\n/g, '\n').trim();
  const tokenUri = String(parsed.token_uri || parsed.tokenUri || GOOGLE_TOKEN_URL).trim();
  if (!/^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/i.test(clientEmail)) {
    throw serviceError('GOOGLE_SERVICE_ACCOUNT_EMAIL_INVALID');
  }
  if (!privateKey.includes('BEGIN PRIVATE KEY') && !privateKey.includes('BEGIN RSA PRIVATE KEY')) {
    throw serviceError('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_INVALID');
  }
  let tokenUrl;
  try {
    tokenUrl = new URL(tokenUri);
  } catch (_) {
    throw serviceError('GOOGLE_SERVICE_ACCOUNT_TOKEN_URI_INVALID');
  }
  if (tokenUrl.protocol !== 'https:' || tokenUrl.username || tokenUrl.password) {
    throw serviceError('GOOGLE_SERVICE_ACCOUNT_TOKEN_URI_INVALID');
  }
  return Object.freeze({
    clientEmail,
    privateKey,
    tokenUri: tokenUrl.href,
    projectId: safeText(parsed.project_id || parsed.projectId, 200),
    privateKeyId: safeText(parsed.private_key_id || parsed.privateKeyId, 200)
  });
}

export function createServiceAccountAssertion(credentials, options = {}) {
  const creds = parseServiceAccountCredentials(credentials);
  const now = Number.isFinite(Number(options.nowSeconds))
    ? Math.floor(Number(options.nowSeconds))
    : Math.floor(Date.now() / 1000);
  const lifetimeSeconds = boundedInteger(options.lifetimeSeconds, 60, 3600, 3300);
  const header = { alg: 'RS256', typ: 'JWT' };
  if (creds.privateKeyId) header.kid = creds.privateKeyId;
  const claims = {
    iss: creds.clientEmail,
    scope: String(options.scope || DRIVE_SCOPE),
    aud: creds.tokenUri,
    iat: now,
    exp: now + lifetimeSeconds
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(creds.privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

export async function exchangeServiceAccountToken(credentials, options = {}) {
  const creds = parseServiceAccountCredentials(credentials);
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw serviceError('FETCH_REQUIRED');
  const assertion = createServiceAccountAssertion(creds, options);
  const controller = new AbortController();
  const timeoutMs = boundedInteger(options.timeoutMs, 1000, 30000, 10000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await Reflect.apply(fetchImpl, globalThis, [creds.tokenUri, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer',
        assertion
      })
    }]);
    const text = await readLimitedText(response, 128 * 1024);
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = {}; }
    if (!response.ok) {
      throw serviceError(publicGoogleError(payload, `GOOGLE_TOKEN_HTTP_${response.status}`));
    }
    const accessToken = String(payload.access_token || '').trim();
    const expiresIn = boundedInteger(payload.expires_in, 60, 7200, 3600);
    if (accessToken.length < 20) throw serviceError('GOOGLE_ACCESS_TOKEN_INVALID');
    return Object.freeze({
      accessToken,
      tokenType: String(payload.token_type || 'Bearer'),
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      serviceAccountEmail: creds.clientEmail
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw serviceError('GOOGLE_TOKEN_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createGoogleDriveClient(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const accessToken = String(options.accessToken || '').trim();
  if (typeof fetchImpl !== 'function') throw serviceError('FETCH_REQUIRED');
  if (accessToken.length < 20) throw serviceError('GOOGLE_ACCESS_TOKEN_REQUIRED');
  const timeoutMs = boundedInteger(options.timeoutMs, 1000, 60000, 15000);
  const maxRetries = boundedInteger(options.maxRetries, 0, 6, 3);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, 1024, 8 * 1024 * 1024, 2 * 1024 * 1024);
  const counters = options.counters && typeof options.counters === 'object' ? options.counters : {};

  async function request(url) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        counters.requests = Number(counters.requests || 0) + 1;
        const response = await Reflect.apply(fetchImpl, globalThis, [url, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'Cache-Control': 'no-store'
          }
        }]);
        const text = await readLimitedText(response, maxResponseBytes);
        let payload;
        try { payload = text ? JSON.parse(text) : {}; } catch (_) {
          throw serviceError('GOOGLE_DRIVE_JSON_INVALID');
        }
        if (response.ok) return payload;
        const code = publicGoogleError(payload, `GOOGLE_DRIVE_HTTP_${response.status}`);
        if (!RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries) {
          throw serviceError(code);
        }
        lastError = serviceError(code);
      } catch (error) {
        if (error?.name === 'AbortError') lastError = serviceError('GOOGLE_DRIVE_TIMEOUT');
        else lastError = error;
        if (attempt >= maxRetries || !isRetryableError(lastError)) throw lastError;
      } finally {
        clearTimeout(timer);
      }
      await delay(Math.min(250 * 2 ** attempt, 2000));
    }
    throw lastError || serviceError('GOOGLE_DRIVE_REQUEST_FAILED');
  }

  async function getFile(fileId, extraFields = '') {
    const id = driveIdentity(fileId);
    const fields = [
      'id', 'name', 'mimeType', 'parents', 'trashed', 'modifiedTime', 'size', 'md5Checksum',
      'thumbnailLink', 'webViewLink', 'shortcutDetails(targetId,targetMimeType)', extraFields
    ].filter(Boolean).join(',');
    const params = new URLSearchParams({
      supportsAllDrives: 'true',
      fields
    });
    return normalizeDriveFile(await request(`${DRIVE_API}/${encodeURIComponent(id)}?${params}`));
  }

  async function listChildren(folderId) {
    const id = driveIdentity(folderId);
    const files = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        q: `'${id.replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,parents,trashed,modifiedTime,size,md5Checksum,thumbnailLink,webViewLink,shortcutDetails(targetId,targetMimeType))',
        pageSize: '1000',
        orderBy: 'folder,name_natural'
      });
      if (pageToken) params.set('pageToken', pageToken);
      const payload = await request(`${DRIVE_API}?${params}`);
      for (const file of Array.isArray(payload.files) ? payload.files : []) {
        const normalized = normalizeDriveFile(file);
        if (!normalized.trashed) files.push(normalized);
      }
      pageToken = String(payload.nextPageToken || '').trim();
    } while (pageToken);
    return files;
  }

  return Object.freeze({ getFile, listChildren, counters });
}

export function normalizeDriveFile(file) {
  const value = file && typeof file === 'object' ? file : {};
  const shortcut = value.shortcutDetails && typeof value.shortcutDetails === 'object'
    ? {
        targetId: String(value.shortcutDetails.targetId || '').trim(),
        targetMimeType: String(value.shortcutDetails.targetMimeType || '').trim()
      }
    : null;
  return Object.freeze({
    id: driveIdentity(value.id),
    name: safeText(value.name, 1000) || 'Sem nome',
    mimeType: safeText(value.mimeType, 300),
    parents: Array.isArray(value.parents) ? value.parents.map(driveIdentity).filter(Boolean) : [],
    trashed: value.trashed === true,
    modifiedTime: validIso(value.modifiedTime),
    size: nonNegativeInteger(value.size),
    md5Checksum: safeHex(value.md5Checksum),
    thumbnailLink: safeHttpsUrl(value.thumbnailLink),
    webViewLink: safeHttpsUrl(value.webViewLink),
    shortcut
  });
}

export const GOOGLE_DRIVE_MIME = Object.freeze({
  FOLDER: FOLDER_MIME,
  SHORTCUT: SHORTCUT_MIME
});

function base64UrlJson(value) {
  return base64Url(Buffer.from(JSON.stringify(value), 'utf8'));
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function publicGoogleError(payload, fallback) {
  const raw = String(
    payload?.error?.status ||
    payload?.error?.errors?.[0]?.reason ||
    payload?.error ||
    fallback || ''
  ).trim();
  const code = raw
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
  return /^[A-Z0-9_]{3,100}$/.test(code) ? `GOOGLE_${code.replace(/^GOOGLE_/, '')}` : fallback;
}

function isRetryableError(error) {
  return /(?:TIMEOUT|RATE_LIMIT|RESOURCE_EXHAUSTED|INTERNAL|UNAVAILABLE|HTTP_5\d\d|HTTP_429)/.test(String(error?.code || error?.message || ''));
}

async function readLimitedText(response, maxBytes) {
  const declared = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) throw serviceError('GOOGLE_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('GOOGLE_RESPONSE_TOO_LARGE').catch(() => {});
        throw serviceError('GOOGLE_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function driveIdentity(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{5,500}$/.test(id)) throw serviceError('GOOGLE_DRIVE_ID_INVALID');
  return id;
}

function safeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
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

function validIso(value) {
  const date = new Date(String(value || ''));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function serviceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
