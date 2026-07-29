import { constantTimeEqualSecrets } from '../../../src/v2/http/request-guard.mjs';
import { fetchStagingWorker, OrderLedger } from './index.js';
import {
  catalogAcceptedStatus,
  handleCatalogAcceptedPublicRoute
} from './catalog-accepted-route.js';
import {
  catalogReadonlyBridgeStatus,
  handleCatalogReadonlyRoute
} from './catalog-readonly-route.js';
import {
  scheduleSupabaseShadowProjection,
  supabaseShadowStatus
} from './supabase-shadow-projector.js';

export { OrderLedger };

const CATALOG_READONLY_ROUTE = '/internal/v2/catalog/preview';
const PUBLIC_CATALOG_ROUTES = new Set(['/api/drive', '/api/catalog-meta']);
const STATIC_METHODS = new Set(['GET', 'HEAD']);

export default {
  async fetch(request, env, ctx) {
    return fetchStagingShadowWorker(request, env, ctx);
  }
};

export async function fetchStagingShadowWorker(request, env, ctx) {
  const url = new URL(request.url);

  // Todos os requests passam primeiro pelo Worker. As páginas e os arquivos do
  // design atual são encaminhados explicitamente ao binding de assets. Isso
  // evita depender do caminho asset-first do edge e não transforma o conteúdo.
  if (isStaticAssetRoute(url.pathname)) {
    return serveStaticAsset(request, env);
  }

  const shadowStatus = supabaseShadowStatus(env);
  const catalogStatus = catalogReadonlyBridgeStatus(env);
  const acceptedCatalogStatus = catalogAcceptedStatus(env);

  if (PUBLIC_CATALOG_ROUTES.has(url.pathname)) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    return handleCatalogAcceptedPublicRoute(request, env, requestId);
  }

  if (url.pathname === CATALOG_READONLY_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    const authorized = await constantTimeEqualSecrets(
      request.headers.get('x-staging-token'),
      env.STAGING_API_TOKEN
    );
    if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);
    if (request.method !== 'GET') return methodNotAllowed(['GET'], requestId);
    return handleCatalogReadonlyRoute(request, env, requestId);
  }

  const hooks = shadowStatus.enabled && shadowStatus.configured
    ? {
        onOrderCommitted({ command, result }) {
          return scheduleSupabaseShadowProjection({
            ctx,
            env,
            command,
            result,
            logger: console
          });
        }
      }
    : {};

  const response = await fetchStagingWorker(request, env, ctx, hooks);

  if (url.pathname === '/health' && request.method === 'GET') {
    return augmentHealthResponse(response, {
      supabaseShadow: shadowStatus,
      catalogReadonlyBridge: catalogStatus,
      acceptedCatalog: acceptedCatalogStatus
    });
  }

  return response;
}

function isStaticAssetRoute(pathname) {
  if (pathname === '/health') return false;
  if (pathname === '/admin' || pathname === '/admin/' || pathname.startsWith('/admin/')) return false;
  if (pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/internal/')) return false;
  return true;
}

async function serveStaticAsset(request, env) {
  const requestId = safeRequestId(request.headers) || crypto.randomUUID();
  if (!STATIC_METHODS.has(request.method)) {
    return methodNotAllowed(['GET', 'HEAD'], requestId);
  }

  const assetFetcher = env?.ASSETS?.fetch;
  if (typeof assetFetcher !== 'function') {
    return json({ ok: false, error: 'STAGING_ASSETS_NOT_CONFIGURED', requestId }, 503);
  }

  try {
    return await Reflect.apply(assetFetcher, env.ASSETS, [request]);
  } catch (_) {
    console.error(JSON.stringify({
      level: 'error',
      service: 'new-hub-artres-v2-staging',
      event: 'static-asset-fetch-failed',
      code: 'STAGING_ASSET_FETCH_FAILED'
    }));
    return json({ ok: false, error: 'STAGING_ASSET_FETCH_FAILED', requestId }, 502);
  }
}

async function augmentHealthResponse(response, statusFields) {
  if (response.status !== 200) return response;

  try {
    const payload = await response.clone().json();
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify({
      ...payload,
      ...statusFields
    }), {
      status: response.status,
      headers
    });
  } catch (_) {
    return response;
  }
}

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
    Allow: methods.join(', ')
  });
}

function safeRequestId(headers) {
  const value = String(headers?.get?.('x-request-id') || '').trim();
  return /^[A-Za-z0-9._:-]{1,100}$/.test(value) ? value : '';
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
