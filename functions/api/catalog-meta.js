import { json, loadConfig } from "./_config.js";

export async function onRequestGet(context) {
  const { config } = await loadConfig(context.env);
  const configuredVersion = Number(config.ui && config.ui.cacheVersion || config.version || 1);
  const acceptedVersion = await acceptedCatalogVersion(context.env);
  const version = acceptedVersion || configuredVersion;

  return json({
    ok: true,
    catalogVersion: version,
    acceptedCatalogVersion: acceptedVersion || null,
    updatedAt: new Date().toISOString(),
    maintenance: !!(config.maintenance && config.maintenance.active),
    discountPercent: config.ui && config.ui.discountPercent,
    confirmModal: config.ui && config.ui.confirmModal
  }, 200, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  });
}

async function acceptedCatalogVersion(env) {
  if (String(env && env.USE_AUTHENTICATED_CATALOG_V2 || '').trim().toLowerCase() !== 'true') return 0;

  const rawUrl = String(env && (
    env.SUPABASE_V2_URL ||
    env.AUTHENTICATED_CATALOG_SUPABASE_URL
  ) || 'https://kueklnkznwpbobqwugns.supabase.co').trim();
  const key = String(env && (
    env.SUPABASE_V2_SERVICE_ROLE_KEY ||
    env.SUPABASE_V2_STAGING_SERVICE_ROLE_KEY ||
    env.AUTHENTICATED_CATALOG_SERVICE_ROLE_KEY
  ) || '').trim();

  if (key.length < 32) return 0;

  let origin;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return 0;
    origin = parsed.origin;
  } catch (_) {
    return 0;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${origin}/rest/v1/rpc/armazem_v2_catalog_status_v1`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: '{}'
    });
    if (!response.ok) return 0;
    const status = await response.json().catch(() => ({}));
    const version = Number.parseInt(status && status.catalogVersion, 10);
    return Number.isFinite(version) && version > 0 ? version : 0;
  } catch (_) {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
