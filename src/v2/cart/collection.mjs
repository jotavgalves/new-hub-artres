import {
  attachCartLineIdentity,
  cartLineId,
  findCartLine
} from './line-identity.mjs';

const MAX_CART_LINES = 500;
const MAX_LINE_QUANTITY = 100000;

export function addCartLine(lines = [], candidate = {}, options = {}) {
  const source = validatedLines(lines);
  const incoming = canonicalCartLine(candidate, options.quantity);
  const existing = findCartLine(source, incoming);

  if (!existing) {
    if (source.length >= MAX_CART_LINES) throw collectionError('CART_LINE_LIMIT_EXCEEDED');
    return freezeLines([...source, incoming]);
  }

  const mergedQuantity = checkedQuantity(
    lineQuantity(existing.line) + incoming.quantity,
    'CART_LINE_QUANTITY_LIMIT_EXCEEDED'
  );
  const next = source.map((line, index) => (
    index === existing.index
      ? withQuantity(line, mergedQuantity)
      : line
  ));
  return freezeLines(next);
}

export function setCartLineQuantity(lines = [], identityCandidate = {}, quantity) {
  const source = validatedLines(lines);
  const targetLineId = cartLineId(identityCandidate);
  const nextQuantity = checkedQuantity(quantity);
  let updated = false;

  const next = source.map(line => {
    if (cartLineId(line) !== targetLineId) return line;
    updated = true;
    return withQuantity(line, nextQuantity);
  });

  if (!updated) throw collectionError('CART_LINE_NOT_FOUND');
  return freezeLines(next);
}

export function incrementCartLine(lines = [], identityCandidate = {}, delta = 1) {
  const source = validatedLines(lines);
  const targetLineId = cartLineId(identityCandidate);
  const parsedDelta = integer(delta);
  if (!parsedDelta) throw collectionError('CART_LINE_DELTA_INVALID');
  let updated = false;

  const next = source.map(line => {
    if (cartLineId(line) !== targetLineId) return line;
    updated = true;
    return withQuantity(
      line,
      checkedQuantity(
        lineQuantity(line) + parsedDelta,
        'CART_LINE_QUANTITY_LIMIT_EXCEEDED'
      )
    );
  });

  if (!updated) throw collectionError('CART_LINE_NOT_FOUND');
  return freezeLines(next);
}

export function removeCartLine(lines = [], identityCandidate = {}) {
  const source = validatedLines(lines);
  const targetLineId = cartLineId(identityCandidate);
  const next = source.filter(line => cartLineId(line) !== targetLineId);
  if (next.length === source.length) throw collectionError('CART_LINE_NOT_FOUND');
  return freezeLines(next);
}

export function cartCollectionSummary(lines = []) {
  const source = validatedLines(lines);
  const codeCounts = new Map();
  let quantity = 0;

  for (const line of source) {
    quantity += lineQuantity(line);
    const code = visualCode(line);
    if (code) codeCounts.set(code, (codeCounts.get(code) || 0) + 1);
  }

  return deepFreeze({
    lineCount: source.length,
    quantity,
    distinctVisualCodeCount: codeCounts.size,
    repeatedVisualCodeCount: [...codeCounts.values()].filter(count => count > 1).length,
    repeatedVisualCodeLineCount: [...codeCounts.values()]
      .filter(count => count > 1)
      .reduce((total, count) => total + count, 0)
  });
}

export function assertCartCollectionIntegrity(lines = []) {
  const source = validatedLines(lines);
  return deepFreeze({
    ok: true,
    lineCount: source.length,
    quantity: source.reduce((total, line) => total + lineQuantity(line), 0)
  });
}

function canonicalCartLine(candidate, quantityOverride) {
  const attached = attachCartLineIdentity(candidate);
  const quantity = checkedQuantity(
    quantityOverride === undefined ? lineQuantity(candidate) : quantityOverride
  );
  return deepFreeze({
    ...attached,
    quantity,
    qty: quantity
  });
}

function withQuantity(line, quantity) {
  const parsed = checkedQuantity(quantity);
  return deepFreeze({
    ...line,
    quantity: parsed,
    qty: parsed
  });
}

function validatedLines(lines) {
  if (!Array.isArray(lines)) throw collectionError('CART_LINES_ARRAY_REQUIRED');
  if (lines.length > MAX_CART_LINES) throw collectionError('CART_LINE_LIMIT_EXCEEDED');

  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineId = cartLineId(line);
    checkedQuantity(lineQuantity(line));
    if (seen.has(lineId)) {
      const error = collectionError('CART_LINE_ID_DUPLICATED');
      error.lineId = lineId;
      error.duplicateIndex = index;
      throw error;
    }
    seen.add(lineId);
  }

  return lines;
}

function lineQuantity(line) {
  const value = line?.quantity ?? line?.qty;
  if (value === undefined || value === null || value === '') return 1;
  return integer(value);
}

function checkedQuantity(value, overflowCode = 'CART_LINE_QUANTITY_INVALID') {
  const parsed = integer(value);
  if (!parsed || parsed < 1) throw collectionError('CART_LINE_QUANTITY_INVALID');
  if (parsed > MAX_LINE_QUANTITY) throw collectionError(overflowCode);
  return parsed;
}

function integer(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
}

function visualCode(line) {
  return String(line?.code ?? line?.codigo ?? '').replace(/\s+/g, ' ').trim();
}

function freezeLines(lines) {
  const frozen = lines.map(line => deepFreeze({ ...line }));
  return Object.freeze(frozen);
}

function collectionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
