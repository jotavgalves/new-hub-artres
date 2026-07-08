import { loadConfig, getBolinhas } from "./_config.js";
import { applyFolderRule, cleanLabel, displayTheme, isBlockedArt, isHiddenTheme, sortFolders, norm as normalizeText } from "./_catalog_rules.js";
import { baseIndexParams, cleanLike, dedupeRows, mapArtwork, productKey, readIndex, scoreRow } from "./_catalog_index.js";

const DEFAULT_ROOT_FOLDER_ID = "193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae";
const PAGE_SIZE = 500;
const MAX_ROWS = 5000;

export async function onRequestGet(context){
 try{
  const { config } = await loadConfig(context.env);
  const bolinhas = getBolinhas(config);
  const url = new URL(context.request.url);
  const mode = String(url.searchParams.get("mode") || "themes");
  const folderId = String(url.searchParams.get("folderId") || DEFAULT_ROOT_FOLDER_ID).trim();
  const theme = cleanLabel(url.searchParams.get("theme") || "");
  const rawSearch = String(url.searchParams.get("q") || url.searchParams.get("code") || url.searchParams.get("imageId") || "").trim();

  if(mode === "themes"){
   const folders = await themeFolders(context.env, config);
   return json({ ok:true, mode, source:"catalog_index", folders, configVersion:config.ui&&config.ui.cacheVersion||config.version||1 }, 200, 15);
  }

  if(mode === "products"){
   const folders = await productFolders(context.env, { folderId, theme, config, bolinhas });
   return json({ ok:true, mode, source:"catalog_index", theme, folders }, 200, 15);
  }

  if(mode === "items"){
   const product = cleanLabel(url.searchParams.get("product") || "");
   const items = await itemRows(context.env, { folderId, theme, product, config });
   return json({ ok:true, mode, source:"catalog_index", theme:displayTheme(theme, config), product, productName:product, total:items.length, items }, 200, 15);
  }

  if(mode === "globalSearch"){
   const q = cleanLabel(rawSearch);
   if(!q || normalizeText(q).length < 2) return json({ ok:true, mode, source:"catalog_index", folders:[], items:[] }, 200, 15);
   const [folders, items] = await Promise.all([
    searchFolders(context.env, q, config),
    searchItems(context.env, q, config, 80)
   ]);
   return json({ ok:true, mode, source:"catalog_index", totalFolders:folders.length, totalItems:items.length, folders, items }, 200, 15);
  }

  if(mode === "search"){
   if(!rawSearch) return json({ ok:true, mode, source:"catalog_index", items:[] }, 200, 15);
   const items = await searchItems(context.env, rawSearch, config, 80);
   return json({ ok:true, mode, source:"catalog_index", total:items.length, items }, 200, 15);
  }

  if(mode === "folderSearch"){
   const q = cleanLabel(url.searchParams.get("q") || rawSearch || "");
   if(!q || normalizeText(q).length < 2) return json({ ok:true, mode, source:"catalog_index", results:[] }, 200, 15);
   const results = await searchFolders(context.env, q, config);
   return json({ ok:true, mode, source:"catalog_index", total:results.length, results }, 200, 15);
  }

  return json({ ok:false, error:"MODO_INVALIDO" }, 400);
 }catch(error){
  return json({ ok:false, error:"FALHA_AO_LER_CATALOG_INDEX", detail:String(error&&error.message||error) }, 500);
 }
}

async function themeFolders(env, config){
 const rows = await allIndexRows(env, params => {
  params.set("type", "eq.folder");
  params.set("depth", "eq.1");
 });
 const folders = dedupeRows(rows)
  .map(row => folderFromRow(row, config, "theme"))
  .map(folder => applyFolderRule(folder, config, "theme"))
  .filter(folder => !folder.hidden && !isHiddenTheme(folder.name, config));
 sortFolders(folders);
 return folders;
}

