import { SupabaseRpcClient } from '../../../src/v2/persistence/supabase-rpc-client.mjs';

const MAX_CHECKOUT_ITEMS = 200;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export function acceptedCatalogCheckoutResolverStatus(env = {}) {
  const url = normalizeSupabaseUrl(env.SUPABASE_V2_URL);
  const key = String(env.SUPABASE_V2_SERVICE_ROLE_KEY || '').trim();
  return Object.freeze({
    enabled: env.CATALOG_ACCEPTED_ENABLED === 'true',
    configured: Boolean(url && key.length >= 32),
    source: 'catalog-v2-accepted-checkout'
  });
}

export async function resolveAcceptedCatalogCheckoutItems(driveFileIds, env = {}, options = {}) {
  const requested = normalizeRequestedIds(driveFileIds);
  const uniqueIds = uniquePreservingOrder(requested);
  const status = acceptedCatalogCheckoutResolverStatus(env);

  if (!status.enabled) throw resolverError('CATALOG_ACCEPTED_DISABLED');
  if (!status.configured) throw resolverError('CATALOG_CHECKOUT_NOT_CONFIGURED');

  const payload = await checkoutCatalogRpc(uniqueIds, env, options);
  if (!payload || payload.ok !== true || !Array.isArray(payload.items)) {
    throw resolverError('CATALOG_CHECKOUT_RESPONSE_INVALID');
  }

  const catalogVersion = positiveInteger(payload.catalogVersion);
  if (!catalogVersion) throw resolverError('CATALOG_CHECKOUT_VERSION_INVALID');

  const requestedSet = new Set(uniqueIds);
  const resolvedIds = new Set();
  const items = payload.items.map(rawItem => {
    const item = normalizeCatalogItem(rawItem);
    if (!requestedSet.has(item.driveFileId)) {
      throw resolverError('CATALOG_CHECKOUT_UNREQUESTED_ITEM');
    }
    if (resolvedIds.has(item.driveFileId)) {
      throw resolverError('CATALOG_CHECKOUT_DUPLICATED_ITEM');
    }
    resolvedIds.add(item.driveFileId);
    return item;
  });

  const missingDriveFileIds = uniqueIds.filter(id => !resolvedIds.has(id));
  if (missingDriveFileIds.length) {
    const error = resolverError('ARTWORK_NOT_FOUND');
    error.missingCount = missingDriveFileIds.length;
    throw error;
  }

  if (Number(payload.requestedUniqueCount) !== uniqueIds.length) {
    throw resolverError('CATALOG_CHECKOUT_REQUEST_COUNT_MISMATCH');
  }
  if (Number(payload.resolvedCount) !== items.length || items.length !== uniqueIds.length) {
    throw resolverError('CATALOG_CHECKOUT_RESOLVED_COUNT_MISMATCH');
  }

  return deepFreeze({
    ok: true,
    source: status.source,
    catalogVersion,
    requestedCount: requested.length,
    requestedUniqueCount: uniqueIds.length,
    resolvedCount: items.length,
    items
  });
}

async function checkoutCatalogRpc(uniqueIds, env, options) {
  const timeoutMs = boundedInteger(
    env.CATALOG_ACCEPTED_TIMEOUT_MS,
    500,
    15000,
    DEFAULT_TIMEOUT_MS
  );
  const maxResponseBytes = boundedInteger(
    env.CATALOG_CHECKOUT_MAX_RESPONSE_BYTES,
    1024,
    8 * 1024 * 1024,
    DEFAULT_MAX_RESPONSE_BYTES
  );

  try {
    const client = new SupabaseRpcClient({
      url: normalizeSupabaseUrl(env.SUPABASE_V2_URL),
      serviceKey: String(env.SUPABASE_V2_SERVICE_ROLE_KEY || '').trim(),
      fetch: options.fetch || globalThis.fetch,
      schema: 'public',
      timeoutMs,
      maxResponseBytes
    });
    return await client.call('armazem_v2_catalog_checkout_items_v1', {
      p_drive_file_ids: uniqueIds
    });
  } catch (error) {
    throw mapRpcError(error);
  }
}

