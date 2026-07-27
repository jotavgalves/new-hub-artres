export const BINDING_GROUPS = deepFreeze({
  assets: {
    requiredFor: ['public', 'admin', 'production-api'],
    aliases: ['ASSETS']
  },
  configKv: {
    requiredFor: ['public', 'admin', 'production-api'],
    aliases: ['CONFIG_KV']
  },
  catalogSupabaseUrl: {
    requiredFor: ['public', 'admin', 'production-api'],
    preferredAliases: ['ARTS_SUPABASE_URL'],
    aliases: ['ARTS_SUPABASE_URL', 'SUPABASE_ARTS_URL', 'ARTWORKS_SUPABASE_URL', 'SUPABASE_REST_URL']
  },
  catalogSupabaseKey: {
    requiredFor: ['public', 'admin', 'production-api'],
    preferredAliases: ['ARTS_SUPABASE_SERVICE_KEY'],
    aliases: [
      'ARTS_SUPABASE_SERVICE_KEY',
      'SUPABASE_ARTS_SERVICE_KEY',
      'ARTWORKS_SUPABASE_SERVICE_KEY',
      'SUPABASE_SERVICE_ROLE_KEY'
    ]
  },
  ordersSupabaseUrl: {
    requiredFor: [],
    recommendedFor: ['admin', 'production-api'],
    preferredAliases: ['SUPABASE_URL'],
    aliases: ['SUPABASE_URL', 'SUPABASE_REST_URL']
  },
  ordersSupabaseKey: {
    requiredFor: [],
    recommendedFor: ['admin', 'production-api'],
    preferredAliases: ['SUPABASE_SERVICE_ROLE_KEY'],
    aliases: ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY']
  },
  adminSecret: {
    requiredFor: ['admin'],
    aliases: ['ADMIN_SECRET_KEY']
  },
  productionToken: {
    requiredFor: ['production-api'],
    preferredAliases: ['ARMAZEM_DESKTOP_TOKEN'],
    aliases: ['ARMAZEM_DESKTOP_TOKEN', 'DESKTOP_APP_TOKEN', 'PRODUCTION_API_TOKEN']
  }
});

export const ENVIRONMENT_PROFILES = deepFreeze({
  public: {
    requiredGroups: ['assets', 'configKv', 'catalogSupabaseUrl', 'catalogSupabaseKey'],
    recommendedGroups: []
  },
  admin: {
    requiredGroups: ['assets', 'configKv', 'catalogSupabaseUrl', 'catalogSupabaseKey', 'adminSecret'],
    recommendedGroups: ['ordersSupabaseUrl', 'ordersSupabaseKey']
  },
  'production-api': {
    requiredGroups: ['assets', 'configKv', 'catalogSupabaseUrl', 'catalogSupabaseKey', 'productionToken'],
    recommendedGroups: ['ordersSupabaseUrl', 'ordersSupabaseKey']
  },
  staging: {
    requiredGroups: [
      'assets',
      'configKv',
      'catalogSupabaseUrl',
      'catalogSupabaseKey',
      'ordersSupabaseUrl',
      'ordersSupabaseKey',
      'adminSecret',
      'productionToken'
    ],
    recommendedGroups: []
  }
});

