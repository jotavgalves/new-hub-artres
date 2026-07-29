import { resolveAcceptedCatalogCheckoutItems } from './accepted-catalog-checkout-resolver.js';
import { validateAcceptedCheckoutItems } from './accepted-checkout-item-validator.js';

const MAX_JSON_BYTES = 128 * 1024;

export async function handleCheckoutValidationPreview(request, env, requestId, options = {}) {
  if (request.method !== 'POST') return methodNotAllowed(['POST'], requestId);

  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return json({ ok: false, error: 'CONTENT_TYPE_NOT_JSON', requestId }, 415);
  }

  try {
    const body = await readJsonBody(request, MAX_JSON_BYTES);
    const requestItems = Array.isArray(body.items) ? body.items : [];
    const driveFileIds = requestItems.map(item => item?.driveFileId || item?.id || '');

    const resolveItems = options.resolveItems || resolveAcceptedCatalogCheckoutItems;
    const validateItems = options.validateItems || validateAcceptedCheckoutItems;
    const resolved = await resolveItems(driveFileIds, env, options);
    const validated = validateItems(requestItems, resolved.items);

    return json({
      ok: true,
      dryRun: true,
      writesPerformed: false,
      requestId,
      catalogVersion: Number(resolved.catalogVersion),
      itemCount: Number(validated.itemCount),
      productKeys: validated.productKeys,
      variantKeys: validated.variantKeys,
      sizeKeys: validated.sizeKeys
    });
  } catch (error) {
    const code = publicErrorCode(error);
    return json({
      ok: false,
      error: code,
      requestId,
      ...(Number.isInteger(error?.itemIndex) ? { itemIndex: error.itemIndex } : {})
    }, statusForError(code));
  }
}

async function readJsonBody(request, maxBytes) {
  const declaredLength = Number.parseInt(request.headers.get('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw routeError('REQUEST_BODY_TOO_LARGE');
  }

  const text = await readLimitedText(request, maxBytes);
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw routeError('INVALID_JSON');
    }
    return payload;
  } catch (error) {
    if (error?.code === 'INVALID_JSON') throw error;
    throw routeError('INVALID_JSON');
  }
}

async function readLimitedText(request, maxBytes) {
  if (!request.body) return '';
  if (!request.body.getReader) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw routeError('REQUEST_BODY_TOO_LARGE');
    }
    return text;
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('REQUEST_BODY_TOO_LARGE').catch(() => {});
        throw routeError('REQUEST_BODY_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

function publicErrorCode(error) {
  const code = String(error?.code || error?.message || 'CHECKOUT_VALIDATION_FAILED');
  return /^[A-Z0-9_]{3,100}$/.test(code) ? code : 'CHECKOUT_VALIDATION_FAILED';
}

function statusForError(code) {
  if (code === 'CONTENT_TYPE_NOT_JSON') return 415;
  if (code === 'REQUEST_BODY_TOO_LARGE') return 413;
  if (code === 'INVALID_JSON') return 400;
  if (code.includes('TIMEOUT')) return 504;
  if (code.includes('NOT_CONFIGURED') || code.includes('DISABLED')) return 503;
  if (code.includes('RPC_') || code.includes('RESPONSE_TOO_LARGE')) return 502;
  if (
    code.includes('INVALID') ||
    code.includes('REQUIRED') ||
    code.includes('MISMATCH') ||
    code.includes('NOT_FOUND') ||
    code.includes('NOT_ALLOWED') ||
    code.includes('DUPLICATED') ||
    code.includes('LIMIT_EXCEEDED')
  ) return 422;
  return 500;
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

function routeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
