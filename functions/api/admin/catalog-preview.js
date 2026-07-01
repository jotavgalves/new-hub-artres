import { loadConfig, getActiveDrive } from "../_config.js";
import { requireAdmin } from "./_auth.js";

const DEFAULT_ROOT_FOLDER_ID = "193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function onRequestGet(context) {
  return handle(context, null);
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  return handle(context, body.catalogStructure || body.structure || null);
}

async function handle(context, proposedStructure) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
  if (!apiKey) return json({ ok: false, error: "GOOGLE_API_KEY_NAO_CONFIGURADA" }, 500);

  const { config } = await loadConfig(context.env);
  const drive = getActiveDrive(config, "bolinhas");
  const rootFolderId = sanitizeId(drive && drive.folderId) || DEFAULT_ROOT_FOLDER_ID;
  const rootFolders = await listChildren(rootFolderId, apiKey);
  const themes = rootFolders.filter(f => f.mimeType === FOLDER_MIME).map(f => ({ id: f.id, name: cleanLabel(f.name), rawName: f.name }));
  const byName = new Map(themes.map(t => [norm(t.rawName || t.name), t]));

  const structure = normalizeStructure(proposedStructure || config.catalogStructure || {});
  const warnings = [];
  const info = [];
  const hidden = new Set();
  const usedInCollections = new Map();

  for (const collection of structure.collections) {
    if (!collection.name) warnings.push(`Coleção sem nome.`);
    if (!children(collection).length) warnings.push(`A coleção “${collection.name || "sem nome"}” está vazia.`);
    for (const child of children(collection)) {
      const key = norm(child);
      if (!byName.has(key)) warnings.push(`O tema “${child}” da coleção “${collection.name}” não foi encontrado no Drive.`);
      if (usedInCollections.has(key)) warnings.push(`O tema “${child}” aparece em mais de uma coleção: “${usedInCollections.get(key)}” e “${collection.name}”.`);
      usedInCollections.set(key, collection.name);
      if (collection.hideChildrenFromRoot !== false) hidden.add(key);
    }
  }

  for (const rule of structure.transplants) {
    const fromKey = norm(rule.from);
    const toKey = norm(rule.to);
    if (fromKey && toKey && fromKey === toKey) warnings.push(`A união “${rule.from} → ${rule.to}” usa o mesmo tema como doador e receptor.`);
    if (fromKey && !byName.has(fromKey)) warnings.push(`O tema doador “${rule.from}” não foi encontrado no Drive.`);
    if (toKey && !byName.has(toKey)) warnings.push(`O tema receptor “${rule.to}” não foi encontrado no Drive.`);
    if (rule.hideSource !== false && fromKey) hidden.add(fromKey);
    if (fromKey && toKey && byName.has(fromKey) && byName.has(toKey)) info.push(`“${rule.from}” será unido em “${rule.to}” (${labelMode(rule.mode)}).`);
  }

  const tree = [];
  for (const collection of structure.collections) {
    if (collection.active === false) continue;
    tree.push({
      type: "collection",
      label: collection.name,
      status: "Coleção virtual",
      children: children(collection).map(name => ({ label: name, exists: byName.has(norm(name)), type: "theme" }))
    });
  }

  for (const theme of themes) {
    const key = norm(theme.rawName || theme.name);
    if (hidden.has(key)) continue;
    const incoming = structure.transplants.filter(t => t.active !== false && norm(t.to) === key).map(t => ({ from: t.from, mode: t.mode || "mergeAll", exists: byName.has(norm(t.from)) }));
    tree.push({ type: "theme", label: theme.name, status: incoming.length ? "Recebe conteúdo" : "Tema normal", incoming });
  }

  return json({ ok: true, totalThemes: themes.length, warnings, info, tree, structure, updatedAt: new Date().toISOString() });
}

function normalizeStructure(input) {
  const s = input || {};
  return {
    collections: (Array.isArray(s.collections) ? s.collections : []).filter(Boolean).map(c => ({
      id: String(c.id || c.name || "").trim(),
      name: String(c.name || "").trim(),
      children: children(c),
      hideChildrenFromRoot: c.hideChildrenFromRoot !== false,
      order: Number(c.order || 0),
      active: c.active !== false
    })),
    transplants: (Array.isArray(s.transplants) ? s.transplants : []).filter(Boolean).map(t => ({
      from: String(t.from || "").trim(),
      to: String(t.to || "").trim(),
      mode: ["mergeItems", "mergeFolders", "mergeAll"].includes(t.mode) ? t.mode : "mergeAll",
      hideSource: t.hideSource !== false,
      active: t.active !== false
    }))
  };
}

function children(c) {
  return Array.isArray(c.children) ? c.children.map(x => String(x).trim()).filter(Boolean) : String(c.children || "").split(/\n|,/).map(x => x.trim()).filter(Boolean);
}

async function listChildren(folderId, apiKey) {
  const out = [];
  let pageToken = "";
  do {
    const p = new URLSearchParams({ key: apiKey, q: `'${folderId}' in parents and trashed = false`, fields: "nextPageToken, files(id,name,mimeType,parents)", pageSize: "1000", orderBy: "folder,name_natural" });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await fetch(`${DRIVE_API}?${p.toString()}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Drive API ${r.status}`);
    const d = await r.json();
    out.push(...(d.files || []));
    pageToken = d.nextPageToken || "";
  } while (pageToken);
  return out;
}

function labelMode(mode) {
  if (mode === "mergeItems") return "só artes diretas";
  if (mode === "mergeFolders") return "só subpastas";
  return "juntar tudo";
}
function norm(v) { return String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); }
function cleanLabel(value){return String(value||"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g,m=>m.toLocaleUpperCase("pt-BR"));}
function sanitizeId(value){const id=String(value||"").trim();return/^[A-Za-z0-9_-]{10,}$/.test(id)?id:""}
function json(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" } }); }
