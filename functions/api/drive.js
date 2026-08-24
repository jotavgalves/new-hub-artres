import { loadConfig, getBolinhas } from "./_config.js";
import { applyFolderRule, cleanLabel, displayTheme, isBlockedArt, isHiddenTheme, sortFolders, norm as normalizeText } from "./_catalog_rules.js";
import { baseIndexParams, catalogProductKey, cleanLike, dedupeRows, mapArtwork, readIndex, scoreRow } from "./_catalog_index.js";

const DEFAULT_ROOT_FOLDER_ID = "193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae";
const SECONDARY_ROOT_FOLDER_ID = "18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-";
const KNOWN_ROOT_FOLDER_IDS = new Set([DEFAULT_ROOT_FOLDER_ID, SECONDARY_ROOT_FOLDER_ID]);
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const PAGE_SIZE = 500;
const MAX_ROWS = 5000;
const LIVE_DRIVE_PAGE_SIZE = 1000;
const LIVE_SEARCH_CANDIDATE_LIMIT = 20;
const LIVE_ANCESTRY_MAX_DEPTH = 30;

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
   return json({ ok:true, mode, source:"catalog_index+drive_live", theme, folders }, 200, 15);
  }

  if(mode === "items"){
   const product = cleanLabel(url.searchParams.get("product") || "");
   const items = await itemRows(context.env, { folderId, theme, product, config, bolinhas });
   return json({ ok:true, mode, source:"catalog_index+drive_live", theme:displayTheme(theme, config), product:bolinhas.productKey, productName:bolinhas.label, total:items.length, items }, 200, 15);
  }

  if(mode === "globalSearch"){
   const q = cleanLabel(rawSearch);
   if(!q || normalizeText(q).length < 2) return json({ ok:true, mode, source:"catalog_index", folders:[], items:[] }, 200, 15);
   const [folders, items] = await Promise.all([
    searchFolders(context.env, q, config),
    searchItems(context.env, q, config, bolinhas, 80)
   ]);
   return json({ ok:true, mode, source:"catalog_index+drive_live", totalFolders:folders.length, totalItems:items.length, folders, items }, 200, 15);
  }

  if(mode === "search"){
   if(!rawSearch) return json({ ok:true, mode, source:"catalog_index", items:[] }, 200, 15);
   const items = await searchItems(context.env, rawSearch, config, bolinhas, 80);
   return json({ ok:true, mode, source:"catalog_index+drive_live", total:items.length, items }, 200, 15);
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

async function itemRows(env, { folderId, theme, config, bolinhas }){
 const parsed = parseVirtualProductId(folderId);
 const parentId = parsed ? parsed.parentId : folderId;
 const rows = await artworkRowsByParent(env, parentId);
 return rows
  .map(row => itemFromRow(row, config, theme, bolinhas))
  .filter(Boolean)
  .sort((a,b) => (Number(b.sortId)||0) - (Number(a.sortId)||0));
}

async function artworkRowsByParent(env, parentId){
 const [indexedRows, liveRows] = await Promise.all([
  allIndexRows(env, params => {
   params.set("type", "eq.artwork");
   params.set("parent_drive_id", "eq." + parentId);
  }),
  liveArtworkRowsByParent(env, parentId).catch(error => {
   console.warn("CATALOG_LIVE_FOLDER_RECONCILE_FAILED", String(error&&error.message||error));
   return [];
  })
 ]);
 return dedupeRows(indexedRows.concat(liveRows));
}

async function liveArtworkRowsByParent(env, parentId){
 const apiKey = driveApiKey(env);
 if(!apiKey || !parentId) return [];
 const files = [];
 let pageToken = "";
 do{
  const url = new URL(DRIVE_API);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", `'${escapeDriveQuery(parentId)}' in parents and trashed = false`);
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,webViewLink,thumbnailLink,parents,fileExtension,modifiedTime,createdTime,size)");
  url.searchParams.set("pageSize", String(LIVE_DRIVE_PAGE_SIZE));
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if(pageToken) url.searchParams.set("pageToken", pageToken);
  const data = await fetchDriveJson(url);
  files.push(...(Array.isArray(data.files) ? data.files : []));
  pageToken = String(data.nextPageToken || "");
 }while(pageToken);
 return files
  .filter(file => String(file&&file.mimeType||"").startsWith("image/"))
  .map(file => liveArtworkRow(file, parentId, { rootId:"", pathParts:[] }))
  .filter(row => row.code);
}

