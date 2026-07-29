import {
  addCartLine,
  incrementCartLine,
  removeCartLine
} from './collection.mjs';
import {
  cartLineId,
  findCartLine
} from './line-identity.mjs';
import { resolveProductKey } from '../products/registry.mjs';

export function resolveCartQuantityRule(snapshot = {}, productInput = {}) {
  const productKey = resolveProductKey(
    typeof productInput === 'string'
      ? productInput
      : productInput?.productKey || productInput?.product || productInput?.productId
  );
  if (!productKey) throw quantityError('CART_QUANTITY_PRODUCT_KEY_INVALID');

  const product = record(snapshot.products)?.[productKey];
  if (!product) {
    const error = quantityError('CART_QUANTITY_RULE_REQUIRED');
    error.productKey = productKey;
    throw error;
  }

  const quantity = record(product.quantity);
  const minimum = positiveInteger(quantity.minimum);
  const step = positiveInteger(quantity.step);
  const scope = quantity.scope === 'item'
    ? 'item'
    : quantity.scope === 'cart-product-total'
      ? 'cart-product-total'
      : '';
  const initial = positiveInteger(quantity.initial) || minimum;

  if (!minimum) throw ruleError('CART_QUANTITY_MINIMUM_INVALID', productKey);
  if (!step) throw ruleError('CART_QUANTITY_STEP_INVALID', productKey);
  if (!scope) throw ruleError('CART_QUANTITY_SCOPE_INVALID', productKey);
  if (!initial || initial < minimum || (initial - minimum) % step !== 0) {
    throw ruleError('CART_QUANTITY_INITIAL_INVALID', productKey);
  }

  return deepFreeze({
    productKey,
    minimum,
    step,
    initial,
    scope,
    source: String(product.source || snapshot.metadata?.mode || 'authoritative-snapshot'),
    configVersion: positiveInteger(snapshot.metadata?.configVersion),
    catalogVersion: positiveInteger(snapshot.metadata?.catalogVersion)
  });
}

export function validateCartQuantityRules(lines = [], snapshot = {}) {
  if (!Array.isArray(lines)) throw quantityError('CART_LINES_ARRAY_REQUIRED');

  const errors = [];
  const groups = groupByProduct(lines);

  for (const [productKey, productLines] of groups.entries()) {
    let rule;
    try {
      rule = resolveCartQuantityRule(snapshot, productKey);
    } catch (error) {
      errors.push(publicError(error, productKey));
      continue;
    }

    if (rule.scope === 'item') {
      for (const line of productLines) {
        const quantity = lineQuantity(line);
        const validation = validateQuantityValue(quantity, rule);
        if (!validation.ok) errors.push(`${validation.code}:${productKey}:${cartLineId(line)}`);
      }
      continue;
    }

    const total = productLines.reduce((sum, line) => sum + lineQuantity(line), 0);
    const validation = validateQuantityValue(total, rule);
    if (!validation.ok) errors.push(`${validation.code}:${productKey}`);
  }

  return deepFreeze({
    ok: errors.length === 0,
    errors: unique(errors),
    productCount: groups.size,
    lineCount: lines.length,
    quantity: lines.reduce((sum, line) => sum + lineQuantity(line), 0)
  });
}

export function addCartLineByQuantityRule(lines = [], candidate = {}, snapshot = {}) {
  assertValidExistingState(lines, snapshot);
  const rule = resolveCartQuantityRule(snapshot, candidate);
  const existing = findCartLine(lines, candidate);

  let next;
  if (existing) {
    next = incrementCartLine(lines, candidate, rule.step);
  } else {
    const productLines = lines.filter(line => productKeyOf(line) === rule.productKey);
    const initialQuantity = rule.scope === 'item' || productLines.length === 0
      ? rule.initial
      : rule.step;
    next = addCartLine(lines, candidate, { quantity: initialQuantity });
  }

  assertValidNextState(next, snapshot);
  return next;
}

export function decrementCartLineByQuantityRule(lines = [], candidate = {}, snapshot = {}) {
  assertValidExistingState(lines, snapshot);
  const rule = resolveCartQuantityRule(snapshot, candidate);
  const existing = findCartLine(lines, candidate);
  if (!existing) throw quantityError('CART_LINE_NOT_FOUND');

  const currentQuantity = lineQuantity(existing.line);
  let next;

  if (rule.scope === 'item') {
    next = currentQuantity - rule.step >= rule.minimum
      ? incrementCartLine(lines, candidate, -rule.step)
      : removeCartLine(lines, candidate);
  } else {
    const productLines = lines.filter(line => productKeyOf(line) === rule.productKey);
    const productTotal = productLines.reduce((sum, line) => sum + lineQuantity(line), 0);
    const decrementedTotal = productTotal - rule.step;

    if (currentQuantity > rule.step && isValidQuantity(decrementedTotal, rule)) {
      next = incrementCartLine(lines, candidate, -rule.step);
    } else {
      const remainingTotal = productTotal - currentQuantity;
      if (remainingTotal !== 0 && !isValidQuantity(remainingTotal, rule)) {
        const error = quantityError('CART_PRODUCT_QUANTITY_WOULD_BECOME_INVALID');
        error.productKey = rule.productKey;
        throw error;
      }
      next = removeCartLine(lines, candidate);
    }
  }

  assertValidNextState(next, snapshot);
  return next;
}

