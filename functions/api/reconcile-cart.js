import { json } from './_config.js';
import { baseIndexParams, readIndex } from './_catalog_index.js';

const ROOTS = Object.freeze({
  '50x50': '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
  'painel-150': '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
});

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items.slice(0, 200).map(normalizeItem).filter(Boolean) : [];
    if (!items.length) return json({ ok: true, items: [], migrations: [], removed: [] }, 200);

    const exactRows = await rowsByIds(context.env, items.map(item => item.driveFileId));
    const exactById = new Map(exactRows.map(row => [String(row.drive_id || ''), row]));
    const migrations = [];
    const removed = [];
    const resolved = [];

    for (const item of items) {
      const exact = exactById.get(item.driveFileId);
      if (validForProduct(exact, item.productKey)) {
        resolved.push(toResolved(item, exact));
        continue;
      }

      const candidate = await uniqueReplacement(context.env, item);
      if (!candidate) {
        removed.push(safeMissing(item));
        continue;
      }

      resolved.push(toResolved(item, candidate));
      migrations.push({
        oldDriveFileId: item.driveFileId,
        driveFileId: String(candidate.drive_id || ''),
        code: clean(candidate.code || candidate.name).replace(/^#/, ''),
        theme: clean(candidate.theme || item.theme || 'Sem tema'),
        originalName: clean(candidate.name || item.originalName || ''),
        productKey: item.productKey,
        image: String(candidate.thumbnail_url || '').slice(0, 1000)
      });
    }

    return json({
      ok: true,
      items: resolved,
      migrations,
      removed,
      changed: Boolean(migrations.length || removed.length)
    }, 200);
  } catch (_) {
    return json({ ok: false, error: 'CART_RECONCILE_FAILED' }, 500);
  }
}

async function uniqueReplacement(env, item) {
  if (!item.code) return null;
  const params = baseIndexParams(80);
  params.set('type', 'eq.artwork');
  params.set('root_drive_id', 'eq.' + ROOTS[item.productKey]);
  params.set('code', 'eq.' + item.code);
  const rows = (await readIndex(env, params)).filter(row => validForProduct(row, item.productKey));
  if (!rows.length) return null;

  const wantedTheme = norm(item.theme);
  const wantedName = norm(item.originalName);
  let candidates = rows;

  if (wantedTheme) {
    const sameTheme = candidates.filter(row => norm(row.theme) === wantedTheme);
    if (sameTheme.length) candidates = sameTheme;
  }
  if (wantedName) {
    const sameName = candidates.filter(row => norm(row.name) === wantedName);
    if (sameName.length) candidates = sameName;
  }

  const unique = dedupe(candidates);
  return unique.length === 1 ? unique[0] : null;
}

async function rowsByIds(env, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const params = baseIndexParams(200);
  params.set('type', 'eq.artwork');
  params.set('drive_id', 'in.(' + unique.map(id => '"' + id + '"').join(',') + ')');
  return readIndex(env, params);
}

function normalizeItem(raw) {
  const driveFileId = cleanDriveId(raw && (raw.driveFileId || raw.id));
  const productKey = canonicalProduct(raw && (raw.productKey || raw.product));
  const quantity = Math.min(999, Math.max(1, Number.parseInt(raw && (raw.quantity || raw.qty), 10) || 0));
  if (!driveFileId || !productKey || !quantity) return null;
  return {
    driveFileId,
    productKey,
    quantity,
    code: clean(raw && raw.code).replace(/^#/, '').slice(0, 120),
    theme: clean(raw && raw.theme).slice(0, 240),
    originalName: clean(raw && raw.originalName).slice(0, 400),
    variantKey: clean(raw && raw.variantKey).slice(0, 120),
    sizeKey: clean(raw && raw.sizeKey).slice(0, 120),
    details: raw && raw.details && typeof raw.details === 'object' ? raw.details : {}
  };
}

function toResolved(item, row) {
  return {
    driveFileId: String(row.drive_id || item.driveFileId),
    productKey: item.productKey,
    quantity: item.quantity,
    variantKey: item.variantKey,
    sizeKey: item.sizeKey,
    details: item.details
  };
}
function safeMissing(item) {
  return { driveFileId: item.driveFileId, productKey: item.productKey, code: item.code, theme: item.theme };
}
function validForProduct(row, productKey) {
  return Boolean(row && ROOTS[productKey] && String(row.root_drive_id || '') === ROOTS[productKey]);
}
function dedupe(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const id = String(row.drive_id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
function canonicalProduct(value) {
  const text = clean(value).toLowerCase();
  if (text === '50x50' || text === 'bolinhas' || text === 'bolinha') return '50x50';
  if (text === 'painel-150' || text === 'painel150' || text === 'painel') return 'painel-150';
  return '';
}
function cleanDriveId(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_-]{5,200}$/.test(text) ? text : '';
}
function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
function norm(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
