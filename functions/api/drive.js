const ROOT_FOLDER_ID = "11cU5yMWafopC0JfMHotRxThpkgbQl-RW";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const PRODUCT_RULES = [
  // A categoria vem da pasta do Drive. A normalização abaixo serve só para escolher ícone, regra e preço.
  ["kit-romano", [/kit.*romano/i, /romano.*kit/i, /kit\s*\+\s*romano/i, /kit\s*com\s*romano/i, /kit\s*completo/i, /completo/i]],
  ["kit-painel-cilindros", [/kit.*painel.*cilind/i, /kit.*cilind/i, /painel.*cilind/i, /\bkit\b/i]],
  ["painel-150", [/150\s*x\s*150/i, /159\s*x\s*150/i, /150x150/i, /159x150/i, /painel\s*150/i, /painel\s*159/i, /\b150\b/i, /\b159\b/i]],
  ["50x50", [/50\s*x\s*50/i, /50x50/i, /painel\s*50/i, /bolinha/i, /bolinhas/i, /\b50\b/i]],
  ["cilindros", [/trio.*cilind/i, /cilindros/i, /cilindro/i]],
  ["romano", [/romano/i]]
];

export async function onRequestGet(context) {
  try {
    const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
    if (!apiKey) return json({ ok: false, error: "GOOGLE_API_KEY_NAO_CONFIGURADA", folders: [], items: [] }, 500);

    const url = new URL(context.request.url);
    const mode = String(url.searchParams.get("mode") || "themes").toLowerCase();
    const folderId = sanitizeId(url.searchParams.get("folderId")) || ROOT_FOLDER_ID;
    const theme = cleanLabel(url.searchParams.get("theme") || "");
    const productFolderName = cleanLabel(url.searchParams.get("product") || "");
    const productKey = normalizeProduct(productFolderName);
    const productName = productFolderName || productLabel(productKey, productFolderName);

    const children = await listChildren(folderId, apiKey);
    const folders = children
      .filter((file) => file.mimeType === FOLDER_MIME)
      .map((file) => folderPayload(file))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));

    const imageFiles = children.filter((file) => String(file.mimeType || "").startsWith("image/"));
    const items = imageFiles.map((file) => {
      const code = cleanCode(file.name);
      const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1200`;
      return {
        id: file.id,
        code,
        sortId: Number(code) || 0,
        // nome do arquivo não é exibido no front; fica apenas para debug interno se precisar.
        name: file.name,
        theme: theme || "Sem tema",
        product: productKey,
        productName,
        productFolderName: productFolderName || productName,
        image,
        thumbnail: image,
        driveUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
        path: theme ? `${theme} / ${productName}` : productName
      };
    }).sort((a, b) => Number(b.sortId || 0) - Number(a.sortId || 0));

    return json({
      ok: true,
      mode,
      rootFolderId: ROOT_FOLDER_ID,
      folderId,
      folders,
      items,
      totalFolders: folders.length,
      totalItems: items.length
    }, 200, mode === "items" ? 45 : 120);
  } catch (error) {
    return json({ ok: false, error: "FALHA_AO_LER_DRIVE", detail: String(error && error.message || error), folders: [], items: [] }, 500);
  }
}

function folderPayload(file) {
  const clean = cleanLabel(file.name);
  const product = normalizeProduct(clean);
  return {
    id: file.id,
    name: clean,
    rawName: file.name,
    isProduct: isProductFolderName(clean),
    product,
    productName: clean || productLabel(product, clean),
    modifiedTime: file.modifiedTime || ""
  };
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
    if (!response.ok) {
      let detail = "";
      try { detail = JSON.stringify(await response.json()); } catch (_) {}
      throw new Error(`Drive API ${response.status}${detail ? ` - ${detail}` : ""}`);
    }
    const data = await response.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

function normalizeProduct(value) {
  const text = normalizeText(value);
  for (const [key, rules] of PRODUCT_RULES) {
    if (rules.some((rule) => rule.test(text))) return key;
  }
  return "produto";
}

function isProductFolderName(value) {
  const text = normalizeText(value);
  return PRODUCT_RULES.some(([, rules]) => rules.some((rule) => rule.test(text)));
}

function productLabel(key, fallback = "") {
  const labels = {
    "50x50": "50x50",
    "painel-150": "Painel 150x150",
    "cilindros": "Cilindros",
    "romano": "Romano",
    "kit-romano": "Kit + Romano",
    "kit-painel-cilindros": "Kit Painel + Cilindros",
    "lateral": "Painel Lateral",
    "produto": cleanLabel(fallback || "Produto")
  };
  return labels[key] || cleanLabel(fallback || "Produto");
}

function cleanCode(value) {
  const base = String(value || "").replace(/\.[^.]+$/, "");
  const arteMatch = base.match(/(?:arte|art)[^\d]*(\d+)/i);
  if (arteMatch) return arteMatch[1];
  const nums = base.match(/\d+/g);
  return nums ? nums[nums.length - 1] : base.replace(/[^\w-]/g, "").toUpperCase();
}

function cleanLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toLocaleUpperCase("pt-BR"));
}

function normalizeText(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function sanitizeId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : "";
}

function json(payload, status = 200, browserCacheSeconds = 0) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": browserCacheSeconds ? `public, max-age=${browserCacheSeconds}, s-maxage=${browserCacheSeconds}` : "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
