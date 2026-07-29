import { handleAcceptedCheckoutSubmit } from './accepted-checkout-submit-route.js';
import {
  protectPublicCheckoutRequest,
  publicCheckoutJson,
  publicCheckoutProtectionStatus
} from './public-checkout-protection.js';

const PUBLIC_CHECKOUT_ROUTE = '/api/orders/v2';

export function publicCheckoutStatus(env = {}) {
  const protection = publicCheckoutProtectionStatus(env);
  const enabled = env.STAGING_PUBLIC_CHECKOUT_ENABLED === 'true';
  const writesEnabled = env.STAGING_WRITE_ENABLED === 'true';
  return Object.freeze({
    enabled,
    implemented: true,
    stagingOnly: true,
    acceptsRealOrders: enabled && writesEnabled && protection.configured,
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

  return handleAcceptedCheckoutSubmit(request, env, requestId, {
    onOrderCommitted: options.onOrderCommitted
  });
}
