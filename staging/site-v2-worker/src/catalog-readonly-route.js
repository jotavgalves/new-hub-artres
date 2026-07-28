import {
  fetchLegacyCatalogBridge,
  legacyCatalogBridgeStatus
} from '../../../src/v2/catalog/legacy-readonly-bridge.mjs';

export function catalogReadonlyBridgeStatus(env = {}) {
  return legacyCatalogBridgeStatus({
    enabled: env.CATALOG_READONLY_BRIDGE_ENABLED,
    baseUrl: env.CATALOG_LEGACY_BASE_URL,
    rootDriveId: env.CATALOG_V2_ROOT_DRIVE_ID
  });
}

export async function handleCatalogReadonlyRoute(request, env, requestId, options = {}) {
  const status = catalogReadonlyBridgeStatus(env);
  if (!status.enabled) {
    return json({
      ok: false,
      error: 'CATALOG_READONLY_BRIDGE_DISABLED',
      requestId,
      readOnly: true
    }, 503);
  }
  if (!status.configured) {
    return json({
      ok: false,
      error: 'CATALOG_READONLY_BRIDGE_NOT_CONFIGURED',
      requestId,
      readOnly: true
    }, 503);
  }

  const url = new URL(request.url);
  const mode = String(url.searchParams.get('mode') || 'themes').trim();

  try {
    const result = await fetchLegacyCatalogBridge({
      baseUrl: env.CATALOG_LEGACY_BASE_URL,
      rootDriveId: env.CATALOG_V2_ROOT_DRIVE_ID,
      productKey: env.CATALOG_V2_PRODUCT_KEY || '50x50',
      productName: env.CATALOG_V2_PRODUCT_NAME || 'Bolinhas 50x50',
      structure: env.CATALOG_V2_STRUCTURE || 'theme-or-subtheme-images',
      mode,
      query: url.searchParams,
      timeoutMs: env.CATALOG_READONLY_TIMEOUT_MS,
      maxResponseBytes: env.CATALOG_READONLY_MAX_RESPONSE_BYTES,
      maxComparisonDetails: 50,
      fetch: options.fetch || globalThis.fetch
    });

    return json({ requestId, ...result });
  } catch (error) {
    const code = publicErrorCode(error);
    return json({
      ok: false,
      error: code,
      requestId,
      readOnly: true
    }, statusForError(code));
  }
}

function publicErrorCode(error) {
  const code = String(error?.code || error?.message || 'CATALOG_READONLY_BRIDGE_FAILED');
  if (/^[A-Z0-9_]{3,100}$/.test(code)) return code;
  return 'CATALOG_READONLY_BRIDGE_FAILED';
}

function statusForError(code) {
  if (code === 'LEGACY_CATALOG_TIMEOUT') return 504;
  if (code === 'LEGACY_CATALOG_RESPONSE_TOO_LARGE') return 502;
  if (code.startsWith('LEGACY_CATALOG_HTTP_')) return 502;
  if (code.includes('INVALID') || code.includes('REQUIRED')) return 422;
  return 502;
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}
