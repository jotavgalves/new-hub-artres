const COUNTER_PREFIX = "ORDER_COUNTER:";
const BLOCK_SIZE = 10000;
const RANDOM_SUFFIX_BYTES = 6;
const CODE_RE = /^PED(\d{2})(\d{5})([A-Z]+)(?:-([A-F0-9]{12}))?$/;

export function yearCode(value) {
  const d = value ? new Date(value) : new Date();
  const y = Number.isFinite(d.getTime()) ? d.getFullYear() : new Date().getFullYear();
  return String(y).slice(-2);
}

export function formatOrderNumber(yy, sequence) {
  const seq = positiveSafeInteger(sequence);
  if (!seq) throw new Error("ORDER_SEQUENCE_INVALID");
  const block = Math.floor((seq - 1) / BLOCK_SIZE);
  const number = ((seq - 1) % BLOCK_SIZE) + 1;
  return `PED${String(yy).slice(-2)}${String(number).padStart(5, "0")}${encodeBlock(block)}`;
}

export function parseOrderNumber(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const m = normalized.match(CODE_RE);
  if (!m) return null;
  const block = decodeBlock(m[3]);
  const sequence = block * BLOCK_SIZE + parseInt(m[2], 10);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return {
    yy: m[1],
    sequence,
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
    const parsed = Number.parseInt(raw || "", 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) next = parsed;
    await env.CONFIG_KV.put(counterKey, String(next + 1));
  }

  // Cloudflare KV não fornece incremento atômico. O sufixo criptográfico
  // impede que duas leituras concorrentes do mesmo contador gerem o mesmo PED.
  return `${formatOrderNumber(yy, next)}-${randomSuffix()}`;
}

function encodeBlock(block) {
  let value = Number(block) + 1;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("ORDER_BLOCK_INVALID");
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function decodeBlock(label) {
  let value = 0;
  for (const char of String(label || "")) {
    const digit = char.charCodeAt(0) - 64;
    if (digit < 1 || digit > 26) return -1;
    value = value * 26 + digit;
    if (!Number.isSafeInteger(value)) return -1;
  }
  return value - 1;
}

function positiveSafeInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
