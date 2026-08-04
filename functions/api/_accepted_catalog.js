const ROOTS = Object.freeze({
  '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
});
const PRIVATE_PAYLOAD_FIELDS = Object.freeze([
  'sourceDriveFileId',
  'shortcutTargetId',
  'driveUrl',
  'sourceName',
  'checksum',
  'thumbnailLink'
]);

export async function tryAcceptedCatalogRequest(env, input = {}) {
  if (String(env && env.USE_AUTHENTICATED_CATALOG_V2 || '').trim().toLowerCase() !== 'true') return null;
  const config = acceptedSupabaseConfig(env);
  const mode = String(input.mode || '').trim();
  const productKey = canonicalProduct(input.productKey);
  if (!productKey) throw new Error('AUTHENTICATED_CATALOG_PRODUCT_INVALID');

  if (['themes', 'products', 'items'].includes(mode)) {
    const name = productKey === '50x50'
      ? 'armazem_v2_catalog_route_v1'
      : 'armazem_v2_catalog_route_scoped_v1';
    const body = productKey === '50x50'
      ? {
          p_mode: mode,
          p_folder_id: String(input.folderId || ''),
          p_product_key: productKey
        }
      : {
          p_mode: mode,
          p_folder_id: String(input.folderId || ''),
          p_product_key: productKey,
          p_root_drive_id: ROOTS[productKey]
        };
    return normalizeAcceptedPayload(await rpc(config, name, body), productKey);
  }

  if (['search', 'globalSearch', 'folderSearch'].includes(mode)) {
    const name = productKey === '50x50'
      ? 'armazem_v2_catalog_search_v1'
      : 'armazem_v2_catalog_search_scoped_v1';
    const body = productKey === '50x50'
      ? {
          p_mode: mode,
          p_query: String(input.query || ''),
          p_limit: clampLimit(input.limit)
        }
      : {
          p_mode: mode,
          p_query: String(input.query || ''),
          p_limit: clampLimit(input.limit),
          p_product_key: productKey,
          p_root_drive_id: ROOTS[productKey]
        };
    return normalizeAcceptedPayload(await rpc(config, name, body), productKey);
  }
  return null;
}

export async function acceptedImageSource(env, driveFileId) {
  const config = acceptedSupabaseConfig(env);
  const payload = await rpc(config, 'armazem_v2_catalog_image_source_v1', {
    p_drive_file_id: String(driveFileId || '')
  });
  if (!payload || payload.ok !== true || payload.rootVerified !== true) {
    throw new Error('AUTHENTICATED_CATALOG_IMAGE_SOURCE_INVALID');
  }
  return Object.freeze({
    driveFileId: driveIdentity(payload.driveFileId),
    mimeType: safeText(payload.mimeType, 300),
    extension: safeText(payload.extension, 20).toLowerCase(),
    modifiedTime: safeText(payload.modifiedTime, 100),
    pdfPreview: payload.pdfPreview === true,
    productKey: canonicalProduct(payload.productKey),
    catalogRootDriveId: driveIdentity(payload.catalogRootDriveId),
    catalogVersion: positiveInteger(payload.catalogVersion)
  });
}

export function acceptedCatalogEnabled(env) {
  return String(env && env.USE_AUTHENTICATED_CATALOG_V2 || '').trim().toLowerCase() === 'true';
}

function acceptedSupabaseConfig(env) {
  const rawUrl = String(env && (
    env.SUPABASE_V2_URL ||
    env.AUTHENTICATED_CATALOG_SUPABASE_URL
  ) || 'https://kueklnkznwpbobqwugns.supabase.co').trim();
  const key = String(env && (
    env.SUPABASE_V2_SERVICE_ROLE_KEY ||
    env.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY ||
    env.AUTHENTICATED_CATALOG_SERVICE_ROLE_KEY
  ) || '').trim();
  let url;
  try { url = new URL(rawUrl); } catch (_) { throw new Error('AUTHENTICATED_CATALOG_SUPABASE_URL_INVALID'); }
  if (url.protocol !== 'https:' || key.length < 32) {
    throw new Error('AUTHENTICATED_CATALOG_SUPABASE_NOT_CONFIGURED');
  }
  return Object.freeze({ origin: url.origin, key });
}

async function rpc(config, name, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${config.origin}/rest/v1/rpc/${name}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(body || {})
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch (_) {
      throw new Error('AUTHENTICATED_CATALOG_RPC_JSON_INVALID');
    }
    if (!response.ok) {
      const code = publicCode(payload && payload.message, `AUTHENTICATED_CATALOG_RPC_${response.status}`);
      throw new Error(code);
    }
    return payload;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('AUTHENTICATED_CATALOG_RPC_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAcceptedPayload(payload, productKey) {
  const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? structuredClone(payload) : {};
  value.ok = value.ok !== false;
  value.product = productKey;
  value.productKey = productKey;
  value.rootDriveId = ROOTS[productKey];
  value.rootVerified = true;
  for (const key of ['folders', 'results', 'items']) {
    if (!Array.isArray(value[key])) continue;
    value[key] = value[key].map(entry => {
      const clean = scrubPrivateFields(entry);
      return {
        ...clean,
        product: productKey,
        productKey,
        catalogRootDriveId: ROOTS[productKey],
        rootVerified: true
      };
    });
  }
  return value;
}

function scrubPrivateFields(entry) {
  const clean = entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...entry } : {};
  for (const key of PRIVATE_PAYLOAD_FIELDS) delete clean[key];
  return clean;
}

function canonicalProduct(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === '50x50' || key === 'bolinhas' || key === 'bolinha') return '50x50';
  if (key === 'painel-150' || key === 'painel150' || key === 'painel') return 'painel-150';
  return '';
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 120) : 80;
}

function driveIdentity(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{5,500}$/.test(text)) throw new Error('AUTHENTICATED_CATALOG_DRIVE_ID_INVALID');
  return text;
}

function safeText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function publicCode(value, fallback) {
  const text = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
  return /^[A-Z0-9_]{3,100}$/.test(text) ? text : fallback;
}
