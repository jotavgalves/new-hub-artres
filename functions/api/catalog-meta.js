import { json, loadConfig } from "./_config.js";

export async function onRequestGet(context) {
  const { config } = await loadConfig(context.env);
  const version = Number(config.ui && config.ui.cacheVersion || config.version || 1);
  return json({
    ok: true,
    catalogVersion: version,
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
