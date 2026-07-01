const ROOT_FOLDER_ID = "193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// Configuração central do novo Drive de Bolinhas.
// Para alterar preço/nome depois, mexa aqui e no BOLINHAS_CONFIG do functions/_middleware.js.
const BOLINHAS_LABEL = "Bolinhas";
const BOLINHAS_PRODUCT_KEY = "50x50";
const BOLINHAS_UNIT_PRICE = 9.75;
const BOLINHAS_PRICE_LABEL = "R$ 9,75 cada";

const BOLINHAS_PRODUCT = {
  id: "bolinhas",
  name: BOLINHAS_LABEL,
  rawName: BOLINHAS_LABEL,
  kind: "product",
  product: BOLINHAS_PRODUCT_KEY,
  productName: BOLINHAS_LABEL,
  label: BOLINHAS_LABEL,
  unitPrice: BOLINHAS_UNIT_PRICE,
  price: BOLINHAS_UNIT_PRICE,
  priceLabel: BOLINHAS_PRICE_LABEL,
  directItems: true,
  skipProductsStep: true,
  disableCustomization: true,
  customizationDisabled: true,
  allowCustomSize: false,
  canCustomize: false
};

export async function onRequestGet(context) {
  try {
    const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
    if (!apiKey) return json({ ok:false, error:"GOOGLE_API_KEY_NAO_CONFIGURADA" }, 500);

    const url = new URL(context.request.url);
    const mode = String(url.searchParams.get("mode") || "themes");
    const folderId = sanitizeId(url.searchParams.get("folderId")) || ROOT_FOLDER_ID;
    const theme = cleanLabel(url.searchParams.get("theme") || "");
    const searchCode = String(url.searchParams.get("code") || "").replace(/\D/g, "").slice(0, 20);

    if (mode === "themes") {
      const folders = (await listChildren(folderId, apiKey))
        .filter(f => f.mimeType === FOLDER_MIME)
        .map(f => ({ id:f.id, name:cleanLabel(f.name), rawName:f.name, kind:"theme" }));
      folders.sort((a,b)=>a.name.localeCompare(b.name,"pt-BR", { numeric:true }));
      return json({ ok:true, mode, folders }, 200, 180);
    }

    if (mode === "products") {
      const children = await listChildren(folderId, apiKey);
      const folders = children
        .filter(f => f.mimeType === FOLDER_MIME)
        .map(f => ({
          id:f.id,
          name:cleanLabel(f.name),
          rawName:f.name,
          kind:"folder",
          product:"",
          productName:"",
          label:cleanLabel(f.name)
        }))
        .sort((a,b)=>a.name.localeCompare(b.name,"pt-BR", { numeric:true }));

      const hasImagesHere = children.some(f => String(f.mimeType || "").startsWith("image/"));
      if (hasImagesHere) folders.push({ ...BOLINHAS_PRODUCT, id:folderId });

      return json({ ok:true, mode, theme, folders }, 200, 180);
    }

    if (mode === "items") {
      const files = (await listChildren(folderId, apiKey)).filter(f => String(f.mimeType||"").startsWith("image/"));
      const items = files
        .map(f => itemFromFile(f, { folderId, theme }))
        .filter(i => i.code)
        .sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
      return json({ ok:true, mode, theme, product:BOLINHAS_PRODUCT_KEY, productName:BOLINHAS_LABEL, total:items.length, items }, 200, 120);
    }

    if (mode === "search") {
      if (!searchCode || searchCode.length < 2) return json({ ok:true, mode, items:[] }, 200, 30);
      const items = await searchByCode(searchCode, apiKey);
      return json({ ok:true, mode, total:items.length, items }, 200, 45);
    }

    if (mode === "folderSearch") {
      const query = cleanLabel(url.searchParams.get("q") || "");
      if (!query || normalizeText(query).length < 2) return json({ ok:true, mode, results:[] }, 200, 30);
      const results = await searchFolders(query, apiKey);
      return json({ ok:true, mode, total:results.length, results }, 200, 60);
    }

    return json({ ok:false, error:"MODO_INVALIDO" }, 400);
  } catch (error) {
    return json({ ok:false, error:"FALHA_AO_LER_DRIVE", detail:String(error && error.message || error) }, 500);
  }
}

async function listChildren(folderId, apiKey) {
  const out = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      key: apiKey,
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,webViewLink,modifiedTime,parents)",
      pageSize: "1000",
      orderBy: "folder,name_natural"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${DRIVE_API}?${params.toString()}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Drive API ${response.status}`);
    const data = await response.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function searchFolders(query, apiKey) {
  const q = String(query || "").replace(/'/g, "\\'").trim();
  const params = new URLSearchParams({
    key: apiKey,
    q: `name contains '${q}' and trashed = false and mimeType = '${FOLDER_MIME}'`,
    fields: "files(id,name,mimeType,parents)",
    pageSize: "40",
    orderBy: "name_natural"
  });
  const response = await fetch(`${DRIVE_API}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  const data = await response.json();
  const out = [];

  for (const f of (data.files || [])) {
    try {
      const ancestry = await buildAncestry(f.id, apiKey);
      const rootIndex = ancestry.findIndex(a => a.id === ROOT_FOLDER_ID);
      if (rootIndex === -1) continue;
      const belowRoot = ancestry.slice(rootIndex + 1);
      if (!belowRoot.length) continue;
      const themeFolder = belowRoot[0];
      const parentTrail = belowRoot.slice(1, Math.max(1, belowRoot.length - 1)).map(x => ({ id:x.id, name:cleanLabel(x.name), kind:"folder" }));
      out.push({
        id:f.id,
        name:cleanLabel(f.name),
        rawName:f.name,
        label:cleanLabel(f.name),
        kind:"folder",
        product:"",
        productName:"",
        theme: cleanLabel(themeFolder.name),
        themeId: themeFolder.id,
        trail: parentTrail,
        path: belowRoot.map(x => cleanLabel(x.name)).join(" / ")
      });
    } catch (_) {}
    if (out.length >= 30) break;
  }

  return out.sort((a,b)=>a.path.localeCompare(b.path, "pt-BR", { numeric:true }));
}

