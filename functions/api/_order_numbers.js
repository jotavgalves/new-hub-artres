const COUNTER_PREFIX = "ORDER_COUNTER:";
const BLOCK_SIZE = 10000;
const RANDOM_SUFFIX_BYTES = 6;
const CODE_RE = /^PED(\d{2})(\d{5})([A-Z])(?:-([A-F0-9]{12}))?$/;

export function yearCode(value) {
  const d = value ? new Date(value) : new Date();
  const y = Number.isFinite(d.getTime()) ? d.getFullYear() : new Date().getFullYear();
  return String(y).slice(-2);
}

export function formatOrderNumber(yy, sequence) {
  const seq = Math.max(1, Number(sequence) || 1);
  const block = Math.floor((seq - 1) / BLOCK_SIZE);
  const number = ((seq - 1) % BLOCK_SIZE) + 1;
  const letter = block < 26 ? String.fromCharCode(65 + block) : "Z";
  return `PED${yy}${String(number).padStart(5, "0")}${letter}`;
}

export function parseOrderNumber(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const m = normalized.match(CODE_RE);
  if (!m) return null;
  return {
    yy: m[1],
    sequence: (m[3].charCodeAt(0) - 65) * BLOCK_SIZE + parseInt(m[2], 10),
    suffix: m[4] || "",
    normalized
  };
}

export function isOrderNumber(value) {
  return Boolean(parseOrderNumber(value));
}

export function hydrateOrderNumbers(orders) {
  const groups = new Map();
  for (const order of orders) {
    if (!isOrderObject(order)) continue;
    const parsed = parseOrderNumber(order.orderNumber || order.orderCode || order.id);
    if (parsed) {
      order.orderNumber = parsed.normalized;
      order.orderCode = order.orderNumber;
      order.displayId = order.orderNumber;
      continue;
    }
    const yy = yearCode(order.createdAt);
    if (!groups.has(yy)) groups.set(yy, []);
    groups.get(yy).push(order);
  }
  for (const [yy, list] of groups.entries()) {
    list.sort((a,b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id || "").localeCompare(String(b.id || "")));
    list.forEach((order, index) => {
      const code = formatOrderNumber(yy, index + 1);
      order.orderNumber = code;
      order.orderCode = code;
      order.displayId = code;
      order.legacyId = order.legacyId || order.id;
    });
  }
}

export async function nextOrderNumber(env, createdAt) {
  const yy = yearCode(createdAt);
  const counterKey = `${COUNTER_PREFIX}${yy}`;
  let next = 1;

  if (env && env.CONFIG_KV) {
    const raw = await env.CONFIG_KV.get(counterKey);
    const parsed = parseInt(raw || "", 10);
    if (Number.isFinite(parsed) && parsed > 0) next = parsed;
    await env.CONFIG_KV.put(counterKey, String(next + 1));
  }

  // Cloudflare KV não fornece incremento atômico. O sufixo criptográfico
  // impede que duas leituras concorrentes do mesmo contador gerem o mesmo PED.
  return `${formatOrderNumber(yy, next)}-${randomSuffix()}`;
}

function randomSuffix() {
  try {
    const bytes = new Uint8Array(RANDOM_SUFFIX_BYTES);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  } catch (_) {
    const fallback = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
      .replace(/[^a-f0-9]/gi, "")
      .toUpperCase();
    return fallback.padEnd(RANDOM_SUFFIX_BYTES * 2, "0").slice(0, RANDOM_SUFFIX_BYTES * 2);
  }
}

function isOrderObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
