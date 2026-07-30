const MAX_STORED_ORDER_BYTES = 512 * 1024;

export function readStoredOrderForCompatibility(input = {}) {
  const warnings = [];
  const parsed = parseTopLevel(input);
  const root = record(parsed.value);
  const envelope = selectOrderEnvelope(root);
  const rawOrder = parseNestedRaw(firstDefined(root.raw, envelope.raw), warnings);
  const primary = rawOrder || envelope;
  const primaryItems = nonEmptyArray(primary.items);
  const rowItems = firstNonEmptyArray(
    envelope.orderItems,
    envelope.order_items,
    root.orderItems,
    root.order_items
  );
  const items = primaryItems || rowItems || (Array.isArray(primary.items) ? primary.items : []);

  if (!primaryItems && rowItems) warnings.push('LEGACY_ITEMS_READ_FROM_ROWS');
  if (!rawOrder && firstDefined(root.raw, envelope.raw)) warnings.push('LEGACY_RAW_FALLBACK_USED');

  const order = deepFreeze({
    schemaVersion: firstDefined(
      root.schemaVersion,
      root.schema_version,
      envelope.schemaVersion,
      envelope.schema_version,
      primary.schemaVersion,
      primary.schema_version
    ),
    orderNumber: firstText(
      root.orderNumber,
      root.order_number,
      envelope.orderNumber,
      envelope.order_number,
      primary.orderNumber,
      primary.order_number,
      primary.orderCode,
      primary.displayId,
      primary.id
    ),
    orderCode: firstText(primary.orderCode, primary.order_code, envelope.orderCode, envelope.order_code, root.orderCode, root.order_code),
    displayId: firstText(primary.displayId, primary.display_id, envelope.displayId, envelope.display_id, root.displayId, root.display_id),
    legacyId: firstText(primary.legacyId, primary.legacy_id, envelope.legacyId, envelope.legacy_id, root.legacyId, root.legacy_id),
    createdAt: firstText(
      root.createdAt,
      root.created_at,
      envelope.createdAt,
      envelope.created_at,
      primary.createdAt,
      primary.created_at
    ),
    updatedAt: firstText(
      root.updatedAt,
      root.updated_at,
      envelope.updatedAt,
      envelope.updated_at,
      primary.updatedAt,
      primary.updated_at
    ),
    status: firstText(root.status, envelope.status, primary.status, 'Novo'),
    seller: normalizeSeller(primary, envelope, root),
    customer: normalizeCustomer(primary, envelope, root),
    pricing: normalizePricing(primary, envelope, root),
    totals: normalizeTotals(primary, envelope, root),
    source: firstText(primary.source, envelope.source, root.source, parsed.storageMode === 'direct' ? 'catalog' : 'legacy-storage'),
    items: items.map(item => normalizeStoredItem(item, warnings)),
    qty: firstDefined(primary.qty, primary.quantity, envelope.qty, envelope.quantity, root.qty, root.quantity),
    warnings: unique([
      ...(Array.isArray(primary.warnings) ? primary.warnings : []),
      ...(Array.isArray(envelope.warnings) ? envelope.warnings : []),
      ...(Array.isArray(root.warnings) ? root.warnings : []),
      ...warnings
    ])
  });

  return deepFreeze({
    storageMode: rawOrder
      ? 'supabase-raw'
      : rowItems
        ? 'supabase-rows'
        : parsed.storageMode,
    order,
    warnings: order.warnings
  });
}

export function parseStoredOrderJson(value) {
  const text = String(value ?? '');
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_STORED_ORDER_BYTES) throw storedOrderError('STORED_ORDER_JSON_TOO_LARGE');

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw storedOrderError('STORED_ORDER_JSON_OBJECT_REQUIRED');
    }
    return parsed;
  } catch (error) {
    if (error?.code) throw error;
    throw storedOrderError('STORED_ORDER_JSON_INVALID');
  }
}

function parseTopLevel(input) {
  if (typeof input === 'string') {
    return { storageMode: 'kv-json', value: parseStoredOrderJson(input) };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw storedOrderError('STORED_ORDER_TYPE_INVALID');
  }
  return { storageMode: 'direct', value: input };
}

function selectOrderEnvelope(root) {
  if (record(root.order) !== EMPTY_RECORD) return root.order;
  if (record(root.data?.order) !== EMPTY_RECORD) return root.data.order;
  return root;
}

function parseNestedRaw(value, warnings) {
  if (!value) return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') {
    warnings.push('LEGACY_RAW_TYPE_INVALID');
    return null;
  }

  try {
    return parseStoredOrderJson(value);
  } catch (_) {
    warnings.push('LEGACY_RAW_INVALID_JSON');
    return null;
  }
}

