const ROOT_FOLDER_ID = "11cU5yMWafopC0JfMHotRxThpkgbQl-RW";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export async function onRequestGet(context) {
  try {
    const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
    if (!apiKey) return json({ ok:false, error:"GOOGLE_API_KEY_NAO_CONFIGURADA" }, 500);

    const url = new URL(context.request.url);
    const mode = String(url.searchParams.get("mode") || "themes");
    const folderId = sanitizeId(url.searchParams.get("folderId")) || ROOT_FOLDER_ID;
    const theme = cleanLabel(url.searchParams.get("theme") || "");
    const productRaw = cleanLabel(url.searchParams.get("product") || "");
    const searchCode = String(url.searchParams.get("code") || "").replace(/\D/g, "").slice(0, 20);

    if (mode === "themes") {
      const folders = (await listChildren(folderId, apiKey))
        .filter(f => f.mimeType === FOLDER_MIME)
        .map(f => ({ id:f.id, name:cleanLabel(f.name), rawName:f.name, kind:"theme" }));
      folders.sort((a,b)=>a.name.localeCompare(b.name,"pt-BR", { numeric:true }));
      return json({ ok:true, mode, folders }, 200, 180);
    }

    if (mode === "products") {
      const children = (await listChildren(folderId, apiKey)).filter(f => f.mimeType === FOLDER_MIME);
      const folders = children.map(f => {
        const info = normalizeProductInfo(f.name);
        if (info.key === "folder") {
          return {
            id:f.id,
            name:cleanLabel(f.name),
            rawName:f.name,
            kind:"folder",
            product:"",
            productName:"",
            label:cleanLabel(f.name)
          };
        }
        return {
          id:f.id,
          name:cleanLabel(f.name),
          rawName:f.name,
          kind:"product",
          product:info.key,
          productName:info.label,
          label:info.label
        };
      });
      folders.sort((a,b)=>{
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
        return productOrder(a.product)-productOrder(b.product) || a.name.localeCompare(b.name,"pt-BR", { numeric:true });
      });
      return json({ ok:true, mode, theme, folders }, 200, 180);
    }

    if (mode === "items") {
      const files = (await listChildren(folderId, apiKey)).filter(f => String(f.mimeType||"").startsWith("image/"));
      const productInfo = normalizeProductInfo(productRaw);
      const product = productInfo.key === "folder" ? "produto" : productInfo.key;
      const productName = productInfo.key === "folder" ? cleanLabel(productRaw || "Produto") : productInfo.label;
      const items = files.map(f => {
        const code = cleanCode(f.name);
        const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.id)}&sz=w1200`;
        return {
          id:f.id,
          code,
          sortId:Number(code)||0,
          theme: theme || "Sem tema",
          product,
          productName,
          themeId:"",
          productFolderId:folderId,
          image,
          thumbnail:image,
          driveUrl:f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`
        };
      }).filter(i=>i.code).sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
      return json({ ok:true, mode, theme, product, productName, total:items.length, items }, 200, 120);
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
      const selfInfo = normalizeProductInfo(f.name);
      const kind = selfInfo.key === "folder" ? "folder" : "product";
      const parentTrail = belowRoot.slice(1, Math.max(1, belowRoot.length - 1)).map(x => ({ id:x.id, name:cleanLabel(x.name), kind:"folder" }));
      const label = kind === "product" ? selfInfo.label : cleanLabel(f.name);
      out.push({
        id:f.id,
        name:cleanLabel(f.name),
        rawName:f.name,
        label,
        kind,
        product: kind === "product" ? selfInfo.key : "",
        productName: kind === "product" ? selfInfo.label : "",
        theme: cleanLabel(themeFolder.name),
        themeId: themeFolder.id,
        trail: parentTrail,
        path: belowRoot.map(x => cleanLabel(x.name)).join(" / ")
      });
    } catch (_) {}
    if (out.length >= 30) break;
  }

  return out.sort((a,b)=>{
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.path.localeCompare(b.path, "pt-BR", { numeric:true });
  });
}

async function searchByCode(code, apiKey) {
  const safeCode = String(code || "").replace(/[^0-9]/g, "");
  if (!safeCode || safeCode.length < 2) return [];
  const params = new URLSearchParams({
    key: apiKey,
    q: `name contains '${safeCode}' and trashed = false and mimeType contains 'image/'`,
    fields: "files(id,name,mimeType,webViewLink,parents)",
    pageSize: "24",
    orderBy: "name_natural"
  });
  const response = await fetch(`${DRIVE_API}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Drive API ${response.status}`);
  const data = await response.json();
  const files = data.files || [];
  const out = [];

  for (const f of files) {
    const artCode = cleanCode(f.name);
    if (!artCode.includes(safeCode)) continue;

    const ancestry = await buildAncestry((f.parents && f.parents[0]) || "", apiKey);
    const rootIndex = ancestry.findIndex(a => a.id === ROOT_FOLDER_ID);
    if (rootIndex === -1) continue;

    const belowRoot = ancestry.slice(rootIndex + 1);
    if (!belowRoot.length) continue;

    let productFolder = null;
    for (let i = belowRoot.length - 1; i >= 0; i--) {
      const info = normalizeProductInfo(belowRoot[i].name);
      if (info.key !== "folder") {
        productFolder = { ...belowRoot[i], info };
        break;
      }
    }
    if (!productFolder) continue;

    const themeFolder = belowRoot[0];
    const productIndex = belowRoot.findIndex(x => x.id === productFolder.id);
    const pathParts = belowRoot.slice(0, Math.max(productIndex, 1)).map(x => cleanLabel(x.name));
    const themeLabel = pathParts.length ? pathParts.join(" / ") : cleanLabel(themeFolder.name);

    const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.id)}&sz=w1200`;
    out.push({
      id: f.id,
      code: artCode,
      sortId: Number(artCode) || 0,
      theme: themeLabel,
      themeId: themeFolder.id,
      product: productFolder.info.key,
      productName: productFolder.info.label,
      productFolderId: productFolder.id,
      image,
      thumbnail: image,
      driveUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`
    });
    if (out.length >= 24) break;
  }
  return out.sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
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

