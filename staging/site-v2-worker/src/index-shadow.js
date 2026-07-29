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
import { handleAcceptedCheckoutSubmit } from './accepted-checkout-submit-route.js';
import { handleCheckoutValidationPreview } from './checkout-validation-preview-route.js';
import {
  handlePublicCheckoutRoute,
  publicCheckoutStatus
} from './public-checkout-route.js';
import {
  scheduleSupabaseShadowProjection,
  supabaseShadowStatus
} from './supabase-shadow-projector.js';
import {
  isStaticAssetRoute,
  probeStaticAssets,
  serveStaticAsset
} from './static-assets-router.js';

export { OrderLedger };

const CATALOG_READONLY_ROUTE = '/internal/v2/catalog/preview';
const CHECKOUT_SUBMIT_ROUTE = '/internal/v2/checkout/submit';
const CHECKOUT_VALIDATION_ROUTE = '/internal/v2/checkout/validate';
const STATIC_ASSETS_PROBE_ROUTE = '/internal/v2/assets/probe';
const PUBLIC_CHECKOUT_ROUTE = '/api/orders/v2';
const PUBLIC_CATALOG_ROUTES = new Set(['/api/drive', '/api/catalog-meta']);

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
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    return serveStaticAsset(request, env, requestId);
  }

  const shadowStatus = supabaseShadowStatus(env);
  const catalogStatus = catalogReadonlyBridgeStatus(env);
  const acceptedCatalogStatus = catalogAcceptedStatus(env);
  const checkoutStatus = publicCheckoutStatus(env);

  if (PUBLIC_CATALOG_ROUTES.has(url.pathname)) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    return handleCatalogAcceptedPublicRoute(request, env, requestId);
  }

  if (url.pathname === PUBLIC_CHECKOUT_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    return handlePublicCheckoutRoute(request, env, requestId);
  }

  if (url.pathname === CHECKOUT_SUBMIT_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    const authorized = await constantTimeEqualSecrets(
      request.headers.get('x-staging-token'),
      env.STAGING_API_TOKEN
    );
    if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);
    return handleAcceptedCheckoutSubmit(request, env, requestId, {
      onOrderCommitted({ command, result }) {
        return scheduleSupabaseShadowProjection({
          ctx,
          env,
          command,
          result,
          logger: console
        });
      }
    });
  }

  if (url.pathname === CHECKOUT_VALIDATION_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    const authorized = await constantTimeEqualSecrets(
      request.headers.get('x-staging-token'),
      env.STAGING_API_TOKEN
    );
    if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);
    return handleCheckoutValidationPreview(request, env, requestId);
  }

  if (url.pathname === STATIC_ASSETS_PROBE_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    const authorized = await constantTimeEqualSecrets(
      request.headers.get('x-staging-token'),
      env.STAGING_API_TOKEN
    );
    if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);
    return probeStaticAssets(request, env, requestId);
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
      acceptedCatalog: acceptedCatalogStatus,
      publicCheckout: checkoutStatus
    });
  }

  return response;
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
