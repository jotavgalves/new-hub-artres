const PUBLIC_CHECKOUT_ROUTE = '/api/orders/v2';

export function publicCheckoutStatus(env = {}) {
  return Object.freeze({
    enabled: env.STAGING_PUBLIC_CHECKOUT_ENABLED === 'true',
    implemented: false,
    stagingOnly: true,
    acceptsRealOrders: false,
    route: PUBLIC_CHECKOUT_ROUTE,
    source: 'catalog-v2-accepted'
  });
}

export async function handlePublicCheckoutRoute(request, env, requestId) {
  if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId);

  if (String(env.ENVIRONMENT || '').trim() !== 'staging') {
    return json({ ok: false, error: 'PUBLIC_CHECKOUT_STAGING_ONLY', requestId }, 404);
  }

  const status = publicCheckoutStatus(env);
  if (!status.enabled) {
    return json({ ok: false, error: 'PUBLIC_CHECKOUT_DISABLED', requestId }, 503);
  }

  if (!sameOriginRequest(request)) {
    return json({ ok: false, error: 'PUBLIC_CHECKOUT_ORIGIN_NOT_ALLOWED', requestId }, 403);
  }

  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return json({ ok: false, error: 'CONTENT_TYPE_NOT_JSON', requestId }, 415);
  }

  const idempotencyKey = String(request.headers.get('idempotency-key') || '').trim();
  if (idempotencyKey.length < 16 || idempotencyKey.length > 200) {
    return json({ ok: false, error: 'IDEMPOTENCY_KEY_INVALID', requestId }, 422);
  }

  // Barreira deliberada da primeira etapa. A rota existe para que contrato,
  // origem, método e idempotência sejam testados antes de qualquer escrita.
  // A implementação que resolve catálogo e cria o pedido será entregue em PR
  // separado e continuará restrita ao staging até o smoke remoto integral.
  return json({ ok: false, error: 'PUBLIC_CHECKOUT_IMPLEMENTATION_PENDING', requestId }, 503);
}

function sameOriginRequest(request) {
  const origin = String(request.headers.get('origin') || '').trim();
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch (_) {
    return false;
  }
}

function methodNotAllowed(methods, requestId) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED', requestId }, 405, {
    Allow: methods.join(', ')
  });
}

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    }
  });
}