export function inspectBindingPresence(env = {}, profileName = 'public') {
  const profile = ENVIRONMENT_PROFILES[profileName];
  if (!profile) throw bindingError('ENVIRONMENT_PROFILE_UNKNOWN', profileName);

  const groups = {};

  for (const [groupName, definition] of Object.entries(BINDING_GROUPS)) {
    const matchedAlias = definition.aliases.find(alias => hasBinding(env, alias)) || null;
    const preferred = definition.preferredAliases || definition.aliases.slice(0, 1);

    groups[groupName] = {
      present: Boolean(matchedAlias),
      matchedAlias,
      usesPreferredAlias: Boolean(matchedAlias && preferred.includes(matchedAlias)),
      required: profile.requiredGroups.includes(groupName),
      recommended: profile.recommendedGroups.includes(groupName)
    };
  }

  const errors = [];
  const warnings = [];

  for (const groupName of profile.requiredGroups) {
    if (!groups[groupName]?.present) errors.push(`BINDING_GROUP_MISSING:${groupName}`);
  }

  for (const groupName of profile.recommendedGroups) {
    if (!groups[groupName]?.present) warnings.push(`BINDING_GROUP_RECOMMENDED:${groupName}`);
  }

  for (const [groupName, state] of Object.entries(groups)) {
    const definition = BINDING_GROUPS[groupName];
    if (state.present && definition.preferredAliases?.length && !state.usesPreferredAlias) {
      warnings.push(`NON_PREFERRED_ALIAS:${groupName}:${state.matchedAlias}`);
    }
  }

  const catalogUrlAlias = groups.catalogSupabaseUrl.matchedAlias;
  const catalogKeyAlias = groups.catalogSupabaseKey.matchedAlias;
  const orderUrlAlias = groups.ordersSupabaseUrl.matchedAlias;
  const orderKeyAlias = groups.ordersSupabaseKey.matchedAlias;

  if (catalogUrlAlias === 'SUPABASE_REST_URL' && orderUrlAlias === 'SUPABASE_REST_URL') {
    warnings.push('CATALOG_AND_ORDERS_SHARE_GENERIC_URL_ALIAS');
  }

  if (catalogKeyAlias === 'SUPABASE_SERVICE_ROLE_KEY' && orderKeyAlias === 'SUPABASE_SERVICE_ROLE_KEY') {
    warnings.push('CATALOG_AND_ORDERS_SHARE_GENERIC_SERVICE_KEY_ALIAS');
  }

  return deepFreeze({
    profile: profileName,
    mode: 'presence-only',
    exposesValues: false,
    groups,
    errors: unique(errors),
    warnings: unique(warnings),
    ok: errors.length === 0
  });
}

export function assertBindings(env = {}, profileName = 'public') {
  const report = inspectBindingPresence(env, profileName);
  if (!report.ok) {
    const error = bindingError('BINDINGS_INVALID', profileName);
    error.details = report.errors;
    throw error;
  }
  return report;
}

export function compareEnvironmentIsolation(productionEnv = {}, stagingEnv = {}) {
  const errors = [];
  const warnings = [];
  const comparisons = {};
  const sensitiveAliases = unique(
    Object.values(BINDING_GROUPS).flatMap(definition => definition.aliases)
  );

  for (const alias of sensitiveAliases) {
    const productionValue = bindingValue(productionEnv, alias);
    const stagingValue = bindingValue(stagingEnv, alias);
    const bothPresent = productionValue.present && stagingValue.present;
    const sameReference = bothPresent && productionValue.raw === stagingValue.raw;

    comparisons[alias] = {
      productionPresent: productionValue.present,
      stagingPresent: stagingValue.present,
      sameReference,
      valueExposed: false
    };

    if (sameReference && ['CONFIG_KV', 'ADMIN_SECRET_KEY', 'ARMAZEM_DESKTOP_TOKEN', 'DESKTOP_APP_TOKEN', 'PRODUCTION_API_TOKEN'].includes(alias)) {
      errors.push(`STAGING_REUSES_PRODUCTION_BINDING:${alias}`);
    } else if (sameReference) {
      warnings.push(`STAGING_REUSES_PRODUCTION_VALUE:${alias}`);
    }
  }

  return deepFreeze({
    mode: 'reference-comparison-only',
    exposesValues: false,
    comparisons,
    errors: unique(errors),
    warnings: unique(warnings),
    ok: errors.length === 0
  });
}

function hasBinding(env, alias) {
  return bindingValue(env, alias).present;
}

function bindingValue(env, alias) {
  if (!env || !Object.prototype.hasOwnProperty.call(env, alias)) {
    return { present: false, raw: undefined };
  }

  const raw = env[alias];
  if (raw === null || raw === undefined || raw === '') {
    return { present: false, raw };
  }

  return { present: true, raw };
}

function bindingError(code, detail) {
  const error = new Error(code);
  error.code = code;
  error.detail = detail;
  return error;
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