function normalizeStoredItem(input, warnings) {
  const item = record(input);
  const details = firstDefined(
    item.details,
    parseOptionalJson(item.details_json, warnings, 'LEGACY_ITEM_DETAILS_INVALID_JSON'),
    {}
  );

  return deepFreeze({
    itemId: firstText(item.itemId, item.item_id),
    driveFileId: firstText(item.driveFileId, item.drive_file_id),
    code: firstText(item.code, item.codigo, item.id),
    originalName: firstText(item.originalName, item.original_name, item.fileName, item.file_name, item.filename, item.name),
    fileName: firstText(item.fileName, item.file_name, item.filename, item.originalName, item.original_name, item.name),
    theme: firstText(item.theme, item.tema),
    subtheme: firstText(item.subtheme, item.subtema),
    productKey: firstText(item.productKey, item.product_key),
    product: firstText(item.product, item.product_key, item.productName, item.product_name),
    productName: firstText(item.productName, item.product_name, item.product),
    variantKey: firstText(item.variantKey, item.variant_key, item.variant),
    sizeKey: firstText(item.sizeKey, item.size_key, item.size, item.dimension),
    quantity: firstDefined(item.quantity, item.qty, item.quantidade, 1),
    qty: firstDefined(item.qty, item.quantity, item.quantidade, 1),
    details,
    image: firstText(item.image, item.image_url, item.thumbnail)
  });
}

function normalizeSeller(primary, envelope, root) {
  const seller = firstRecord(primary.seller, envelope.seller, root.seller);
  if (seller !== EMPTY_RECORD) return cloneSerializable(seller);
  return deepFreeze({
    id: firstText(
      primary.sellerId,
      primary.seller_id,
      envelope.sellerId,
      envelope.seller_id,
      root.sellerId,
      root.seller_id
    ),
    label: firstText(
      primary.sellerName,
      primary.seller_name,
      envelope.sellerName,
      envelope.seller_name,
      root.sellerName,
      root.seller_name
    ),
    name: firstText(
      primary.sellerName,
      primary.seller_name,
      envelope.sellerName,
      envelope.seller_name,
      root.sellerName,
      root.seller_name
    )
  });
}

function normalizeCustomer(primary, envelope, root) {
  const customer = firstRecord(primary.customer, envelope.customer, root.customer);
  if (customer !== EMPTY_RECORD) return cloneSerializable(customer);
  return deepFreeze({
    name: firstText(
      primary.customerName,
      primary.customer_name,
      envelope.customerName,
      envelope.customer_name,
      root.customerName,
      root.customer_name
    ),
    whatsapp: firstText(
      primary.customerWhatsapp,
      primary.customer_whatsapp,
      envelope.customerWhatsapp,
      envelope.customer_whatsapp,
      root.customerWhatsapp,
      root.customer_whatsapp,
      primary.customerPhone,
      primary.customer_phone,
      envelope.customerPhone,
      envelope.customer_phone,
      root.customerPhone,
      root.customer_phone
    ),
    phone: firstText(
      primary.customerPhone,
      primary.customer_phone,
      envelope.customerPhone,
      envelope.customer_phone,
      root.customerPhone,
      root.customer_phone,
      primary.customerWhatsapp,
      primary.customer_whatsapp,
      envelope.customerWhatsapp,
      envelope.customer_whatsapp,
      root.customerWhatsapp,
      root.customer_whatsapp
    )
  });
}

function normalizePricing(primary, envelope, root) {
  const pricing = firstRecord(
    primary.pricing,
    envelope.pricing,
    root.pricing,
    primary.totals,
    envelope.totals,
    root.totals
  );
  if (pricing !== EMPTY_RECORD) return cloneSerializable(pricing);
  return scalarPricing(primary, envelope, root);
}

function normalizeTotals(primary, envelope, root) {
  const totals = firstRecord(
    primary.totals,
    envelope.totals,
    root.totals,
    primary.pricing,
    envelope.pricing,
    root.pricing
  );
  if (totals !== EMPTY_RECORD) return cloneSerializable(totals);
  return scalarPricing(primary, envelope, root);
}

function scalarPricing(primary, envelope, root) {
  return deepFreeze({
    currency: firstText(primary.currency, envelope.currency, root.currency, 'BRL'),
    subtotal: firstDefined(primary.subtotal, envelope.subtotal, root.subtotal),
    discountPercent: firstDefined(
      primary.discountPercent,
      primary.discount_percent,
      envelope.discountPercent,
      envelope.discount_percent,
      root.discountPercent,
      root.discount_percent
    ),
    discountAmount: firstDefined(
      primary.discountAmount,
      primary.discount_amount,
      envelope.discountAmount,
      envelope.discount_amount,
      root.discountAmount,
      root.discount_amount
    ),
    total: firstDefined(primary.total, envelope.total, root.total)
  });
}

function parseOptionalJson(value, warnings, warning) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch (_) {
    warnings.push(warning);
    return undefined;
  }
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length ? value : null;
}

function firstNonEmptyArray(...values) {
  return values.find(value => Array.isArray(value) && value.length) || null;
}

function firstRecord(...values) {
  for (const value of values) {
    const candidate = record(value);
    if (candidate !== EMPTY_RECORD) return candidate;
  }
  return EMPTY_RECORD;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function cloneSerializable(value) {
  try {
    return deepFreeze(JSON.parse(JSON.stringify(value)));
  } catch (_) {
    return deepFreeze({});
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function storedOrderError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

const EMPTY_RECORD = Object.freeze({});

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : EMPTY_RECORD;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

export { MAX_STORED_ORDER_BYTES };
