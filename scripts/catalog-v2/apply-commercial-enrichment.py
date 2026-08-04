from pathlib import Path

route = Path('functions/api/catalog-v2.js')
text = route.read_text(encoding='utf-8')
old_call = """      productKey,
      folderId,
      query,
      limit: 80
"""
new_call = """      productKey,
      folderId,
      query,
      limit: 80,
      commercial
"""
if new_call not in text:
    if old_call not in text:
        raise SystemExit('CATALOG_COMMERCIAL_CALL_TARGET_NOT_FOUND')
    text = text.replace(old_call, new_call, 1)
route.write_text(text, encoding='utf-8')

adapter = Path('functions/api/_accepted_catalog.js')
text = adapter.read_text(encoding='utf-8')

replacements = [
    (
        "return normalizeAcceptedPayload(await rpc(config, name, body), productKey);",
        "return normalizeAcceptedPayload(await rpc(config, name, body), productKey, input.commercial);",
        2,
        'accepted payload calls',
    ),
    (
        "function normalizeAcceptedPayload(payload, productKey) {",
        "function normalizeAcceptedPayload(payload, productKey, commercial) {",
        1,
        'accepted payload signature',
    ),
]
for old, new, expected, label in replacements:
    if new in text and old not in text:
        continue
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected}, found {count}')
    text = text.replace(old, new, expected)

old_map = """      const clean = scrubPrivateFields(entry);
      return {
        ...clean,
        product: productKey,
        productKey,
        catalogRootDriveId: ROOTS[productKey],
        rootVerified: true
      };
"""
new_map = """      const clean = enrichCommercial(scrubPrivateFields(entry), key, commercial, productKey);
      return {
        ...clean,
        product: productKey,
        productKey,
        catalogRootDriveId: ROOTS[productKey],
        rootVerified: true
      };
"""
if new_map not in text:
    if old_map not in text:
        raise SystemExit('ACCEPTED_COMMERCIAL_MAP_TARGET_NOT_FOUND')
    text = text.replace(old_map, new_map, 1)

marker = """function scrubPrivateFields(entry) {
  const clean = entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...entry } : {};
  for (const key of PRIVATE_PAYLOAD_FIELDS) delete clean[key];
  return clean;
}

function canonicalProduct(value) {"""
helpers = """function scrubPrivateFields(entry) {
  const clean = entry && typeof entry === 'object' && !Array.isArray(entry) ? { ...entry } : {};
  for (const key of PRIVATE_PAYLOAD_FIELDS) delete clean[key];
  return clean;
}

function enrichCommercial(entry, collectionKey, commercial, productKey) {
  const config = normalizeCommercial(commercial, productKey);
  const clean = { ...entry };
  clean.productName = config.label;
  clean.productLabel = config.label;
  if (collectionKey === 'items') {
    clean.unitPrice = config.unitPrice;
    clean.price = config.unitPrice;
    clean.size = config.sizeKey;
    clean.sizeKey = config.sizeKey;
    clean.details = { ...(clean.details && typeof clean.details === 'object' ? clean.details : {}), size: config.sizeKey };
  }
  if (clean.kind === 'product' || clean.type === 'product') {
    clean.name = config.label;
    clean.rawName = config.label;
    clean.label = config.label;
    clean.unitPrice = config.unitPrice;
    clean.price = config.unitPrice;
    clean.priceLabel = `${moneyBR(config.unitPrice)} cada`;
    clean.minQty = config.minimum;
    clean.step = config.step;
    clean.initialQuantity = config.initial;
    clean.checkoutEnabled = config.enabled;
  }
  return clean;
}

function normalizeCommercial(value, productKey) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const defaults = productKey === '50x50'
    ? { label: 'Bolinhas 50x50', unitPrice: 0, minimum: 6, step: 2, initial: 6, enabled: false, sizeKey: '50X50' }
    : { label: 'Painel 150 cm', unitPrice: 0, minimum: 1, step: 1, initial: 1, enabled: false, sizeKey: '150X150' };
  const unitPrice = nonNegativeNumber(raw.unitPrice, defaults.unitPrice);
  return {
    label: safeText(raw.label, 200) || defaults.label,
    unitPrice,
    minimum: positiveNumber(raw.minimum, defaults.minimum),
    step: positiveNumber(raw.step, defaults.step),
    initial: positiveNumber(raw.initial, defaults.initial),
    enabled: raw.enabled !== false && unitPrice > 0,
    sizeKey: defaults.sizeKey
  };
}

function moneyBR(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function positiveNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

function canonicalProduct(value) {"""
if helpers not in text:
    if marker not in text:
        raise SystemExit('ACCEPTED_COMMERCIAL_HELPER_TARGET_NOT_FOUND')
    text = text.replace(marker, helpers, 1)

adapter.write_text(text, encoding='utf-8')
print('Commercial enrichment applied to authenticated catalog.')