async function productFolders(env, { folderId, theme, config, bolinhas }){
 const childRows = await allIndexRows(env, params => {
  params.set("type", "eq.folder");
  params.set("parent_drive_id", "eq." + folderId);
 });
 const folderCards = dedupeRows(childRows)
  .map(row => folderFromRow(row, config, "folder"))
  .map(folder => applyFolderRule(folder, config, "subtheme"))
  .filter(folder => !folder.hidden && !isHiddenTheme(folder.name, config));
 sortFolders(folderCards);

 const artRows = await artworkRowsByParent(env, folderId);
 const productCards = productsFromRows(artRows, { parentId:folderId, theme, bolinhas });
 return folderCards.concat(productCards);
}

async function itemRows(env, { folderId, theme, product, config }){
 const parsed = parseVirtualProductId(folderId);
 const parentId = parsed ? parsed.parentId : folderId;
 const wantedKey = parsed ? parsed.productKey : productKey(product);
 const rows = await artworkRowsByParent(env, parentId);
 const filtered = rows.filter(row => {
  if(parsed) return productKey(row.product) === wantedKey;
  if(product && rows.some(r => productKey(r.product) === wantedKey)) return productKey(row.product) === wantedKey;
  return true;
 });
 return filtered
  .map(row => itemFromRow(row, config, theme))
  .filter(Boolean)
  .sort((a,b) => (Number(b.sortId)||0) - (Number(a.sortId)||0));
}

async function artworkRowsByParent(env, parentId){
 return dedupeRows(await allIndexRows(env, params => {
  params.set("type", "eq.artwork");
  params.set("parent_drive_id", "eq." + parentId);
 }));
}

async function searchItems(env, query, config, limit){
 const q = cleanLabel(query);
 const normalized = cleanLike(q);
 const digits = q.replace(/\D/g, "");
 const out = [];

 if(digits.length >= 2){
  out.push(...await limitedRows(env, params => {
   params.set("type", "eq.artwork");
   params.set("code", "eq." + digits);
  }, limit));
 }

 if(normalized.length >= 2){
  out.push(...await limitedRows(env, params => {
   params.set("type", "eq.artwork");
   params.set("search_text", "ilike.*" + normalized + "*");
  }, limit));

  const tokens = normalized.split(" ").filter(Boolean).slice(0, 5);
  if(tokens.length > 1){
   const tokenRows = await limitedRows(env, params => {
    params.set("type", "eq.artwork");
    params.set("search_text", "ilike.*" + tokens[0] + "*");
   }, limit * 2);
   out.push(...tokenRows.filter(row => tokens.every(token => String(row.search_text||"").includes(token))));
  }
 }

 return dedupeRows(out)
  .map(row => itemFromRow(row, config))
  .filter(Boolean)
  .sort((a,b) => scoreRow(b, q) - scoreRow(a, q) || (Number(b.sortId)||0) - (Number(a.sortId)||0))
  .slice(0, limit);
}

async function searchFolders(env, query, config){
 const q = cleanLabel(query);
 const normalized = cleanLike(q);
 const rows = await limitedRows(env, params => {
  params.set("type", "eq.folder");
  params.set("search_text", "ilike.*" + normalized + "*");
 }, 120);
 return dedupeRows(rows)
  .map(row => folderResultFromRow(row, config))
  .filter(folder => !isHiddenTheme(folder.name, config) && !isHiddenTheme(folder.theme, config))
  .sort((a,b) => String(a.path||a.name).localeCompare(String(b.path||b.name), "pt-BR", { numeric:true }))
  .slice(0, 60);
}

