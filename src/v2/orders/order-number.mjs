const BLOCK_SIZE = 10_000;
const ORDER_NUMBER_RE = /^PED(\d{2})(\d{5})([A-Z])$/;

export function orderYearCode(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw orderNumberError('ORDER_DATE_INVALID');
  return String(date.getUTCFullYear()).slice(-2);
}

export function formatOrderNumberV2(createdAt, sequence) {
  const year = orderYearCode(createdAt);
  const normalizedSequence = positiveInteger(sequence);
  if (!normalizedSequence) throw orderNumberError('ORDER_SEQUENCE_INVALID');

  const block = Math.floor((normalizedSequence - 1) / BLOCK_SIZE);
  if (block >= 26) throw orderNumberError('ORDER_SEQUENCE_CAPACITY_EXCEEDED');

  const number = ((normalizedSequence - 1) % BLOCK_SIZE) + 1;
  const suffix = String.fromCharCode(65 + block);
  return `PED${year}${String(number).padStart(5, '0')}${suffix}`;
}

export function parseOrderNumberV2(value) {
  const match = String(value ?? '').trim().toUpperCase().match(ORDER_NUMBER_RE);
  if (!match) return null;

  return Object.freeze({
    yearCode: match[1],
    sequence: (match[3].charCodeAt(0) - 65) * BLOCK_SIZE + Number.parseInt(match[2], 10)
  });
}

export function orderLedgerShardName(createdAt) {
  return `orders:${orderYearCode(createdAt)}`;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function orderNumberError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
