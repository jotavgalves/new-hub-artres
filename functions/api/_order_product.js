export function canonicalProductKey(value) {
  const raw = clean(value);
  const text = norm(raw);
  if (!text) return '';

  if (['50x50', '50 x 50', 'bolinhas', 'bolinha', 'bolinhas 50x50', 'painel 50', 'painel 50x50'].includes(text)) return '50x50';
  if (['painel-150', 'painel150', 'painel 150', 'painel 150x150', '150x150', '150 x 150', 'painel redondo', 'painel redondo 1,50', 'painel redondo 1.50'].includes(text)) return 'painel-150';
  if (['painel-romano', 'painel romano', 'painel romano 1x2', 'painel romano 1 x 2', 'romano 1x2', 'romano 1 x 2'].includes(text)) return 'painel-romano';
  if (['cenario', 'cenário'].includes(text)) return 'cenario';
  if (['lateral', 'retangular', 'vertical', 'retrato'].includes(text)) return 'lateral';
  if (['sacolinha', 'sacolinhas', 'sacolinha de festa'].includes(text)) return 'sacolinha';
  if (['cilindro', 'cilindros'].includes(text)) return 'cilindros';
  if (['romano', 'arco romano'].includes(text)) return 'romano';
  if (['romano-lateral', 'romano lateral', 'romano + lateral', 'arco romano + lateral'].includes(text)) return 'romano-lateral';
  if (['kit-romano', 'kit romano', 'kit + romano'].includes(text)) return 'kit-romano';
  if (['kit-painel-cilindros', 'kit painel cilindros', 'kit painel + cilindros', 'kit redondo + cilindros'].includes(text)) return 'kit-painel-cilindros';

  return raw;
}

export function canonicalProductLabel(productKey, fallback = '') {
  const key = canonicalProductKey(productKey);
  const labels = {
    '50x50': 'Bolinhas 50x50',
    'painel-150': 'Painel 150x150',
    'painel-romano': 'Painel Romano 1x2',
    cenario: 'Cenário',
    lateral: 'Lateral',
    sacolinha: 'Sacolinha de Festa',
    cilindros: 'Cilindros',
    romano: 'Romano',
    'romano-lateral': 'Romano + Lateral',
    'kit-romano': 'Kit + Romano',
    'kit-painel-cilindros': 'Kit Painel + Cilindros'
  };
  return labels[key] || clean(fallback) || key;
}

export function canonicalSizeKey(value, productKey = '') {
  const explicit = normalizeSize(value);
  if (explicit) return explicit;
  const key = canonicalProductKey(productKey);
  if (key === '50x50') return '50x50';
  if (key === 'painel-150') return '150x150';
  if (key === 'painel-romano') return '100x200';
  return '';
}

export function canonicalSizeLabel(value, productKey = '') {
  const key = canonicalSizeKey(value, productKey);
  if (key === '50x50') return '50X50';
  if (key === '150x150') return '150X150';
  if (key === '100x200') return '1X2';
  return clean(value);
}

export function enrichOrderItem(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const product = clean(raw.product || raw.productKey);
  const productKey = canonicalProductKey(raw.productKey || product);
  const productName = clean(raw.productName || raw.product_name) || canonicalProductLabel(productKey, product);
  const sizeKey = canonicalSizeKey(raw.sizeKey || raw.size || raw.dimension, productKey);
  const size = canonicalSizeLabel(raw.size || raw.dimension, productKey);
  const details = raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details) ? raw.details : {};

  return {
    ...raw,
    product,
    productKey,
    productName,
    sizeKey,
    size,
    details
  };
}

export function enrichOrder(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return {
    ...value,
    items: Array.isArray(value.items) ? value.items.map(enrichOrderItem) : []
  };
}

function normalizeSize(value) {
  const text = clean(value).toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '');
  if (!text) return '';
  if (text === '50x50' || text === '50x50cm' || text === '0,50x0,50' || text === '0.50x0.50') return '50x50';
  if (text === '150x150' || text === '150x150cm' || text === '1,50x1,50' || text === '1.50x1.50') return '150x150';
  if (text === '100x200' || text === '100x200cm' || text === '1x2' || text === '1,00x2,00' || text === '1.00x2.00' || text === '1mx2m') return '100x200';
  return clean(value);
}

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function norm(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