function productsFromRows(rows, { parentId, theme, bolinhas }){
 const seen = new Set();
 const out = [];
 for(const row of rows){
  const label = cleanLabel(row.product || "Artes");
  const key = productKey(label);
  if(seen.has(key)) continue;
  seen.add(key);
  const product = {
   id: virtualProductId(parentId, key, label),
   name: label,
   rawName: label,
   label,
   kind: "product",
   product: key,
   productName: label,
   theme: theme || row.theme || "",
   productFolderId: parentId,
   directItems: true
  };
  if(key === (bolinhas && bolinhas.productKey)) Object.assign(product, {
   unitPrice: bolinhas.unitPrice,
   price: bolinhas.unitPrice,
   priceLabel: bolinhas.priceLabel,
   minQty: bolinhas.minQty,
   step: bolinhas.step,
   disableCustomization: bolinhas.disableCustomization,
   customizationDisabled: bolinhas.disableCustomization,
   allowCustomSize: !bolinhas.disableCustomization,
   canCustomize: !bolinhas.disableCustomization
  });
  out.push(product);
 }
 return out.sort((a,b) => String(a.productName||a.name).localeCompare(String(b.productName||b.name), "pt-BR", { numeric:true }));
}

function itemFromRow(row, config, fallbackTheme){
 const item = mapArtwork(row);
 item.code = String(item.code || "").replace(/^#/, "");
 if(!item.code || isBlockedArt(item.code, config)) return null;
 item.theme = displayTheme(item.theme || fallbackTheme || "Sem tema", config);
 if(isHiddenTheme(item.theme, config)) return null;
 item.themeId = row.parent_drive_id || "";
 item.sortId = Number(item.code) || 0;
 item.productFolderId = row.parent_drive_id || "";
 return item;
}

function folderFromRow(row, config, kind){
 const raw = cleanLabel(row.name || row.theme || "Pasta");
 const name = displayTheme(raw, config);
 return {
  id: row.drive_id || "",
  parentId: row.parent_drive_id || "",
  name,
  rawName: raw,
  label: name,
  kind,
  type: row.type || "folder",
  path: displayPath(row.path || raw, config),
  theme: displayTheme(row.theme || raw, config),
  themeId: row.depth === 1 ? row.drive_id : row.parent_drive_id,
  product: "",
  productName: ""
 };
}

function folderResultFromRow(row, config){
 const folder = folderFromRow(row, config, "folder");
 const parts = Array.isArray(row.path_parts) ? row.path_parts : [];
 folder.theme = displayTheme(row.theme || parts[0] || folder.name, config);
 folder.themeId = row.depth === 1 ? row.drive_id : row.parent_drive_id;
 folder.trail = parts.slice(1).map((name, index) => ({
  id: index === parts.length - 2 ? row.drive_id : "catalog-path-" + index + "-" + encodeURIComponent(name),
  name: displayTheme(name, config),
  kind: "folder"
 }));
 return folder;
}

function displayPath(path, config){
 return String(path || "").split(" / ").map(part => displayTheme(part, config)).join(" / ");
}

async function allIndexRows(env, setup){
 const rows = [];
 for(let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE){
  const batch = await limitedRows(env, params => {
   setup(params);
   params.set("offset", String(offset));
  }, PAGE_SIZE);
  rows.push(...batch);
  if(batch.length < PAGE_SIZE) break;
 }
 return rows;
}

async function limitedRows(env, setup, limit){
 const params = baseIndexParams(Math.min(Math.max(Number(limit)||80, 1), PAGE_SIZE));
 setup(params);
 return readIndex(env, params);
}

function virtualProductId(parentId, key, label){
 return "catalog-index-product:" + encodeURIComponent(parentId) + ":" + encodeURIComponent(key) + ":" + encodeURIComponent(label || key);
}

function parseVirtualProductId(id){
 const text = String(id || "");
 if(!text.startsWith("catalog-index-product:")) return null;
 const parts = text.split(":");
 return {
  parentId: decodeURIComponent(parts[1] || ""),
  productKey: decodeURIComponent(parts[2] || ""),
  label: decodeURIComponent(parts[3] || "")
 };
}

function json(payload, status = 200, ttl = 0){
 return new Response(JSON.stringify(payload), {
  status,
  headers: {
   "Content-Type": "application/json; charset=utf-8",
   "Cache-Control": ttl ? `public, max-age=${ttl}` : "no-store, max-age=0",
   "X-Content-Type-Options": "nosniff"
  }
 });
}
