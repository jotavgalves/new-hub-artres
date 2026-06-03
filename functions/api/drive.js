const ROOT_FOLDER_ID = "11cU5yMWafopC0JfMHotRxThpkgbQl-RW";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const PRODUCT_ALIASES = [
  ["kit-romano", ["kit com romano", "kit + romano", "kit completo", "completo", "kit romano"]],
  ["kit-painel-cilindros", ["kit painel e cilindros", "kit painel + cilindros", "kit painel", "kit cilindros", "painel e cilindros", "kit"]],
  ["cilindros", ["trio de cilindros", "trio cilindros", "cilindros", "cilindro"]],
  ["romano", ["romano"]],
  ["sacolinha", ["sacolinha", "sacolinhas", "sacola", "sacolas", "sacolinha de festa"]],
  ["cenario", ["cenario", "cenário", "cenarios", "cenários", "paisagem", "horizontal", "retangular paisagem", "painel cenario", "painel cenário"]],
  ["lateral", ["lateral", "laterais", "vertical", "retrato", "retangular retrato", "painel lateral"]],
  ["painel-150", ["150x150", "159x150", "159", "painel 150", "150"]],
  ["50x50", ["50x50", "painel 50", "bolinha", "bolinhas", "50"]]
];

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
      const folders = (await listChildren(folderId, apiKey)).filter(f => f.mimeType === FOLDER_MIME).map(f => ({ id:f.id, name:cleanLabel(f.name), rawName:f.name }));
      folders.sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
      return json({ ok:true, mode, folders }, 200, 180);
    }

    if (mode === "products") {
      const folders = (await listChildren(folderId, apiKey)).filter(f => f.mimeType === FOLDER_MIME).map(f => {
        const rawLabel = cleanLabel(f.name);
        const product = normalizeProduct(f.name);
        // A categoria exibida deve respeitar exatamente o nome da subpasta do Drive.
        // O `product` normalizado fica apenas para preço/regras internas.
        return { id:f.id, name: rawLabel, rawName:f.name, product, productName: rawLabel };
      });
      folders.sort((a,b)=>productOrder(a.product)-productOrder(b.product) || a.name.localeCompare(b.name,"pt-BR"));
      return json({ ok:true, mode, theme, folders }, 200, 180);
    }

    if (mode === "items") {
      const files = (await listChildren(folderId, apiKey)).filter(f => String(f.mimeType||"").startsWith("image/"));
      const product = normalizeProduct(productRaw);
      // Mostra o nome da subpasta original do Drive; usa o normalizado só para regra/preço.
      const productName = cleanLabel(productRaw) || productLabel(product);
      const items = files.map(f => {
        const code = cleanCode(f.name);
        const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.id)}&sz=w1200`;
        return { id:f.id, code, sortId:Number(code)||0, theme: theme || "Sem tema", product, productName, themeId:"", productFolderId:folderId, image, thumbnail:image, driveUrl:f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` };
      }).filter(i=>i.code).sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
      return json({ ok:true, mode, theme, product, productName, total:items.length, items }, 200, 120);
    }


    if (mode === "taxonomy") {
      const taxonomy = await buildTaxonomy(apiKey, folderId);
      return json({ ok:true, mode, rootFolderId: folderId, ...taxonomy }, 200, 60);
    }

    if (mode === "search") {
      if (!searchCode || searchCode.length < 2) return json({ ok:true, mode, items:[] }, 200, 30);
      const items = await searchByCode(searchCode, apiKey);
      return json({ ok:true, mode, total:items.length, items }, 200, 45);
    }

    return json({ ok:false, error:"MODO_INVALIDO" }, 400);
  } catch (error) {
    return json({ ok:false, error:"FALHA_AO_LER_DRIVE", detail:String(error && error.message || error) }, 500);
  }
}


