import { createOrderIntentFingerprint, normalizeIdempotencyKey } from './idempotency.mjs';
import { priceOrderIntentV2, validatePricingQuoteV2 } from './pricing.mjs';
import { createCanonicalItemV2, roundMoney } from './schema.mjs';
import { validateLedgerSubmissionCommand } from '../persistence/order-ledger-port.mjs';

export async function createAtomicLedgerCommandV2(input = {}) {
  const submissionCreatedAt = validIsoDate(input.submissionCreatedAt);
  if (!submissionCreatedAt) throw commandError('SUBMISSION_CREATED_AT_INVALID');

  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? input.body
    : {};

  const quote = priceOrderIntentV2({
    items: body.items,
    catalogItems: input.catalogItems,
    productSnapshot: input.productSnapshot,
    catalogVersion: input.catalogVersion,
    configVersion: input.configVersion,
    serverDiscountPercent: input.serverDiscountPercent,
    clientTotals: body.totals || body.pricing,
    allowPassiveSimulation: input.mode !== 'active'
  });

  const quoteValidation = validatePricingQuoteV2(quote);
  if (!quoteValidation.ok) {
    const error = commandError('PRICING_QUOTE_INVALID');
    error.details = quoteValidation.errors;
    throw error;
  }

  const items = quote.items.map(item => createCanonicalItemV2(item));
  const subtotal = roundMoney(items.reduce((sum, item) => sum + item.lineSubtotal, 0));
  const discountPercent = Number(quote.pricing.discountPercent || 0);
  const discountAmount = roundMoney(subtotal * (discountPercent / 100));
  const total = roundMoney(Math.max(0, subtotal - discountAmount));

  const preparedOrder = deepFreeze({
    schemaVersion: 2,
    status: clean(body.status || 'Novo'),
    seller: sanitizeSeller(body.seller),
    customer: sanitizeCustomer(body.customer),
    items,
    qty: items.reduce((sum, item) => sum + item.quantity, 0),
    pricing: {
      currency: 'BRL',
      subtotal,
      discountPercent,
      discountAmount,
      total,
      calculationVersion: 1
    },
    integrity: {
      catalogVersion: positiveInteger(quote.integrity.catalogVersion),
      configVersion: positiveInteger(quote.integrity.configVersion),
      productRegistryVersion: positiveInteger(input.productRegistryVersion) || 1,
      requestItemCount: Array.isArray(body.items) ? body.items.length : 0,
      canonicalItemCount: items.length
    },
    source: clean(input.source || 'catalog-v2-staging'),
    createdAt: submissionCreatedAt,
    updatedAt: submissionCreatedAt
  });

  const fingerprint = await createOrderIntentFingerprint(preparedOrder);
  const validation = validateLedgerSubmissionCommand({
    idempotencyKey,
    fingerprint,
    submissionCreatedAt,
    preparedOrder,
    requestId: input.requestId,
    actor: input.actor || 'catalog-v2-staging'
  });

  if (!validation.ok) {
    const error = commandError('ATOMIC_LEDGER_COMMAND_INVALID');
    error.details = validation.errors;
    throw error;
  }

  return deepFreeze({
    ...validation.command,
    quoteWarnings: [...quote.warnings]
  });
}

function sanitizeSeller(value = {}) {
  return deepFreeze({
    id: identity(value?.id || value?.sellerId || value?.username),
    label: clean(value?.label || value?.name).slice(0, 120)
  });
}

function sanitizeCustomer(value = {}) {
  return deepFreeze({
    name: clean(value?.name || value?.nome).slice(0, 160),
    whatsapp: digits(value?.whatsapp || value?.phone).slice(0, 20),
    phone: digits(value?.phone || value?.whatsapp).slice(0, 20)
  });
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function identity(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function commandError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