function normalizeRequestedIds(value) {
  if (!Array.isArray(value) || value.length < 1) {
    throw resolverError('ORDER_ITEMS_REQUIRED');
  }
  if (value.length > MAX_CHECKOUT_ITEMS) {
    throw resolverError('ORDER_ITEMS_LIMIT_EXCEEDED');
  }

  return value.map(raw => {
    const id = String(raw ?? '').trim();
    if (id.length < 1 || id.length > 500) {
      throw resolverError('DRIVE_FILE_ID_INVALID');
    }
    return id;
  });
}

function normalizeCatalogItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
    throw resolverError('CATALOG_CHECKOUT_ITEM_INVALID');
  }

  const driveFileId = String(rawItem.driveFileId || rawItem.id || '').trim();
  const productKey = cleanIdentity(rawItem.productKey || rawItem.product);
  if (!driveFileId || driveFileId.length > 500) {
    throw resolverError('CATALOG_CHECKOUT_DRIVE_FILE_ID_INVALID');
  }
  if (!productKey) throw resolverError('CATALOG_PRODUCT_NOT_CONFIGURED');

  return deepFreeze({
    ...rawItem,
    id: driveFileId,
    driveFileId,
    code: cleanText(rawItem.code).slice(0, 100),
    originalName: cleanText(rawItem.originalName || rawItem.name).slice(0, 1000),
    theme: cleanText(rawItem.theme).slice(0, 500),
    subtheme: cleanText(rawItem.subtheme).slice(0, 500),
    product: productKey,
    productKey,
    productName: cleanText(rawItem.productName || rawItem.productLabel || productKey).slice(0, 160),
    size: cleanIdentity(rawItem.size || rawItem.sizeKey || 'default') || 'default',
    sizeKey: cleanIdentity(rawItem.sizeKey || rawItem.size || 'default') || 'default'
  });
}

function mapRpcError(error) {
  const code = String(error?.code || '');
  if (code === 'SUPABASE_RPC_TIMEOUT') return resolverError('CATALOG_CHECKOUT_TIMEOUT');
  if (code === 'SUPABASE_RPC_RESPONSE_TOO_LARGE') {
    return resolverError('CATALOG_CHECKOUT_RESPONSE_TOO_LARGE');
  }
  if (code === 'SUPABASE_RPC_REQUEST_FAILED') {
    const remoteMessage = String(error?.remoteMessage || '').trim();
    if (/^[A-Z0-9_]{3,100}$/.test(remoteMessage)) return resolverError(remoteMessage);
    const status = Number(error?.status || 0);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return resolverError(`CATALOG_CHECKOUT_RPC_${status}`);
    }
    return resolverError('CATALOG_CHECKOUT_RPC_FAILED');
  }
  if (
    code === 'SUPABASE_URL_INVALID' ||
    code === 'SUPABASE_SECRET_KEY_INVALID' ||
    code === 'SUPABASE_FETCH_REQUIRED' ||
    code === 'SUPABASE_SCHEMA_INVALID' ||
    code === 'SUPABASE_RPC_FUNCTION_INVALID' ||
    code === 'SUPABASE_RPC_BODY_INVALID'
  ) {
    return resolverError('CATALOG_CHECKOUT_RPC_CLIENT_INVALID');
  }
  return /^[A-Z0-9_]{3,100}$/.test(code)
    ? resolverError(code)
    : resolverError('CATALOG_CHECKOUT_FAILED');
}

function uniquePreservingOrder(values) {
  return [...new Set(values)];
}

function normalizeSupabaseUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { return ''; }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  ) {
    return '';
  }
  return url.origin;
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanIdentity(value) {
  return cleanText(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function resolverError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
