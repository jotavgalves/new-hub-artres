const BLOCK_SIZE = 10_000;
const ORDER_NUMBER_RE = /^PED(\d{2})(\d{5})([A-Z]+)$/;

export function orderYearCode(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw orderNumberError('ORDER_DATE_INVALID');
  return String(date.getUTCFullYear()).slice(-2);
}

export function formatOrderNumberV2(createdAt, sequence) {
  const year = orderYearCode(createdAt);
  const normalizedSequence = positiveSafeInteger(sequence);
  if (!normalizedSequence) throw orderNumberError('ORDER_SEQUENCE_INVALID');

  const block = Math.floor((normalizedSequence - 1) / BLOCK_SIZE);
  const number = ((normalizedSequence - 1) % BLOCK_SIZE) + 1;
  return `PED${year}${String(number).padStart(5, '0')}${encodeBlock(block)}`;
}

export function parseOrderNumberV2(value) {
  const match = String(value ?? '').trim().toUpperCase().match(ORDER_NUMBER_RE);
  if (!match) return null;
  const block = decodeBlock(match[3]);
  const sequence = block * BLOCK_SIZE + Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;

  return Object.freeze({
    yearCode: match[1],
    sequence
  });
}

export function orderLedgerShardName(createdAt) {
  return `orders:${orderYearCode(createdAt)}`;
}

function encodeBlock(block) {
  let value = Number(block) + 1;
  if (!Number.isSafeInteger(value) || value < 1) throw orderNumberError('ORDER_BLOCK_INVALID');
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function decodeBlock(label) {
  let value = 0;
  for (const char of String(label || '')) {
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

function orderNumberError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