async function liveArtworkRowsByCode(env, artworkCode, limit){
 const apiKey = driveApiKey(env);
 const wantedCode = String(artworkCode || "").replace(/\D/g, "");
 if(!apiKey || wantedCode.length < 2) return [];

 const url = new URL(DRIVE_API);
 url.searchParams.set("key", apiKey);
 url.searchParams.set("q", `name contains '${escapeDriveQuery(wantedCode)}' and trashed = false`);
 url.searchParams.set("fields", "files(id,name,mimeType,webViewLink,thumbnailLink,parents,fileExtension,modifiedTime,createdTime,size)");
 url.searchParams.set("pageSize", String(LIVE_SEARCH_CANDIDATE_LIMIT));
 url.searchParams.set("supportsAllDrives", "true");
 url.searchParams.set("includeItemsFromAllDrives", "true");
 const data = await fetchDriveJson(url);
 const candidates = (Array.isArray(data.files) ? data.files : [])
  .filter(file => String(file&&file.mimeType||"").startsWith("image/"))
  .filter(file => extractArtworkCode(file.name) === wantedCode)
  .slice(0, Math.min(Number(limit)||LIVE_SEARCH_CANDIDATE_LIMIT, LIVE_SEARCH_CANDIDATE_LIMIT));

 const rows = [];
 for(const file of candidates){
  const parentId = String(Array.isArray(file.parents) && file.parents[0] || "");
  const ancestry = await resolveDriveAncestry(apiKey, parentId);
  if(!ancestry) continue;
  rows.push(liveArtworkRow(file, parentId, ancestry));
 }
 return rows;
}

async function resolveDriveAncestry(apiKey, startFolderId){
 let folderId = String(startFolderId || "");
 const pathParts = [];
 const seen = new Set();
 for(let depth=0; folderId && depth<LIVE_ANCESTRY_MAX_DEPTH; depth++){
  if(KNOWN_ROOT_FOLDER_IDS.has(folderId)) return { rootId:folderId, pathParts };
  if(seen.has(folderId)) return null;
  seen.add(folderId);
  const url = new URL(DRIVE_API + "/" + encodeURIComponent(folderId));
  url.searchParams.set("key", apiKey);
  url.searchParams.set("fields", "id,name,mimeType,parents,trashed");
  url.searchParams.set("supportsAllDrives", "true");
  const folder = await fetchDriveJson(url);
  if(!folder || folder.trashed) return null;
  pathParts.unshift(cleanLabel(folder.name || ""));
  folderId = String(Array.isArray(folder.parents) && folder.parents[0] || "");
 }
 return null;
}

