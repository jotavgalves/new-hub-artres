import { json, loadConfig, getActiveDrive } from "../_config.js";
import { requireAdmin } from "./_auth.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
  if (!apiKey) return json({ ok:false, error:"GOOGLE_API_KEY_NAO_CONFIGURADA" }, 500);

  const { config } = await loadConfig(context.env);
  const body = await context.request.json().catch(() => ({}));
  const drive = body.drive || getActiveDrive(config, "bolinhas");
  const folderId = sanitizeDriveId(drive.folderId || "");
  if (!folderId) return json({ ok:false, error:"DRIVE_INVALIDO" }, 400);

  const rootChildren = await listChildren(folderId, apiKey);
  const themes = rootChildren.filter(f => f.mimeType === FOLDER_MIME);
  const rootImages = rootChildren.filter(f => String(f.mimeType || "").startsWith("image/"));
  let subfolders = 0;
  let sampledImages = rootImages.length;
  let sampleIssues = [];

  for (const theme of themes.slice(0, 20)) {
    const children = await listChildren(theme.id, apiKey);
    subfolders += children.filter(f => f.mimeType === FOLDER_MIME).length;
    const images = children.filter(f => String(f.mimeType || "").startsWith("image/"));
    sampledImages += images.length;
    for (const img of images.slice(0, 8)) collectIssue(img.name, sampleIssues);
    for (const sub of children.filter(f => f.mimeType === FOLDER_MIME).slice(0, 10)) {
      const subChildren = await listChildren(sub.id, apiKey);
      const subImages = subChildren.filter(f => String(f.mimeType || "").startsWith("image/"));
      sampledImages += subImages.length;
      for (const img of subImages.slice(0, 8)) collectIssue(img.name, sampleIssues);
    }
  }

  return json({ ok:true, drive:{ name: drive.name, folderId }, themes: themes.length, subfolders, rootImages: rootImages.length, sampledImages, sampleIssues: sampleIssues.slice(0, 40) });
}

async function listChildren(folderId, apiKey) {
  const params = new URLSearchParams({ key: apiKey, q: `'${folderId}' in parents and trashed = false`, fields: "files(id,name,mimeType)", pageSize: "1000", orderBy: "folder,name_natural" });
  const response = await fetch(`${DRIVE_API}?${params.toString()}`, { headers:{ Accept:"application/json" } });
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  const data = await response.json();
  return data.files || [];
}
function collectIssue(name, issues) {
  const base = String(name || "").replace(/\.[^.]+$/, "");
  if (!/^\d{1,20}[_\-\s]/.test(base)) issues.push({ file:name, issue:"Sem ID inicial" });
  if (!base.includes("_")) issues.push({ file:name, issue:"Sem padrão com _" });
  if (base.split("_").length < 4) issues.push({ file:name, issue:"Padrão incompleto: ID_TEMA_PRODUTO_DIMENSÃO" });
}
function sanitizeDriveId(value) {
  const direct = String(value || "").trim();
  const folderMatch = direct.match(/folders\/([A-Za-z0-9_-]+)/);
  const id = folderMatch ? folderMatch[1] : direct;
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : "";
}
