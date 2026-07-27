const OBSERVED_COMMIT = 'a51b6bc530473a09e5c561b7a54643535f82f174';

export const REGISTRY_METADATA = Object.freeze({
  schemaVersion: 1,
  mode: 'passive-baseline',
  observedCommit: OBSERVED_COMMIT,
  loadedByProduction: false,
  purpose: 'Documentar o estado observado antes da migração canônica.'
});

const disabledActivation = Object.freeze({
  catalogEnabled: false,
  checkoutEnabled: false,
  productionEnabled: false
});

function product(definition) {
  return deepFreeze({
    activation: disabledActivation,
    aliases: [],
    variants: {},
    measurements: { type: 'none' },
    quantity: { initial: null, minimum: 1, step: 1, scope: 'item' },
    pricing: { status: 'observed-unverified', currency: 'BRL' },
    validationStatus: 'observed-unverified',
    blockedReasons: [],
    ...definition
  });
}

export const PRODUCT_REGISTRY = deepFreeze({
  '50x50': product({
    key: '50x50',
    label: 'Bolinhas 50x50',
    kind: 'round',
    validationStatus: 'blocked-conflict',
    blockedReasons: [
      'UNIT_PRICE_CONFLICT',
      'INITIAL_QUANTITY_CONFLICT',
      'QUANTITY_SCOPE_NOT_CONFIRMED',
      'CATALOG_BACKEND_FORCES_BOLINHAS'
    ],
    quantity: {
      initial: null,
      observedInitialValues: [1, 6],
      minimum: 6,
      step: 2,
      scope: 'unconfirmed'
    },
    pricing: {
      status: 'conflict',
      currency: 'BRL',
      displayedUnitPrice: 9.75,
      backendDefaultUnitPrice: 9.75,
      frontendAdditionalUnitPrice: 9.90,
      packageQuantity: 6,
      packagePrice: 58.90
    },
    measurements: {
      type: 'round',
      defaultDiameterCm: 50,
      customizationObservedInFrontend: true,
      customizationDisabledInBackendConfig: true
    }
  }),

  'painel-150': product({
    key: 'painel-150',
    label: 'Painel 150x150',
    aliases: ['redondo-indefinido'],
    kind: 'round',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 59.90 },
    measurements: { type: 'round', defaultDiameterCm: 150, minimumCustomDiameterCm: 90, customStepCm: 10 }
  }),

  cenario: product({
    key: 'cenario',
    label: 'Cenário',
    kind: 'rectangle',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 59.90 },
    measurements: { type: 'rectangle', fields: ['widthCm', 'heightCm'] }
  }),

  lateral: product({
    key: 'lateral',
    label: 'Lateral',
    aliases: ['retangular'],
    kind: 'rectangle',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 59.90 },
    measurements: { type: 'rectangle', fields: ['widthCm', 'heightCm'] }
  }),

  cilindros: product({
    key: 'cilindros',
    label: 'Cilindros',
    kind: 'cylinders',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 99.00 },
    measurements: {
      type: 'cylinders',
      cylinders: ['P', 'M', 'G'],
      fieldsPerCylinder: ['widthCm', 'heightCm', 'capDiameterCm']
    }
  }),

  'kit-painel-cilindros': product({
    key: 'kit-painel-cilindros',
    label: 'Kit Painel + Cilindros',
    kind: 'kit-panel-cylinders',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 158.90 },
    measurements: {
      type: 'kit-panel-cylinders',
      cylinders: ['P', 'M', 'G'],
      fieldsPerCylinder: ['widthCm', 'heightCm', 'capDiameterCm'],
      panelFields: ['diameterCm']
    }
  }),

  'kit-romano': product({
    key: 'kit-romano',
    label: 'Kit + Romano',
    kind: 'kit-roman',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 210.00 },
    measurements: {
      type: 'kit-roman',
      cylinders: ['P', 'M', 'G'],
      fieldsPerCylinder: ['widthCm', 'heightCm', 'capDiameterCm'],
      romanFields: ['widthCm', 'heightCm']
    }
  }),

  romano: product({
    key: 'romano',
    label: 'Romano',
    kind: 'roman',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 78.00 },
    measurements: { type: 'roman', fields: ['widthCm', 'heightCm'] }
  }),

  'romano-lateral': product({
    key: 'romano-lateral',
    label: 'Romano + Lateral',
    kind: 'roman-rectangle',
    pricing: { status: 'observed-unverified', currency: 'BRL', unitPrice: 137.90 },
    measurements: {
      type: 'roman-rectangle',
      romanFields: ['widthCm', 'heightCm'],
      rectangleFields: ['widthCm', 'heightCm']
    }
  }),

  sacolinha: product({
    key: 'sacolinha',
    label: 'Sacolinha de Festa',
    kind: 'bag',
    validationStatus: 'observed-unverified',
    blockedReasons: ['QUANTITY_SCOPE_NOT_CONFIRMED'],
    quantity: { initial: 10, minimum: 10, step: 5, scope: 'unconfirmed' },
    pricing: { status: 'variant-pricing', currency: 'BRL' },
    measurements: { type: 'closed-variant' },
    variants: {
      P: { key: 'P', label: 'P', dimensionsCm: { width: 15, height: 20 }, unitPrice: 6.00 },
      M: { key: 'M', label: 'M', dimensionsCm: { width: 20, height: 25 }, unitPrice: 8.00 },
      G: { key: 'G', label: 'G', dimensionsCm: { width: 25, height: 30 }, unitPrice: 10.00 }
    }
  })
});

