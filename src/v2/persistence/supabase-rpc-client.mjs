export const DEFAULT_SUPABASE_RPC_RESPONSE_BYTES = 64 * 1024;

export class SupabaseRpcClient {
  #url;
  #key;
  #fetch;
  #schema;
  #timeoutMs;
  #maxResponseBytes;

  constructor(options = {}) {
    this.#url = normalizeSupabaseUrl(options.url);
    this.#key = clean(options.serviceKey || options.secretKey);
    this.#fetch = options.fetch || globalThis.fetch;
    this.#schema = identifier(options.schema || 'public');
    this.#timeoutMs = nonnegativeInteger(options.timeoutMs);
    this.#maxResponseBytes = positiveInteger(options.maxResponseBytes) || DEFAULT_SUPABASE_RPC_RESPONSE_BYTES;

    if (!this.#url) throw rpcError('SUPABASE_URL_INVALID');
    if (this.#key.length < 20) throw rpcError('SUPABASE_SECRET_KEY_INVALID');
    if (typeof this.#fetch !== 'function') throw rpcError('SUPABASE_FETCH_REQUIRED');
    if (!this.#schema) throw rpcError('SUPABASE_SCHEMA_INVALID');
  }

  get schema() {
    return this.#schema;
  }

  async call(functionName, body = {}) {
    const rpcName = identifier(functionName);
    if (!rpcName) throw rpcError('SUPABASE_RPC_FUNCTION_INVALID');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw rpcError('SUPABASE_RPC_BODY_INVALID');
    }

    const controller = this.#timeoutMs > 0 ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.#timeoutMs)
      : null;

    try {
      const response = await Reflect.apply(this.#fetch, globalThis, [
        `${this.#url}/rest/v1/rpc/${encodeURIComponent(rpcName)}`,
        {
          method: 'POST',
          headers: {
            apikey: this.#key,
            Authorization: `Bearer ${this.#key}`,
            'Content-Type': 'application/json',
            'Content-Profile': this.#schema,
            Accept: 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify(body),
          ...(controller ? { signal: controller.signal } : {})
        }
      ]);

      const text = await readLimitedResponseText(response, this.#maxResponseBytes);
      const payload = parsePayload(text);

      if (!response.ok) {
        const error = rpcError('SUPABASE_RPC_REQUEST_FAILED');
        error.status = Number(response.status || 0);
        error.remoteCode = safeRemoteText(payload?.code, this.#key, 80);
        error.remoteMessage = safeRemoteText(
          payload?.message || payload?.details || payload?.hint,
          this.#key,
          240
        );
        throw error;
      }

      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw rpcError('SUPABASE_RPC_TIMEOUT');
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function normalizeSupabaseUrl(value) {
  const text = clean(value).replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  if (!text) return '';
  try {
    const url = new URL(text);
    const cleanAuthority = !url.username && !url.password && !url.search && !url.hash;
    if (url.protocol !== 'https:' || !cleanAuthority) return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

async function readLimitedResponseText(response, maxBytes) {
  const declaredLength = Number.parseInt(response?.headers?.get?.('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw rpcError('SUPABASE_RPC_RESPONSE_TOO_LARGE');
  }

  if (!response?.body?.getReader) {
    const text = await response.text().catch(() => '');
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw rpcError('SUPABASE_RPC_RESPONSE_TOO_LARGE');
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('SUPABASE_RPC_RESPONSE_TOO_LARGE').catch(() => {});
        throw rpcError('SUPABASE_RPC_RESPONSE_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function parsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function safeRemoteText(value, secret, maxLength) {
  const text = clean(value);
  if (!text) return '';
  const redacted = secret ? text.split(secret).join('[REDACTED]') : text;
  return redacted.slice(0, maxLength);
}

function identifier(value) {
  const text = clean(value);
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text) ? text : '';
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonnegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function rpcError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