function normalizeProductInfo(value) {
  const raw = String(value || "").trim();
  const s0 = normalizeText(raw);
  const s = s0
    .replaceAll("ciclindros", "cilindros")
    .replaceAll("cilnidros", "cilindros")
    .replaceAll("cilindos", "cilindros")
    .replaceAll("cilidros", "cilindros")
    .replaceAll("cilidro", "cilindro")
    .replaceAll("rendondo", "redondo")
    .replaceAll("redond ", "redondo ")
    .replaceAll("redonodo", "redondo")
    .replaceAll("rerdondo", "redondo")
    .replaceAll("reatngular", "retangular")
    .replaceAll("sacoclinhas", "sacolinhas")
    .replaceAll("sacolnhas", "sacolinhas")
    .replaceAll("kir", "kit")
    .replace(/\s*\+\s*/g, " + ");

  const hasRomano = s.includes("romano") || s.includes("arco romano");
  const hasCilindros = s.includes("cilindro");
  const hasKit = s.includes("kit");
  const hasLateral = s.includes("lateral");
  const hasRedondo = s.includes("redondo") || s.includes("painel redondo");
  const hasRetangular = s.includes("retangular");
  const is50 = /\b0[\.,]50\b/.test(s) || /\b50\s*x\s*50\b/.test(s) || /\b50x50\b/.test(s) || s.includes("painel 50") || s === "50";
  const is150 = /\b1[\.,]5\b/.test(s) || /\b1[\.,]50\b/.test(s) || /\b150\s*x\s*150\b/.test(s) || /\b150x150\b/.test(s) || /\b150\b/.test(s) || s.includes("painel 150") || /\b159\s*x\s*150\b/.test(s) || /\b159\b/.test(s);

  if (hasKit && hasRomano) return { key:"kit-romano", label:"Kit + Romano" };
  if ((hasKit && hasCilindros) || (hasRedondo && hasCilindros)) return { key:"kit-painel-cilindros", label:"Kit Painel + Cilindros" };
  if (hasCilindros && hasRomano) return { key:"kit-romano", label:"Kit + Romano" };
  if (hasCilindros && hasLateral) return { key:"kit-painel-cilindros", label:"Kit Painel + Cilindros" };
  if (hasRomano && hasLateral) return { key:"romano-lateral", label:"Romano + Lateral" };
  if (is50 && (hasRedondo || s.includes("bolinha") || s.includes("painel"))) return { key:"50x50", label:"Bolinhas 50x50" };
  if (is150 && (hasRedondo || s.includes("painel") || s === "150" || s === "1,50" || s === "1.50")) return { key:"painel-150", label:"Painel 150x150" };
  if (hasCilindros) return { key:"cilindros", label:"Cilindros" };
  if (hasRomano) return { key:"romano", label:"Romano" };
  if (hasLateral) return { key:"lateral", label:"Lateral" };
  if (s.includes("cenario") || s.includes("paisagem") || s.includes("horizontal")) return { key:"cenario", label:"Cenário" };
  if (hasRetangular || s.includes("vertical") || s.includes("retrato")) return { key:"retangular", label:"Retangular" };
  if (s.includes("sacolinha") || s.includes("sacolinhas") || s.includes("sacola") || s.includes("sacolas")) return { key:"sacolinha", label:"Sacolinha de Festa" };
  if (hasRedondo && is150) return { key:"painel-150", label:"Painel 150x150" };
  if (hasRedondo && is50) return { key:"50x50", label:"Bolinhas 50x50" };
  if (hasRedondo) return { key:"redondo-indefinido", label:"Painel Redondo" };
  return { key:"folder", label:cleanLabel(raw || "Pasta") };
}

function productOrder(key){
  return ({
    "50x50":1,
    "painel-150":2,
    "redondo-indefinido":3,
    "cenario":4,
    "retangular":5,
    "lateral":6,
    "sacolinha":7,
    "cilindros":8,
    "kit-painel-cilindros":9,
    "romano":10,
    "romano-lateral":11,
    "kit-romano":12
  })[key] || 99;
}

function cleanCode(value) {
  const base = String(value || "").replace(/\.[^.]+$/, "");
  const arteMatch = base.match(/(?:arte|art)[^\d]*(\d+)/i);
  if (arteMatch) return arteMatch[1];
  const nums = base.match(/\d+/g);
  return nums ? nums[nums.length - 1] : base.replace(/[^\w-]/g, "").toUpperCase();
}
function cleanLabel(value) {
  return String(value || "").replace(/[_-]+/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g, m => m.toLocaleUpperCase("pt-BR"));
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
