import { createAtomicLedgerCommandV2 } from '../../../src/v2/orders/atomic-command.mjs';
import { createCanonicalItemV2 } from '../../../src/v2/orders/schema.mjs';
import {
  STAGING_CONFIG_VERSION,
  STAGING_PRODUCT_SNAPSHOT
} from './staging-catalog-fixture.js';

export async function prepareAcceptedCheckoutCanonicalDraft(input = {}) {
  const body = record(input.body);
  const resolved = record(input.resolved);
  const validated = record(input.validated);
  const priced = record(input.priced);
  const quote = record(priced.quote);
  const requestId = safeRequestId(input.requestId);
  const submissionCreatedAt = validIsoDate(input.submissionCreatedAt) || new Date().toISOString();
  const idempotencyKey = input.idempotencyKey === undefined
    ? previewIdempotencyKey(requestId)
    : String(input.idempotencyKey || '').trim();
  const source = safeSource(input.source, 'catalog-v2-staging-accepted-preview');
  const actor = safeActor(input.actor, 'staging-checkout-preview');

  if (!requestId) throw draftError('CHECKOUT_DRAFT_REQUEST_ID_INVALID');
  validateParties(body);
  if (!Array.isArray(resolved.items) || !resolved.items.length) {
    throw draftError('CHECKOUT_DRAFT_CATALOG_ITEMS_REQUIRED');
  }
  if (!Array.isArray(validated.items) || !validated.items.length) {
    throw draftError('CHECKOUT_DRAFT_VALIDATED_ITEMS_REQUIRED');
  }
  if (!Array.isArray(quote.items) || quote.items.length !== validated.items.length) {
    throw draftError('CHECKOUT_DRAFT_PRICED_ITEMS_INVALID');
  }

  const command = await createAtomicLedgerCommandV2({
    idempotencyKey,
    submissionCreatedAt,
    body: {
      status: body.status || 'Novo',
      seller: body.seller,
      customer: body.customer,
      items: quote.items,
      totals: quote.pricing
    },
    catalogItems: resolved.items,
    productSnapshot: STAGING_PRODUCT_SNAPSHOT,
    catalogVersion: positiveInteger(resolved.catalogVersion),
    configVersion: STAGING_CONFIG_VERSION,
    serverDiscountPercent: Number(quote.pricing?.discountPercent || 0),
    productRegistryVersion: 1,
    mode: 'active',
    source,
    requestId,
    actor
  });

  assertPreservedContract(command, validated.items, quote.items);
  return deepFreeze({
    ok: true,
    dryRun: input.dryRun !== false,
    writesPerformed: false,
    command,
    summary: commandSummary(command)
  });
}

function validateParties(body) {
  const seller = record(body.seller);
  const customer = record(body.customer);
  const sellerId = identity(seller.id || seller.sellerId || seller.username);
  const customerName = clean(customer.name || customer.nome);
  const whatsapp = digits(customer.whatsapp || customer.phone);

  if (!sellerId) throw draftError('SELLER_REQUIRED');
  if (!customerName) throw draftError('CUSTOMER_NAME_REQUIRED');
  if (whatsapp.length < 10 || whatsapp.length > 20) {
    throw draftError('CUSTOMER_WHATSAPP_INVALID');
  }
}

function assertPreservedContract(command, validatedItems, quoteItems) {
  const order = command?.preparedOrder;
  if (!order || order.schemaVersion !== 2) throw draftError('CHECKOUT_DRAFT_ORDER_INVALID');
  if (!Array.isArray(order.items) || order.items.length !== validatedItems.length) {
    throw draftError('CHECKOUT_DRAFT_ITEM_COUNT_MISMATCH');
  }

  for (let index = 0; index < order.items.length; index += 1) {
    const canonical = order.items[index];
    const validated = validatedItems[index];
    const expected = createCanonicalItemV2(quoteItems[index]);
    if (canonical.itemId !== validated.itemId) throw draftError('CHECKOUT_DRAFT_ITEM_ID_MISMATCH');
    if (canonical.driveFileId !== validated.driveFileId) {
      throw draftError('CHECKOUT_DRAFT_DRIVE_FILE_ID_MISMATCH');
    }
    if (canonical.productKey !== validated.productKey) {
      throw draftError('CHECKOUT_DRAFT_PRODUCT_MISMATCH');
    }
    if (canonical.variantKey !== validated.variantKey) {
      throw draftError('CHECKOUT_DRAFT_VARIANT_MISMATCH');
    }
    if (canonical.sizeKey !== validated.sizeKey) throw draftError('CHECKOUT_DRAFT_SIZE_MISMATCH');
    if (!sameJson(canonical.details, expected.details)) {
      throw draftError('CHECKOUT_DRAFT_DETAILS_MISMATCH');
    }
  }
}

function commandSummary(command) {
  const order = command.preparedOrder;
  const details = order.items.map(item => record(item.details));
  return deepFreeze({
    schemaVersion: order.schemaVersion,
    status: order.status,
    sellerPresent: Boolean(order.seller?.id),
    sellerLabelPresent: Boolean(order.seller?.label),
    customerNamePresent: Boolean(order.customer?.name),
    customerWhatsappPresent: Boolean(order.customer?.whatsapp),
    customerPhonePresent: Boolean(order.customer?.phone),
    itemCount: order.items.length,
    quantity: order.qty,
    pricing: order.pricing,
    catalogVersion: order.integrity?.catalogVersion,
    configVersion: order.integrity?.configVersion,
    detailsItemCount: details.filter(value => Object.keys(value).length > 0).length,
    measurementsItemCount: details.filter(value => value.measurements !== undefined).length,
    observationsItemCount: details.filter(value => value.observations !== undefined).length,
    personalizationItemCount: details.filter(value => value.personalization !== undefined).length,
    canonicalFingerprintReady: /^[a-f0-9]{64}$/.test(String(command.fingerprint || '')),
    idempotencyStorageKeyReady: /^idempotency:v2:[a-f0-9]{64}$/.test(String(command.idempotencyKey || ''))
  });
}

function previewIdempotencyKey(requestId) {
  const suffix = requestId.slice(0, 100);
  const value = `checkout-preview:${suffix}`;
  return value.length >= 16 ? value.slice(0, 128) : `checkout-preview:${suffix.padEnd(16, '0')}`;
}

function safeSource(value, fallback) {
  const text = clean(value || fallback);
  return /^[A-Za-z0-9._:-]{1,160}$/.test(text) ? text : fallback;
}

function safeActor(value, fallback) {
  const text = clean(value || fallback);
  return /^[A-Za-z0-9._:@-]{1,120}$/.test(text) ? text : fallback;
}

function safeRequestId(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,100}$/.test(text) ? text : '';
}

function validIsoDate(value) {
  const date = new Date(String(value || ''));
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

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function draftError(code) {
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
