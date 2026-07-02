import { loadConfig, getActiveDrive, getBolinhas } from "../_config.js";
import { requireAdmin } from "./_auth.js";
import { activeArtBlocks, activeThemeBlocks, normalizeCatalogControls, norm } from "../_catalog_rules.js";

const DEFAULT_ROOT_FOLDER_ID = "193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok:false, error:auth.error }, auth.status);
  const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
  if (!apiKey) return json({ ok:false, error:"GOOGLE_API_KEY_NAO_CONFIGURADA" }, 500);
  const body = await context.request.json().catch(() => ({}));
  const { config } = await loadConfig(context.env);
  const drive = getActiveDrive(config, "bolinhas");
  const bolinhas = getBolinhas(config);
  const rootFolderId = sanitizeId(drive && drive.folderId) || DEFAULT_ROOT_FOLDER_ID;
  const controls = normalizeCatalogControls(body.catalogControls || config.catalogControls || {});
  const themes = await rootThemes(rootFolderId, apiKey);
  const themeSet = new Set(themes.map(t => norm(t.name)));
  const warnings = [];
  const info = [];
  const blockedArts = [];
  const blockedThemes = [];
  for (const block of activeArtBlocks(controls.artBlocks)) {
    const found = await findArt(block.code, apiKey, rootFolderId, bolinhas).catch(() => []);
    if (!found.length) warnings.push(`Arte #${block.code} não encontrada no Drive.`);
    else info.push(`Arte #${block.code} encontrada.`);
    blockedArts.push({ ...block, found: !!found.length, matches: found.slice(0, 3), theme: block.theme || (found[0] && found[0].theme) || "", product: block.product || (found[0] && found[0].product) || bolinhas.label, image: block.image || (found[0] && found[0].image) || "" });
  }
  for (const block of activeThemeBlocks(controls.themeBlocks)) {
    const found = themeSet.has(norm(block.name));
    if (!found) warnings.push(`Tema “${block.name}” não encontrado no Drive.`);
    else info.push(`Tema “${block.name}” encontrado.`);
    blockedThemes.push({ ...block, found });
  }
  return json({ ok:true, warnings, info, blockedArts, blockedThemes });
}

async function rootThemes(rootFolderId, apiKey) {
  const files = await listChildren(rootFolderId, apiKey);
  return files.filter(f => f.mimeType === FOLDER_MIME).map(f => ({ id:f.id, name:cleanLabel(f.name) }));
}
async function findArt(code, apiKey, rootFolderId, bolinhas) {
  const safe = String(code || "").replace(/[^0-9]/g, "");
  if (!safe) return [];
  const direct = await findArtByDriveSearch(safe, apiKey, bolinhas).catch(() => []);
  if (direct.length) return direct;
  return scanCatalogForCode(safe, apiKey, rootFolderId, bolinhas);
}
async function findArtByDriveSearch(safe, apiKey, bolinhas) {
  const p = new URLSearchParams({ key:apiKey, q:`name contains '${safe}' and trashed = false`, fields:"files(id,name,mimeType,webViewLink)", pageSize:"20", orderBy:"name_natural" });
  const r = await fetch(`${DRIVE_API}?${p.toString()}`, { headers:{ Accept:"application/json" } });
  if (!r.ok) throw new Error(`Drive API ${r.status}`);
  const d = await r.json();
  return (d.files || []).filter(f => String(f.mimeType || "").startsWith("image/")).map(f => resultFromFile(f, [], bolinhas)).filter(f => f.code === safe);
}
async function scanCatalogForCode(safe, apiKey, rootFolderId, bolinhas) {
  const out = [];
  const queue = [{ id: rootFolderId, trail: [] }];
  const seen = new Set();
  let inspected = 0;
  while (queue.length && inspected < 6000 && out.length < 10) {
    const current = queue.shift();
    if (!current || seen.has(current.id)) continue;
    seen.add(current.id);
    inspected++;
    const children = await listChildren(current.id, apiKey).catch(() => []);
    for (const f of children) {
      if (f.mimeType === FOLDER_MIME) {
        queue.push({ id: f.id, trail: current.trail.concat(cleanLabel(f.name)) });
        continue;
      }
      if (!String(f.mimeType || "").startsWith("image/")) continue;
      const parsed = parseName(f.name);
      if (parsed.code !== safe) continue;
      out.push(resultFromFile(f, current.trail, bolinhas));
      if (out.length >= 10) break;
    }
  }
  return out;
}
function resultFromFile(file, trail, bolinhas) {
  const parsed = parseName(file.name);
  const theme = parsed.theme || (trail && trail.length ? trail.join(" / ") : "");
  return { id:file.id, code:parsed.code, theme, product:bolinhas.label, image:`https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w300`, driveUrl:file.webViewLink || `https://drive.google.com/file/d/${file.id}/view` };
}
async function listChildren(folderId, apiKey) { const out=[]; let pageToken=""; do { const p=new URLSearchParams({ key:apiKey, q:`'${folderId}' in parents and trashed = false`, fields:"nextPageToken, files(id,name,mimeType,webViewLink)", pageSize:"1000", orderBy:"folder,name_natural" }); if(pageToken)p.set("pageToken",pageToken); const r=await fetch(`${DRIVE_API}?${p.toString()}`,{headers:{Accept:"application/json"}}); if(!r.ok)throw new Error(`Drive API ${r.status}`); const d=await r.json(); out.push(...(d.files||[])); pageToken=d.nextPageToken||""; } while(pageToken); return out; }
function parseName(value){const base=String(value||"").replace(/\.[^.]+$/,"");const parts=base.split("_").map(x=>x.trim());const m=base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);return{code:m?m[1]:(base.match(/\d+/)||[""])[0],theme:cleanLabel(parts[1]||"")}}
function cleanLabel(value){return String(value||"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g,m=>m.toLocaleUpperCase("pt-BR"));}
function sanitizeId(value){const id=String(value||"").trim();return/^[A-Za-z0-9_-]{10,}$/.test(id)?id:""}
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store, max-age=0","X-Content-Type-Options":"nosniff"}})}
