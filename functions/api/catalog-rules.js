import { json, loadConfig } from "./_config.js";

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function code(value) {
  return String(value || "").replace(/\D/g, "");
}
function controls(config) {
  return config.catalogControls || { hiddenArtCodes: [], hiddenThemes: [], themeOverrides: [], subthemeOverrides: [], artBlocks: [] };
}
function unique(list) {
  return [...new Set((list || []).map(x => String(x || "").trim()).filter(Boolean))];
}

export async function onRequestGet(context) {
  const { config } = await loadConfig(context.env);
  const c = controls(config);
  const version = Number((config.ui && config.ui.cacheVersion) || config.version || 1);
  const hiddenArtCodes = unique([
    ...(c.hiddenArtCodes || []).map(code),
    ...(c.artBlocks || []).filter(b => b && b.active !== false).map(b => code(b.code))
  ]).filter(Boolean);
  const hiddenThemes = unique([
    ...(c.hiddenThemes || []),
    ...(c.themeOverrides || []).filter(r => r && r.hidden).flatMap(r => [r.match, r.displayName]),
    ...(c.subthemeOverrides || []).filter(r => r && r.hidden).flatMap(r => [r.match, r.displayName])
  ]).filter(Boolean);
  const hiddenThemeKeys = unique(hiddenThemes.map(norm)).filter(Boolean);
  const hiddenProducts = unique((config.productCatalog || [])
    .filter(p => p && p.active === false)
    .flatMap(p => [p.id, p.productKey, p.label])
  );
  return json({
    ok: true,
    catalogVersion: version,
    updatedAt: new Date().toISOString(),
    hiddenArtCodes,
    hiddenThemes,
    hiddenThemeKeys,
    hiddenProducts,
    rulesHash: JSON.stringify({ hiddenArtCodes, hiddenThemeKeys, hiddenProducts }).length + ":" + version
  }, 200, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  });
}
