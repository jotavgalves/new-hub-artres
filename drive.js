const ROOT_FOLDER_ID = "11cU5yMWafopC0JfMHotRxThpkgbQl-RW";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const PRODUCT_ALIASES = [
  ["50x50", ["50", "50x50", "painel 50", "bolinha", "bolinhas"]],
  ["painel-150", ["150", "150x150", "painel 150"]],
  ["kit-romano", ["kit com romano", "kit + romano", "kit completo", "completo"]],
  ["kit-painel-cilindros", ["kit painel", "kit painel e cilindros", "kit cilindros", "painel e cilindros"]],
  ["cilindros", ["trio de cilindros", "trio cilindros", "cilindros", "cilindro"]],
  ["romano", ["romano"]]
];

export async function onRequestGet(context) {
  try {
    const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
    if (!apiKey) return json({ ok: false, error: "GOOGLE_API_KEY_NAO_CONFIGURADA", items: [] }, 500);

    const url = new URL(context.request.url);
    const folderId = sanitizeId(url.searchParams.get("folderId")) || ROOT_FOLDER_ID;
    const maxDepth = Math.max(2, Math.min(5, Number(url.searchParams.get("depth") || 4)));
    const items = [];

    await walkFolder({ folderId, apiKey, depth: 0, maxDepth, path: [], items });
    items.sort((a, b) => Number(b.sortId || 0) - Number(a.sortId || 0));

    return json({ ok: true, rootFolderId: folderId, total: items.length, items }, 200, 180);
  } catch (error) {
    return json({ ok: false, error: "FALHA_AO_LER_DRIVE", detail: String(error && error.message || error), items: [] }, 500);
  }
}

async function walkFolder({ folderId, apiKey, depth, maxDepth, path, items }) {
  if (depth > maxDepth) return;
  const files = await listChildren(folderId, apiKey);

  for (const file of files) {
    if (file.mimeType === FOLDER_MIME) {
      await walkFolder({ folderId: file.id, apiKey, depth: depth + 1, maxDepth, path: path.concat(file.name), items });
      continue;
    }

    if (!String(file.mimeType || "").startsWith("image/")) continue;

    const parsed = parsePathAndFile(path, file.name);
    const code = cleanCode(file.name);
    const image = `https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1000`;

    items.push({
      id: file.id,
      code,
      sortId: Number(code) || 0,
      name: displayName(file.name, code),
      theme: parsed.theme,
      product: parsed.product,
      productName: parsed.productName,
      image,
      thumbnail: image,
      driveUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      path: path.join(" / ")
    });
  }
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

function parsePathAndFile(path, fileName) {
  const segments = path.filter(Boolean);
  const full = segments.concat(fileName).join(" ");
  const product = normalizeProduct(full);
  const productName = productLabel(product);

  let theme = segments.find((segment) => !isProductish(segment)) || segments[0] || "Sem tema";
  if (segments.length >= 2 && isProductish(segments[0]) && !isProductish(segments[1])) theme = segments[1];

  return { theme: cleanLabel(theme), product, productName };
}

function normalizeProduct(value) {
  const normalized = normalizeText(value);
  for (const [key, aliases] of PRODUCT_ALIASES) {
    if (aliases.some(alias => normalized.includes(normalizeText(alias)))) return key;
  }
  return "50x50";
}

function isProductish(value) {
  const normalized = normalizeText(value);
  return PRODUCT_ALIASES.some(([, aliases]) => aliases.some(alias => normalized.includes(normalizeText(alias))));
}

function productLabel(key) {
  const labels = {
    "50x50": "50x50",
    "painel-150": "Painel 150x150",
    "cilindros": "Cilindros",
    "romano": "Romano",
    "kit-romano": "Kit + Romano",
    "kit-painel-cilindros": "Kit Painel + Cilindros"
  };
  return labels[key] || "Produto";
}

function cleanCode(value) {
  const base = String(value || "").replace(/\.[^.]+$/, "");
  const arteMatch = base.match(/(?:arte|art)[^\d]*(\d+)/i);
  if (arteMatch) return arteMatch[1];
  const nums = base.match(/\d+/g);
  return nums ? nums[nums.length - 1] : base.replace(/[^\w-]/g, "").toUpperCase();
}

function displayName(fileName, code) {
  const base = String(fileName || "").replace(/\.[^.]+$/, "").trim();
  if (!base) return `Arte ${code}`;
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanLabel(value) {
  return String(value || "Sem tema")
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
