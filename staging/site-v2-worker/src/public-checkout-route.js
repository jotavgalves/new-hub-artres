import {
  protectPublicCheckoutRequest,
  publicCheckoutJson,
  publicCheckoutProtectionStatus
} from './public-checkout-protection.js';

const PUBLIC_CHECKOUT_ROUTE = '/api/orders/v2';

export function publicCheckoutStatus(env = {}) {
  const protection = publicCheckoutProtectionStatus(env);
  return Object.freeze({
    enabled: env.STAGING_PUBLIC_CHECKOUT_ENABLED === 'true',
    implemented: false,
    stagingOnly: true,
    acceptsRealOrders: false,
    route: PUBLIC_CHECKOUT_ROUTE,
    source: 'catalog-v2-accepted',
    protection
  });
}

export async function handlePublicCheckoutRoute(request, env, requestId, options = {}) {
  if (String(env.ENVIRONMENT || '').trim() !== 'staging') {
    return publicCheckoutJson(
      { ok: false, error: 'PUBLIC_CHECKOUT_STAGING_ONLY', requestId },
      404
    );
  }

  if (request.method !== 'POST') {
    return publicCheckoutJson(
      { ok: false, error: 'METHOD_NOT_ALLOWED', requestId },
      405,
      { Allow: 'POST' }
    );
  }

  const status = publicCheckoutStatus(env);
  if (!status.enabled) {
    return publicCheckoutJson(
      { ok: false, error: 'PUBLIC_CHECKOUT_DISABLED', requestId },
      503
    );
  }

  const protection = await protectPublicCheckoutRequest(
    request,
    env,
    requestId,
    options
  );
  if (!protection.ok) return protection.response;

  // Barreira deliberada. A proteção completa é validada antes da ativação,
  // porém a criação pública de pedidos permanece desligada até o smoke final.
  return publicCheckoutJson(
    { ok: false, error: 'PUBLIC_CHECKOUT_IMPLEMENTATION_PENDING', requestId },
    503
  );
}