async function buildTaxonomy(apiKey, rootFolderId) {
  const themeFolders = (await listChildren(rootFolderId, apiKey))
    .filter(f => f.mimeType === FOLDER_MIME)
    .sort((a,b)=>cleanLabel(a.name).localeCompare(cleanLabel(b.name),"pt-BR"));

  const themes = [];
  const allProducts = [];
  const seenProducts = new Map();

  for (const theme of themeFolders) {
    const productFolders = (await listChildren(theme.id, apiKey))
      .filter(f => f.mimeType === FOLDER_MIME)
      .map(f => {
        const original = cleanLabel(f.name);
        const key = normalizeProduct(f.name);
        const normalized = productLabel(key);
        const row = { id: f.id, original, normalized, key };
        const mapKey = `${normalizeText(original)}|${key}`;
        if (!seenProducts.has(mapKey)) {
          seenProducts.set(mapKey, { original, normalized, key, examples: [] });
        }
        const existing = seenProducts.get(mapKey);
        if (existing.examples.length < 6) existing.examples.push(cleanLabel(theme.name));
        return row;
      })
      .sort((a,b)=>productOrder(a.key)-productOrder(b.key) || a.original.localeCompare(b.original,"pt-BR"));

    themes.push({
      id: theme.id,
      theme: cleanLabel(theme.name),
      rawTheme: theme.name,
      products: productFolders
    });
  }

  for (const value of seenProducts.values()) allProducts.push(value);
  allProducts.sort((a,b)=>productOrder(a.key)-productOrder(b.key) || a.original.localeCompare(b.original,"pt-BR"));
  return { themesCount: themes.length, productsCount: allProducts.length, products: allProducts, themes };
}

async function listChildren(folderId, apiKey) {
  const out = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      key: apiKey,
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,webViewLink,modifiedTime)",
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
    const productFolderId = (f.parents && f.parents[0]) || "";
    let productFolder = null;
    let themeFolder = null;
    try {
      productFolder = productFolderId ? await getFile(productFolderId, apiKey) : null;
      const themeFolderId = productFolder && productFolder.parents && productFolder.parents[0];
      themeFolder = themeFolderId ? await getFile(themeFolderId, apiKey) : null;
      const rootId = themeFolder && themeFolder.parents && themeFolder.parents[0];
      if (rootId && rootId !== ROOT_FOLDER_ID) continue;
    } catch (_) {}
    const rawProductName = productFolder ? cleanLabel(productFolder.name) : "Produto";
    const product = normalizeProduct(productFolder ? productFolder.name : "produto");
    const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.id)}&sz=w1200`;
    out.push({
      id: f.id,
      code: artCode,
      sortId: Number(artCode) || 0,
      theme: themeFolder ? cleanLabel(themeFolder.name) : "Tema",
      themeId: themeFolder ? themeFolder.id : "",
      product,
      productName: rawProductName,
      productFolderId,
      image,
      thumbnail: image,
      driveUrl: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`
    });
    if (out.length >= 24) break;
  }
  return out.sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
}

async function getFile(fileId, apiKey) {
  const params = new URLSearchParams({ key: apiKey, fields: "id,name,mimeType,parents" });
  const response = await fetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?${params.toString()}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Drive file ${response.status}`);
  return response.json();
}

function normalizeProduct(value) {
  const s = normalizeDimensionText(normalizeText(value));
  for (const [key, aliases] of PRODUCT_ALIASES) {
    if (aliases.some(alias => s.includes(normalizeDimensionText(normalizeText(alias))))) return key;
  }
  return "produto";
}
function normalizeDimensionText(value) {
  return String(value || "")
    .replace(/1[,.]50/g, "150")
    .replace(/1[,.]5/g, "150")
    .replace(/150\s*[x×]\s*150/g, "150")
    .replace(/159\s*[x×]\s*150/g, "159");
}
function productLabel(key) {
  return ({"50x50":"Bolinhas 50x50","painel-150":"Painel 150x150","cenario":"Cenário","lateral":"Lateral","sacolinha":"Sacolinha de Festa","cilindros":"Cilindros","romano":"Romano","kit-romano":"Kit + Romano","kit-painel-cilindros":"Kit Painel + Cilindros"})[key] || cleanLabel(key || "Produto");
}
function productOrder(key){return ({"50x50":1,"painel-150":2,"cenario":3,"lateral":4,"sacolinha":5,"cilindros":6,"kit-painel-cilindros":7,"romano":8,"kit-romano":9})[key] || 99;}
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
function normalizeText(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim(); }
function sanitizeId(value) { const id = String(value || "").trim(); return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : ""; }
function json(payload, status=200, cache=0) {
  return new Response(JSON.stringify(payload), { status, headers:{ "Content-Type":"application/json; charset=utf-8", "Cache-Control":cache?`public, max-age=${cache}, s-maxage=${cache}`:"no-store, max-age=0", "X-Content-Type-Options":"nosniff" } });
}
