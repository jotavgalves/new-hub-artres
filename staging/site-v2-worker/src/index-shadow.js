import { constantTimeEqualSecrets } from '../../../src/v2/http/request-guard.mjs';
import { fetchStagingWorker, OrderLedger } from './index.js';
import {
  ADMIN_COMMERCIAL_CSS,
  ADMIN_COMMERCIAL_HTML,
  ADMIN_COMMERCIAL_JS
} from './admin-commercial-page.js';
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
  handleAdminCommercialConfig,
  handlePublicCommercialConfig
} from './commercial-config-route.js';
import {
  handleOutboxInspection,
  handleRecentAdminOrders
} from './ledger-inspection-routes.js';
import {
  handlePublicCheckoutProtectionProbe
} from './public-checkout-protection.js';
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

const ADMIN_ORDERS_ROUTE = '/internal/v2/admin/orders';
const ADMIN_COMMERCIAL_CONFIG_ROUTE = '/internal/v2/admin/commercial-config';
const PUBLIC_COMMERCIAL_CONFIG_ROUTE = '/api/commercial-config';
const ADMIN_COMMERCIAL_PAGE = '/admin/commercial';
const CATALOG_READONLY_ROUTE = '/internal/v2/catalog/preview';
const LEDGER_OUTBOX_ROUTE = '/internal/v2/ledger/outbox';
const PUBLIC_CHECKOUT_PROTECTION_ROUTE = '/internal/v2/checkout/protection';
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

  if (url.pathname === ADMIN_COMMERCIAL_PAGE || url.pathname === `${ADMIN_COMMERCIAL_PAGE}/`) {
    if (request.method !== 'GET') return methodNotAllowed(['GET'], safeRequestId(request.headers) || crypto.randomUUID());
    return adminAsset(ADMIN_COMMERCIAL_HTML, 'text/html; charset=utf-8', true);
  }
  if (url.pathname === `${ADMIN_COMMERCIAL_PAGE}/app.css`) {
    if (request.method !== 'GET') return methodNotAllowed(['GET'], safeRequestId(request.headers) || crypto.randomUUID());
    return adminAsset(ADMIN_COMMERCIAL_CSS, 'text/css; charset=utf-8');
  }
  if (url.pathname === `${ADMIN_COMMERCIAL_PAGE}/app.js`) {
    if (request.method !== 'GET') return methodNotAllowed(['GET'], safeRequestId(request.headers) || crypto.randomUUID());
    return adminAsset(ADMIN_COMMERCIAL_JS, 'text/javascript; charset=utf-8');
  }

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

  if (url.pathname === PUBLIC_COMMERCIAL_CONFIG_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    return handlePublicCommercialConfig(request, env, requestId);
  }

  if (url.pathname === PUBLIC_CHECKOUT_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    return handlePublicCheckoutRoute(request, env, requestId, {
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

  if (
    url.pathname === ADMIN_ORDERS_ROUTE ||
    url.pathname === ADMIN_COMMERCIAL_CONFIG_ROUTE ||
    url.pathname === LEDGER_OUTBOX_ROUTE
  ) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    const authorized = await constantTimeEqualSecrets(
      request.headers.get('x-staging-token'),
      env.STAGING_API_TOKEN
    );
    if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);
    if (url.pathname === ADMIN_ORDERS_ROUTE) {
      return handleRecentAdminOrders(request, env, requestId);
    }
    if (url.pathname === ADMIN_COMMERCIAL_CONFIG_ROUTE) {
      return handleAdminCommercialConfig(request, env, requestId);
    }
    return handleOutboxInspection(request, env, requestId);
  }

  if (url.pathname === PUBLIC_CHECKOUT_PROTECTION_ROUTE) {
    const requestId = safeRequestId(request.headers) || crypto.randomUUID();
    const authorized = await constantTimeEqualSecrets(
      request.headers.get('x-staging-token'),
      env.STAGING_API_TOKEN
    );
    if (!authorized) return json({ ok: false, error: 'STAGING_TOKEN_INVALID', requestId }, 401);
    return handlePublicCheckoutProtectionProbe(request, env, requestId);
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
      publicCheckout: checkoutStatus,
      commercialConfig: {
        enabled: true,
        publicRoute: PUBLIC_COMMERCIAL_CONFIG_ROUTE,
        adminRoute: ADMIN_COMMERCIAL_CONFIG_ROUTE,
        adminPage: ADMIN_COMMERCIAL_PAGE
      }
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

function adminAsset(body, contentType, isHtml = false) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, max-age=0',
      'Content-Security-Policy': isHtml
        ? "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        : "default-src 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow, noarchive'
    }
  });
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
