import { json, loadConfig } from "./_config.js";
import { getBlockedArtCodes, getHiddenThemeKeys, getHiddenThemeNames, getCatalogControls } from "./_catalog_rules.js";

function unique(list) {
  return [...new Set((list || []).map(x => String(x || "").trim()).filter(Boolean))];
}

export async function onRequestGet(context) {
  const { config } = await loadConfig(context.env);
  const version = Number((config.ui && config.ui.cacheVersion) || config.version || 1);
  const controls = getCatalogControls(config);
  const hiddenArtCodes = getBlockedArtCodes(config);
  const hiddenThemes = getHiddenThemeNames(config);
  const hiddenThemeKeys = getHiddenThemeKeys(config);
  const hiddenProducts = unique((config.productCatalog || [])
    .filter(p => p && p.active === false)
    .flatMap(p => [p.id, p.productKey, p.label])
  );
  const rulesHash = [version, hiddenArtCodes.join(","), hiddenThemeKeys.join(","), hiddenProducts.join(",")].join("|");
  return json({
    ok: true,
    catalogVersion: version,
    updatedAt: new Date().toISOString(),
    hiddenArtCodes,
    hiddenThemes,
    hiddenThemeKeys,
    hiddenProducts,
    artBlocks: controls.artBlocks,
    themeBlocks: controls.themeBlocks,
    rulesHash
  }, 200, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
  });
}