const ALIAS_TO_KEY = deepFreeze(buildAliasIndex(PRODUCT_REGISTRY));

export function resolveProductKey(input) {
  const normalized = normalizeKey(input);
  if (!normalized) return null;
  if (Object.hasOwn(PRODUCT_REGISTRY, normalized)) return normalized;
  return ALIAS_TO_KEY[normalized] || null;
}

export function getProductDefinition(input) {
  const key = resolveProductKey(input);
  return key ? PRODUCT_REGISTRY[key] : null;
}

export function requireProductDefinition(input) {
  const definition = getProductDefinition(input);
  if (!definition) {
    const error = new Error('PRODUTO_NAO_CONFIGURADO');
    error.code = 'PRODUTO_NAO_CONFIGURADO';
    error.productKey = String(input || '');
    throw error;
  }
  return definition;
}

export function canActivateProduct(input) {
  const definition = getProductDefinition(input);
  if (!definition) return false;
  if (definition.validationStatus !== 'validated') return false;
  if (definition.blockedReasons.length) return false;
  return Object.values(definition.activation).every(Boolean);
}

export function buildItemId({ driveFileId, productKey, variantKey = '', sizeKey = '' }) {
  const productDefinition = requireProductDefinition(productKey);
  const file = normalizeIdentityPart(driveFileId);
  const productPart = normalizeIdentityPart(productDefinition.key);
  const variantPart = normalizeIdentityPart(variantKey || 'default');
  const sizePart = normalizeIdentityPart(sizeKey || 'default');

  if (!file) {
    const error = new Error('DRIVE_FILE_ID_OBRIGATORIO');
    error.code = 'DRIVE_FILE_ID_OBRIGATORIO';
    throw error;
  }

  if (productDefinition.kind === 'bag' && variantPart === 'default') {
    const error = new Error('VARIANTE_OBRIGATORIA');
    error.code = 'VARIANTE_OBRIGATORIA';
    throw error;
  }

  return [file, productPart, variantPart, sizePart].join(':');
}

export function validateRegistry(registry = PRODUCT_REGISTRY) {
  const errors = [];
  const aliases = new Map();

  for (const [key, definition] of Object.entries(registry)) {
    if (key !== definition.key) errors.push(`KEY_MISMATCH:${key}`);
    if (!definition.label) errors.push(`LABEL_REQUIRED:${key}`);
    if (!definition.kind) errors.push(`KIND_REQUIRED:${key}`);
    if (!definition.pricing || definition.pricing.currency !== 'BRL') errors.push(`CURRENCY_INVALID:${key}`);

    for (const alias of definition.aliases || []) {
      const normalized = normalizeKey(alias);
      if (!normalized) errors.push(`ALIAS_INVALID:${key}`);
      if (Object.hasOwn(registry, normalized)) errors.push(`ALIAS_COLLIDES_WITH_PRODUCT:${normalized}`);
      if (aliases.has(normalized)) errors.push(`ALIAS_DUPLICATED:${normalized}`);
      aliases.set(normalized, key);
    }

    if (definition.validationStatus === 'validated' && definition.blockedReasons.length) {
      errors.push(`VALIDATED_PRODUCT_HAS_BLOCKERS:${key}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function buildAliasIndex(registry) {
  const index = {};
  for (const definition of Object.values(registry)) {
    for (const alias of definition.aliases || []) {
      index[normalizeKey(alias)] = definition.key;
    }
  }
  return index;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_+/g, '-');
}

function normalizeIdentityPart(value) {
  return String(value || '')
    .trim()
    .replace(/[:\s]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
