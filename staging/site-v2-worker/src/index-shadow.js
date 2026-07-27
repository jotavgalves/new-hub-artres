import { createAtomicLedgerCommandV2 } from '../../../src/v2/orders/atomic-command.mjs';
import { orderLedgerShardName } from '../../../src/v2/orders/order-number.mjs';
import baseWorker, { OrderLedger } from './index.js';
import {
  STAGING_CATALOG_ITEMS,
  STAGING_CATALOG_VERSION,
  STAGING_CONFIG_VERSION,
  STAGING_PRODUCT_SNAPSHOT
} from './staging-catalog-fixture.js';
import {
  projectOrderToSupabase,
  supabaseShadowStatus
} from './supabase-shadow-projector.js';

export { OrderLedger };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const shadowStatus = supabaseShadowStatus(env);
    const captureSubmission =
      url.pathname === '/internal/v2/orders/submit' &&
      request.method === 'POST' &&
      shadowStatus.enabled &&
      shadowStatus.configured;
    const submissionRequest = captureSubmission ? request.clone() : null;
    const submissionBodyTask = submissionRequest
      ? submissionRequest.json().then(
          body => ({ ok: true, body }),
          error => ({ ok: false, error })
        )
      : null;
    const idempotencyKey = submissionRequest?.headers.get('idempotency-key') || '';

    const response = await baseWorker.fetch(request, env, ctx);

    if (url.pathname === '/health' && request.method === 'GET') {
      return augmentHealthResponse(response, shadowStatus);
    }

    if (captureSubmission && (response.status === 200 || response.status === 201)) {
      const task = projectSuccessfulSubmission({
        bodyTask: submissionBodyTask,
        idempotencyKey,
        response: response.clone(),
        env
      }).catch(error => {
        console.error(JSON.stringify({
          level: 'error',
          event: 'supabase-shadow-projection-failed',
          code: publicShadowErrorCode(error)
        }));
      });

      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
      else void task;
    }

    return response;
  }
};

async function projectSuccessfulSubmission({ bodyTask, idempotencyKey, response, env }) {
  const [bodyResult, submission] = await Promise.all([
    bodyTask,
    response.json()
  ]);
  if (!bodyResult?.ok || !bodyResult.body || typeof bodyResult.body !== 'object') {
    throw shadowError('SUPABASE_SHADOW_SUBMISSION_BODY_INVALID');
  }
  const body = bodyResult.body;

  const orderNumber = String(submission?.orderNumber || '').trim().toUpperCase();
  if (!submission?.ok || !/^PED\d{7}[A-Z]$/.test(orderNumber)) {
    throw shadowError('SUPABASE_SHADOW_SUBMISSION_RESPONSE_INVALID');
  }

  const command = await createAtomicLedgerCommandV2({
    idempotencyKey,
    submissionCreatedAt: body.submissionCreatedAt,
    body,
    catalogItems: STAGING_CATALOG_ITEMS,
    productSnapshot: STAGING_PRODUCT_SNAPSHOT,
    catalogVersion: STAGING_CATALOG_VERSION,
    configVersion: STAGING_CONFIG_VERSION,
    serverDiscountPercent: 0,
    productRegistryVersion: 1,
    mode: 'active',
    source: 'catalog-v2-staging-synthetic',
    requestId: submission.requestId,
    actor: 'staging-synthetic'
  });

  const order = await ledgerStub(env, command.submissionCreatedAt).getOrder(orderNumber);
  if (!order) throw shadowError('SUPABASE_SHADOW_LEDGER_ORDER_MISSING');

  const result = await projectOrderToSupabase({
    env,
    command,
    result: {
      orderNumber,
      order
    }
  });

  console.log(JSON.stringify({
    level: 'info',
    event: 'supabase-shadow-projection-succeeded',
    requestId: safeText(submission.requestId, 100),
    orderNumber: result.orderNumber,
    action: result.action,
    latencyMs: result.latencyMs
  }));
}

async function augmentHealthResponse(response, shadowStatus) {
  if (response.status !== 200) return response;

  try {
    const payload = await response.clone().json();
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(JSON.stringify({
      ...payload,
      supabaseShadow: shadowStatus
    }), {
      status: response.status,
      headers
    });
  } catch (_) {
    return response;
  }
}

function ledgerStub(env, createdAt) {
  return env.ORDER_LEDGER.getByName(orderLedgerShardName(createdAt));
}

function publicShadowErrorCode(error) {
  const code = String(error?.code || '').trim().toUpperCase();
  return /^SUPABASE_SHADOW_[A-Z0-9_]{1,80}$/.test(code)
    ? code
    : 'SUPABASE_SHADOW_PREPARATION_FAILED';
}

function safeText(value, maximum) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._:@-]/g, '')
    .slice(0, maximum);
}

function shadowError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