async function searchByCode(code, apiKey) {
  const safeCode = String(code || "").replace(/[^0-9]/g, "");
  if (!safeCode || safeCode.length < 2) return [];
  const params = new URLSearchParams({
    key: apiKey,
    q: `name contains '${safeCode}' and trashed = false and mimeType contains 'image/'`,
    fields: "files(id,name,mimeType,webViewLink,parents)",
    pageSize: "40",
    orderBy: "name_natural"
  });
  const response = await fetch(`${DRIVE_API}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  const data = await response.json();
  const out = [];

  for (const f of (data.files || [])) {
    const parsed = parseArtFilename(f.name);
    const artCode = parsed.code;
    if (!artCode || !artCode.includes(safeCode)) continue;

    const parentId = (f.parents && f.parents[0]) || "";
    const ancestry = await buildAncestry(parentId, apiKey);
    const rootIndex = ancestry.findIndex(a => a.id === ROOT_FOLDER_ID);
    if (rootIndex === -1) continue;

    const belowRoot = ancestry.slice(rootIndex + 1);
    if (!belowRoot.length) continue;
    const themeLabel = parsed.theme || belowRoot.map(x => cleanLabel(x.name)).join(" / ") || "Sem tema";

    out.push(itemFromFile(f, { folderId: parentId, theme: themeLabel }));
    if (out.length >= 24) break;
  }
  return out.sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
}

function itemFromFile(file, { folderId, theme }) {
  const parsed = parseArtFilename(file.name);
  const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1200`;
  return {
    id:file.id,
    code:parsed.code,
    sortId:Number(parsed.code)||0,
    theme:parsed.theme || theme || "Sem tema",
    product:BOLINHAS_PRODUCT_KEY,
    productName:BOLINHAS_LABEL,
    productLabel:BOLINHAS_LABEL,
    size:parsed.dimension || "50x50",
    dimension:parsed.dimension || "50x50",
    embeddedTheme:parsed.theme,
    embeddedProduct:parsed.productRaw,
    originalName:file.name,
    themeId:"",
    productFolderId:folderId,
    image,
    thumbnail:image,
    driveUrl:file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    unitPrice:BOLINHAS_UNIT_PRICE,
    price:BOLINHAS_UNIT_PRICE,
    priceLabel:BOLINHAS_PRICE_LABEL,
    disableCustomization:true,
    customizationDisabled:true,
    allowCustomSize:false,
    canCustomize:false,
    measureDisabled:true
  };
}

function parseArtFilename(value) {
  const base = String(value || "").replace(/\.[^.]+$/, "").trim();
  const parts = base.split("_").map(part => part.trim()).filter(Boolean);
  const leadingId = base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);
  const code = leadingId ? leadingId[1] : cleanCode(base);
  return {
    code,
    theme: cleanLabel(parts[1] || ""),
    productRaw: cleanLabel(parts[2] || ""),
    dimension: normalizeDimension(parts.slice(3).join(" "))
  };
}

async function buildAncestry(startFolderId, apiKey) {
  const ancestry = [];
  let currentId = startFolderId;
  const seen = new Set();
  for (let depth = 0; depth < 12 && currentId && !seen.has(currentId); depth++) {
    seen.add(currentId);
    const file = await getFile(currentId, apiKey);
    ancestry.unshift(file);
    currentId = file.parents && file.parents[0];
  }
  return ancestry;
}

async function getFile(fileId, apiKey) {
  const params = new URLSearchParams({ key: apiKey, fields: "id,name,mimeType,parents" });
  const response = await fetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Drive file ${response.status}`);
  return response.json();
}

function cleanCode(value) {
  const base = String(value || "").replace(/\.[^.]+$/, "").trim();
  const leadingId = base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);
  if (leadingId) return leadingId[1];
  const arteMatch = base.match(/(?:arte|art)[^\d]*(\d+)/i);
  if (arteMatch) return arteMatch[1];
  const nums = base.match(/\d+/g);
  return nums ? nums[0] : base.replace(/[^\w-]/g, "").toUpperCase();
}

function cleanLabel(value) {
  return String(value || "").replace(/[_-]+/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g, m => m.toLocaleUpperCase("pt-BR"));
}

function normalizeDimension(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const compact = text.replace(/\s+/g, "").replace(/×/g, "x").toLowerCase();
  const sizeMatch = compact.match(/(\d+(?:[\.,]\d+)?)[xX](\d+(?:[\.,]\d+)?)/);
  if (sizeMatch) return `${sizeMatch[1]}x${sizeMatch[2]}`.replace(/,/g, ".");
  return cleanLabel(text);
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function sanitizeId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : "";
}

function json(payload, status=200, cache=0) {
  return new Response(JSON.stringify(payload), {
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":cache?`public, max-age=${cache}, s-maxage=${cache}`:"no-store, max-age=0",
      "X-Content-Type-Options":"nosniff"
    }
  });
}
