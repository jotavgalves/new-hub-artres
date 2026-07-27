import { buildItemId } from '../products/registry.mjs';
import { resolveCatalogProductKey } from '../products/catalog-references.mjs';

export function adaptOrderForV2(input = {}) {
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const items = rawItems.map((item, index) => adaptOrderItem(item, index));
  const modes = new Set(items.map(item => item.identityStatus));

  let compatibilityMode = 'adapted-legacy';
  if (modes.size === 1 && modes.has('verified')) compatibilityMode = 'native-v2';
  else if (modes.has('verified') || modes.has('derived-v2')) compatibilityMode = 'mixed';

  const warnings = unique([
    ...(Array.isArray(input.warnings) ? input.warnings : []),
    ...items.flatMap(item => item.warnings || [])
  ]);

  return deepFreeze({
    schemaVersion: Number(input.schemaVersion) === 2 ? 2 : 1,
    compatibilityMode,
    orderNumber: clean(input.orderNumber || input.orderCode || input.displayId || input.id),
    legacyId: clean(input.legacyId),
    createdAt: validIsoDate(input.createdAt),
    updatedAt: validIsoDate(input.updatedAt),
    status: clean(input.status || 'Novo'),
    seller: sanitizeSeller(input.seller),
    customer: sanitizeCustomer(input.customer),
    pricing: sanitizePricing(input.pricing || input.totals),
    source: clean(input.source || 'catalog'),
    items,
    qty: items.reduce((sum, item) => sum + item.quantity, 0),
    warnings
  });
}

export function adaptOrderItem(input = {}, index = 0) {
  const warnings = [];
  const driveFileId = identity(input.driveFileId || input.drive_file_id);
  const code = cleanCode(input.code || input.codigo || input.id);
  const productKey = resolveCatalogProductKey(
    input.productKey || input.product || input.productName || input.product_name
  );
  const productName = clean(input.productName || input.product_name || input.product || productKey || 'Produto não identificado');
  const variantKey = identity(input.variantKey || input.variant || input.details?.variant || 'default') || 'default';
  const sizeKey = identity(
    input.sizeKey || input.size || input.dimension || input.details?.size || input.details?.dimension || 'default'
  ) || 'default';
  const fileName = clean(
    input.originalName || input.fileName || input.filename || input.name || input.nome
  );
  const theme = clean(input.theme || input.tema);
  const subtheme = clean(input.subtheme || input.subtema);
  const quantity = clampQuantity(input.quantity ?? input.qty ?? input.quantidade);
  const details = sanitizeDetails(input.details || {});

  if (!code) warnings.push('ITEM_CODE_MISSING');
  if (!productKey) warnings.push('PRODUCT_KEY_UNRESOLVED');
  if (!driveFileId) warnings.push('DRIVE_FILE_ID_MISSING');
  if (!fileName) warnings.push('FILE_NAME_MISSING');

  let itemId = clean(input.itemId || input.item_id);
  let identityStatus = 'unresolved-legacy';

  if (driveFileId && productKey) {
    const expectedItemId = buildItemId({ driveFileId, productKey, variantKey, sizeKey });
    if (itemId && itemId === expectedItemId) identityStatus = 'verified';
    else {
      itemId = expectedItemId;
      identityStatus = 'derived-v2';
      if (input.itemId || input.item_id) warnings.push('ITEM_ID_REBUILT');
    }
  } else {
    itemId = `legacy-${legacyFingerprint({
      index,
      code,
      theme,
      subtheme,
      productKey: productKey || '',
      productName,
      variantKey,
      sizeKey,
      fileName
    })}`;
  }

  return deepFreeze({
    itemId,
    identityStatus,
    driveFileId,
    code,
    fileName,
    theme,
    subtheme,
    productKey: productKey || '',
    productName,
    variantKey,
    sizeKey,
    quantity,
    details,
    warnings: unique(warnings)
  });
}

export function legacyFingerprint(value) {
  const text = stableSerialize(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

function sanitizeSeller(value = {}) {
  return deepFreeze({
    id: identity(value?.id || value?.sellerId || value?.username),
    name: clean(value?.label || value?.name || value?.nome)
  });
}

function sanitizeCustomer(value = {}) {
  return deepFreeze({
    name: clean(value?.name || value?.nome).slice(0, 160),
    whatsapp: digits(value?.whatsapp || value?.phone).slice(0, 20),
    phone: digits(value?.phone || value?.whatsapp).slice(0, 20)
  });
}

function sanitizePricing(value = {}) {
  const currency = clean(value?.currency || 'BRL') || 'BRL';
  return deepFreeze({
    currency,
    subtotal: nullableMoney(value?.subtotal ?? value?.gross),
    discountPercent: nullableNumber(value?.discountPercent),
    discountAmount: nullableMoney(value?.discountAmount ?? value?.discount),
    total: nullableMoney(value?.total)
  });
}

function sanitizeDetails(value, depth = 0) {
  if (depth > 5) return null;
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') return value.trim().slice(0, 300);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return deepFreeze(value.slice(0, 30).map(item => sanitizeDetails(item, depth + 1)));
  if (typeof value !== 'object') return null;

  const entries = Object.entries(value)
    .slice(0, 50)
    .map(([key, nested]) => [safeKey(key), sanitizeDetails(nested, depth + 1)])
    .filter(([key]) => key);

  return deepFreeze(Object.fromEntries(entries));
}

function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
}

function clampQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 999);
}

function nullableMoney(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null;
}

function nullableNumber(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanCode(value) {
  return String(value ?? '').replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function identity(value) {
  return clean(value)
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function safeKey(value) {
  return identity(value).slice(0, 80);
}

function validIsoDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
