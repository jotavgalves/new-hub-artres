import { fetchStagingWorker, OrderLedger } from './index.js';
import {
  scheduleSupabaseShadowProjection,
  supabaseShadowStatus
} from './supabase-shadow-projector.js';

export { OrderLedger };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const shadowStatus = supabaseShadowStatus(env);
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
      return augmentHealthResponse(response, shadowStatus);
    }

    return response;
  }
};

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
