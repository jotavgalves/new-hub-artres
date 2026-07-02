export function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanCode(value) {
  return String(value || "").replace(/\D/g, "");
}

export function cleanLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, m => m.toLocaleUpperCase("pt-BR"));
}

export function getCatalogControls(config = {}) {
  const raw = config.catalogControls || {};
  const artBlocks = normalizeArtBlocks(raw);
  const themeBlocks = normalizeThemeBlocks(raw);
  return {
    ...raw,
    artBlocks,
    themeBlocks,
    themeOverrides: Array.isArray(raw.themeOverrides) ? raw.themeOverrides : [],
    subthemeOverrides: Array.isArray(raw.subthemeOverrides) ? raw.subthemeOverrides : [],
    catalogHistory: Array.isArray(raw.catalogHistory) ? raw.catalogHistory : [],
    hiddenArtCodes: activeArtBlocks(artBlocks).map(b => b.code),
    hiddenThemes: activeThemeBlocks(themeBlocks).map(b => b.name)
  };
}

export function normalizeCatalogControls(input = {}) {
  const c = getCatalogControls({ catalogControls: input });
  return syncLegacyLists(c);
}

export function syncLegacyLists(controls = {}) {
  const artBlocks = normalizeArtBlocks(controls);
  const themeBlocks = normalizeThemeBlocks(controls);
  return {
    ...controls,
    artBlocks,
    themeBlocks,
    hiddenArtCodes: activeArtBlocks(artBlocks).map(b => b.code),
    hiddenThemes: activeThemeBlocks(themeBlocks).map(b => b.name),
    catalogHistory: Array.isArray(controls.catalogHistory) ? controls.catalogHistory.slice(0, 200) : []
  };
}

export function activeArtBlocks(artBlocks = []) {
  return (Array.isArray(artBlocks) ? artBlocks : []).filter(b => b && b.active !== false && cleanCode(b.code));
}

export function activeThemeBlocks(themeBlocks = []) {
  return (Array.isArray(themeBlocks) ? themeBlocks : []).filter(b => b && b.active !== false && String(b.name || "").trim());
}

export function getBlockedArtCodes(config = {}) {
  return activeArtBlocks(getCatalogControls(config).artBlocks).map(b => b.code);
}

export function getHiddenThemeNames(config = {}) {
  const c = getCatalogControls(config);
  const fromBlocks = activeThemeBlocks(c.themeBlocks).map(b => b.name);
  const fromRules = [...(c.themeOverrides || []), ...(c.subthemeOverrides || [])]
    .filter(r => r && r.hidden)
    .flatMap(r => [r.match, r.displayName])
    .filter(Boolean);
  return unique([...fromBlocks, ...fromRules]);
}

export function getHiddenThemeKeys(config = {}) {
  return getHiddenThemeNames(config).map(norm).filter(Boolean);
}

export function isBlockedArt(code, config = {}) {
  const art = cleanCode(code);
  if (!art) return false;
  return getBlockedArtCodes(config).includes(art);
}

export function findFolderRule(name, config = {}, type = "theme") {
  const c = getCatalogControls(config);
  const list = type === "subtheme" ? (c.subthemeOverrides || []) : (c.themeOverrides || []);
  const n = norm(name);
  return list.find(r => r && r.match && norm(r.match) === n) || list.find(r => r && r.displayName && norm(r.displayName) === n) || null;
}

export function isHiddenTheme(name, config = {}) {
  const n = norm(name);
  if (!n) return false;
  if (getHiddenThemeKeys(config).includes(n)) return true;
  const rule = findFolderRule(name, config, "theme") || findFolderRule(name, config, "subtheme");
  return !!(rule && rule.hidden);
}

export function displayTheme(name, config = {}) {
  const rule = findFolderRule(name, config, "theme") || findFolderRule(name, config, "subtheme");
  return rule && rule.displayName ? rule.displayName : cleanLabel(name);
}

export function applyFolderRule(folder, config = {}, type = "theme") {
  const rule = findFolderRule(folder.rawName || folder.name, config, type);
  const hidden = isHiddenTheme(folder.rawName || folder.name, config);
  const label = rule && rule.displayName ? rule.displayName : (folder.label || folder.name);
  return {
    ...folder,
    name: rule && rule.displayName ? rule.displayName : folder.name,
    label,
    order: rule && Number.isFinite(Number(rule.order)) ? Number(rule.order) : 9999,
    hidden
  };
}

export function sortFolders(folders = []) {
  folders.sort((a, b) => (Number(a.order || 9999) - Number(b.order || 9999)) || String(a.name || "").localeCompare(String(b.name || ""), "pt-BR", { numeric: true }));
  return folders;
}

function normalizeArtBlocks(raw = {}) {
  const map = new Map();
  const add = block => {
    const code = cleanCode(block && block.code);
    if (!code) return;
    const existing = map.get(code) || {};
    map.set(code, {
      code,
      theme: cleanText(block.theme || existing.theme || ""),
      product: cleanText(block.product || existing.product || ""),
      productName: cleanText(block.productName || existing.productName || block.product || existing.product || ""),
      image: String(block.image || existing.image || "").slice(0, 1000),
      found: block.found === false ? false : existing.found,
      active: block.active === false ? false : true,
      blockedAt: block.blockedAt || existing.blockedAt || "",
      blockedBy: block.blockedBy || existing.blockedBy || "Admin",
      reason: cleanText(block.reason || existing.reason || "")
    });
  };
  (Array.isArray(raw.artBlocks) ? raw.artBlocks : []).forEach(add);
  (Array.isArray(raw.hiddenArtCodes) ? raw.hiddenArtCodes : []).forEach(code => add({ code, active: true, blockedBy: "Migração" }));
  return [...map.values()];
}

function normalizeThemeBlocks(raw = {}) {
  const map = new Map();
  const add = block => {
    const name = cleanText(block && (block.name || block.theme));
    const key = norm(name);
    if (!key) return;
    const existing = map.get(key) || {};
    map.set(key, {
      name,
      found: block.found === false ? false : existing.found,
      active: block.active === false ? false : true,
      blockedAt: block.blockedAt || existing.blockedAt || "",
      blockedBy: block.blockedBy || existing.blockedBy || "Admin",
      reason: cleanText(block.reason || existing.reason || "")
    });
  };
  (Array.isArray(raw.themeBlocks) ? raw.themeBlocks : []).forEach(add);
  (Array.isArray(raw.hiddenThemes) ? raw.hiddenThemes : []).forEach(name => add({ name, active: true, blockedBy: "Migração" }));
  return [...map.values()];
}

function unique(list) {
  return [...new Set((list || []).map(x => String(x || "").trim()).filter(Boolean))];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
}
