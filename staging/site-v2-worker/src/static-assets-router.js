const STATIC_METHODS = new Set(['GET', 'HEAD']);

export function isStaticAssetRoute(pathname) {
  const path = String(pathname || '');
  if (path === '/health') return false;
  if (path === '/admin' || path === '/admin/' || path.startsWith('/admin/')) return false;
  if (path.startsWith('/api/')) return false;
  if (path.startsWith('/internal/')) return false;
  return true;
}

export async function serveStaticAsset(request, env, requestId, options = {}) {
  if (!STATIC_METHODS.has(request.method)) {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
      Allow: 'GET, HEAD'
    });
  }

  const assetFetcher = env?.ASSETS?.fetch;
  if (typeof assetFetcher !== 'function') {
    return json({ ok: false, error: 'STAGING_ASSETS_NOT_CONFIGURED', requestId }, 503);
  }

  try {
    return await Reflect.apply(assetFetcher, env.ASSETS, [request]);
  } catch (_) {
    const logger = options.logger || console;
    logger.error?.(JSON.stringify({
      level: 'error',
      service: 'new-hub-artres-v2-staging',
      event: 'static-asset-fetch-failed',
      code: 'STAGING_ASSET_FETCH_FAILED'
    }));
    return json({ ok: false, error: 'STAGING_ASSET_FETCH_FAILED', requestId }, 502);
  }
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}