function liveArtworkRow(file, parentId, ancestry){
 const name = cleanLabel(file&&file.name || "Sem nome");
 const pathParts = Array.isArray(ancestry&&ancestry.pathParts) ? ancestry.pathParts.filter(Boolean) : [];
 const code = extractArtworkCode(name);
 const rootId = String(ancestry&&ancestry.rootId || "");
 const theme = pathParts[0] || "";
 const subtheme = pathParts.length > 2 ? pathParts.slice(1, -1).join(" / ") : (pathParts.length === 2 ? pathParts[1] : "");
 const size = rootId === DEFAULT_ROOT_FOLDER_ID ? "50x50" : "";
 const driveId = String(file&&file.id || "");
 return {
  drive_id:driveId,
  parent_drive_id:parentId || null,
  root_drive_id:rootId || null,
  type:"artwork",
  name,
  normalized_name:normalizeText(name),
  mime_type:String(file&&file.mimeType || ""),
  path:pathParts.concat([name]).join(" / "),
  path_parts:pathParts,
  depth:pathParts.length,
  theme:theme || null,
  subtheme:subtheme || null,
  product:rootId === DEFAULT_ROOT_FOLDER_ID ? "Bolinhas" : null,
  size:size || null,
  code:code || null,
  extension:String(file&&file.fileExtension || extensionFromName(name)),
  drive_url:String(file&&file.webViewLink || (driveId ? `https://drive.google.com/file/d/${driveId}/view` : "")),
  thumbnail_url:driveId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveId)}&sz=w1200` : String(file&&file.thumbnailLink || ""),
  search_text:normalizeText([code,name,theme,subtheme,size,driveId].filter(Boolean).join(" ")),
  indexed_at:null,
  deleted_at:null
 };
}

function extractArtworkCode(name){
 const clean = cleanLabel(name || "").replace(/\.[a-z0-9]{2,5}$/i, "");
 const match = clean.match(/(?:^|[^0-9])#?([0-9]{2,7})(?:[^0-9]|$)/);
 return match ? match[1] : "";
}

function extensionFromName(name){
 const match = String(name || "").match(/\.([a-z0-9]{2,5})$/i);
 return match ? match[1].toLowerCase() : "";
}

function driveApiKey(env){
 return String(env&&(env.GOOGLE_API_KEY||env.GOOGLE_DRIVE_API_KEY||env.DRIVE_API_KEY)||"").trim();
}

function escapeDriveQuery(value){
 return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function fetchDriveJson(url){
 const response = await fetch(url.toString(), { headers:{ Accept:"application/json" } });
 if(!response.ok) throw new Error("GOOGLE_DRIVE_" + response.status);
 return response.json();
}

async function searchItems(env, query, config, bolinhas, limit){
 const q = cleanLabel(query);
 const normalized = cleanLike(q);
 const digits = q.replace(/\D/g, "");
 const out = [];

 if(digits.length >= 2){
  out.push(...await limitedRows(env, params => {
   params.set("type", "eq.artwork");
   params.set("code", "eq." + digits);
  }, limit));
  if(!out.some(row => String(row&&row.code||"") === digits)){
   const liveRows = await liveArtworkRowsByCode(env, digits, limit).catch(error => {
    console.warn("CATALOG_LIVE_CODE_SEARCH_FAILED", String(error&&error.message||error));
    return [];
   });
   out.push(...liveRows);
  }
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
  .map(row => itemFromRow(row, config, "", bolinhas))
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
 if(!rows.length) return [];
 const label = bolinhas.label || "Bolinhas 50x50";
 const key = bolinhas.productKey || "50x50";
 return [{
  id: virtualProductId(parentId, key, label),
  name: label,
  rawName: label,
  label,
  kind: "product",
  product: key,
  productName: label,
  theme,
  productFolderId: parentId,
  directItems: true,
  unitPrice: bolinhas.unitPrice,
  price: bolinhas.unitPrice,
  priceLabel: bolinhas.priceLabel,
  minQty: bolinhas.minQty,
  step: bolinhas.step,
  disableCustomization: bolinhas.disableCustomization,
  customizationDisabled: bolinhas.disableCustomization,
  allowCustomSize: !bolinhas.disableCustomization,
  canCustomize: !bolinhas.disableCustomization
 }];
}

function itemFromRow(row, config, fallbackTheme, bolinhas){
 const item = mapArtwork(row);
 item.code = String(item.code || "").replace(/^#/, "");
 if(!item.code || isBlockedArt(item.code, config)) return null;
 item.theme = displayTheme(item.theme || fallbackTheme || "Sem tema", config);
 if(isHiddenTheme(item.theme, config)) return null;
 item.themeId = row.parent_drive_id || "";
 item.sortId = Number(item.code) || 0;
 item.product = bolinhas.productKey || catalogProductKey(row) || "50x50";
 item.productName = bolinhas.label || "Bolinhas 50x50";
 item.productLabel = item.productName;
 item.productFolderId = row.parent_drive_id || "";
 item.details = { ...(item.details || {}), size: item.size || item.dimension || "50x50" };
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
  label:name,
  kind,
  type:row.type || "folder",
  path:displayPath(row.path || raw, config),
  theme:displayTheme(row.theme || raw, config),
  themeId:row.depth === 1 ? row.drive_id : row.parent_drive_id,
  product:"",
  productName:""
 };
}

function folderResultFromRow(row, config){
 const folder = folderFromRow(row, config, "folder");
 const parts = Array.isArray(row.path_parts) ? row.path_parts : [];
 folder.theme = displayTheme(row.theme || parts[0] || folder.name, config);
 folder.themeId = row.depth === 1 ? row.drive_id : row.parent_drive_id;
 folder.trail = parts.slice(1).map((name, index) => ({
  id:index === parts.length - 2 ? row.drive_id : "catalog-path-" + index + "-" + encodeURIComponent(name),
  name:displayTheme(name, config),
  kind:"folder"
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
  parentId:decodeURIComponent(parts[1] || ""),
  productKey:decodeURIComponent(parts[2] || ""),
  label:decodeURIComponent(parts[3] || "")
 };
}

function json(payload, status = 200, ttl = 0){
 return new Response(JSON.stringify(payload), {
  status,
  headers:{
   "Content-Type":"application/json; charset=utf-8",
   "Cache-Control":ttl ? `public, max-age=${ttl}` : "no-store, max-age=0",
   "X-Content-Type-Options":"nosniff"
  }
 });
}