export function cartProductQuantityState(lines = [], productInput = {}, snapshot = {}) {
  if (!Array.isArray(lines)) throw quantityError('CART_LINES_ARRAY_REQUIRED');
  const rule = resolveCartQuantityRule(snapshot, productInput);
  const productLines = lines.filter(line => productKeyOf(line) === rule.productKey);
  const quantity = productLines.reduce((sum, line) => sum + lineQuantity(line), 0);
  const validation = quantity === 0
    ? { ok: true, code: '' }
    : validateQuantityValue(quantity, rule);

  return deepFreeze({
    productKey: rule.productKey,
    lineCount: productLines.length,
    quantity,
    minimum: rule.minimum,
    step: rule.step,
    initial: rule.initial,
    scope: rule.scope,
    ok: validation.ok,
    error: validation.code,
    nextValidQuantity: quantity === 0
      ? rule.initial
      : nextValidQuantity(quantity, rule),
    previousValidQuantity: previousValidQuantity(quantity, rule)
  });
}

export function nextValidQuantity(quantity, ruleInput = {}) {
  const rule = normalizeRuleInput(ruleInput);
  const value = nonNegativeInteger(quantity);
  if (value < rule.minimum) return rule.minimum;
  const remainder = (value - rule.minimum) % rule.step;
  return remainder === 0 ? value + rule.step : value + (rule.step - remainder);
}

export function previousValidQuantity(quantity, ruleInput = {}) {
  const rule = normalizeRuleInput(ruleInput);
  const value = nonNegativeInteger(quantity);
  if (value <= rule.minimum) return 0;
  const previous = value - rule.step;
  return previous >= rule.minimum ? previous : 0;
}

function assertValidExistingState(lines, snapshot) {
  const validation = validateCartQuantityRules(lines, snapshot);
  if (!validation.ok && lines.length) {
    const error = quantityError('CART_QUANTITY_EXISTING_STATE_INVALID');
    error.details = validation.errors;
    throw error;
  }
}

function assertValidNextState(lines, snapshot) {
  const validation = validateCartQuantityRules(lines, snapshot);
  if (!validation.ok) {
    const error = quantityError('CART_QUANTITY_NEXT_STATE_INVALID');
    error.details = validation.errors;
    throw error;
  }
}

function groupByProduct(lines) {
  const groups = new Map();
  for (const line of lines) {
    const productKey = productKeyOf(line);
    if (!productKey) {
      const error = quantityError('CART_QUANTITY_PRODUCT_KEY_INVALID');
      error.lineId = safeLineId(line);
      throw error;
    }
    if (!groups.has(productKey)) groups.set(productKey, []);
    groups.get(productKey).push(line);
  }
  return groups;
}

function productKeyOf(line) {
  return resolveProductKey(line?.productKey || line?.product || line?.productId) || '';
}

function validateQuantityValue(value, rule) {
  if (!Number.isInteger(value) || value < rule.minimum) {
    return { ok: false, code: 'CART_QUANTITY_BELOW_MINIMUM' };
  }
  if ((value - rule.minimum) % rule.step !== 0) {
    return { ok: false, code: 'CART_QUANTITY_STEP_INVALID' };
  }
  return { ok: true, code: '' };
}

function isValidQuantity(value, rule) {
  return validateQuantityValue(value, rule).ok;
}

function normalizeRuleInput(input) {
  const minimum = positiveInteger(input.minimum);
  const step = positiveInteger(input.step);
  if (!minimum) throw quantityError('CART_QUANTITY_MINIMUM_INVALID');
  if (!step) throw quantityError('CART_QUANTITY_STEP_INVALID');
  return { minimum, step };
}

function lineQuantity(line) {
  const parsed = Number(line?.quantity ?? line?.qty);
  if (!Number.isInteger(parsed) || parsed < 1) throw quantityError('CART_LINE_QUANTITY_INVALID');
  return parsed;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function publicError(error, productKey) {
  const code = /^[A-Z0-9_]{3,100}$/.test(String(error?.code || ''))
    ? error.code
    : 'CART_QUANTITY_RULE_INVALID';
  return `${code}:${productKey}`;
}

function safeLineId(line) {
  try {
    return cartLineId(line);
  } catch (_) {
    return 'unknown';
  }
}

function ruleError(code, productKey) {
  const error = quantityError(code);
  error.productKey = productKey;
  return error;
}

function quantityError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
