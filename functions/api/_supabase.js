function envValue(env, names) {
  for (const name of names) {
    const value = String(env && env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export function supabaseReady(env) {
  return Boolean(getSupabaseUrl(env) && getSupabaseKey(env));
}

export function getSupabaseUrl(env) {
  const raw = envValue(env, ['SUPABASE_URL', 'SUPABASE_REST_URL']);
  if (!raw) return '';
  return raw.replace(/\/$/, '').replace(/\/rest\/v1$/, '');
}

export function getSupabaseKey(env) {
  return envValue(env, ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY']);
}

export async function supabaseRequest(env, path, options = {}) {
  const base = getSupabaseUrl(env);
  const key = getSupabaseKey(env);
  if (!base || !key) throw new Error('SUPABASE_ENV_NAO_CONFIGURADO');

  const headers = new Headers(options.headers || {});
  headers.set('apikey', key);
  headers.set('Authorization', `Bearer ${key}`);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${base}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    const detail = typeof data === 'object' && data ? (data.message || data.details || data.hint || JSON.stringify(data)) : String(data || text || response.status);
    throw new Error(`SUPABASE_${response.status}: ${detail}`.slice(0, 500));
  }
  return data;
}

export async function saveOrderToSupabase(env, order) {
  if (!supabaseReady(env) || !order || !order.id) return null;
  const customerId = await upsertCustomer(env, order.customer || {});
  const seller = order.seller || {};
  const row = {
    id: String(order.id),
    order_number: String(order.orderNumber || order.orderCode || order.displayId || order.id),
    order_code: String(order.orderCode || order.orderNumber || order.id),
    display_id: String(order.displayId || order.orderNumber || order.id),
    legacy_id: String(order.legacyId || ''),
    customer_id: customerId,
    customer_name: String(order.customer && order.customer.name || ''),
    customer_whatsapp: digits(order.customer && (order.customer.whatsapp || order.customer.phone)),
    seller_id: norm(seller.id || seller.sellerId || seller.username || seller.label || seller.name),
    seller_name: String(seller.label || seller.name || seller.id || ''),
    status: String(order.status || 'Novo'),
    qty: Number(order.qty || 0) || 0,
    totals: order.totals || {},
    source: String(order.source || 'catalog'),
    user_agent: String(order.userAgent || '').slice(0, 500),
    raw: order || {},
    created_at: order.createdAt || new Date().toISOString(),
    updated_at: order.updatedAt || new Date().toISOString(),
    deleted_at: order.deletedAt || null
  };

  const saved = await supabaseRequest(env, '/orders?on_conflict=id&select=*', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: row
  });

  await supabaseRequest(env, `/order_items?order_id=eq.${encodeURIComponent(row.id)}`, { method: 'DELETE' });
  const items = normalizeItems(order.items || []).map(item => ({
    order_id: row.id,
    code: String(item.code || ''),
    theme: String(item.theme || ''),
    product: String(item.product || ''),
    product_name: String(item.productName || item.product_name || ''),
    qty: Number(item.qty || item.quantity || 1) || 1,
    image: String(item.image || item.thumbnail || ''),
    raw: item || {}
  }));
  if (items.length) {
    await supabaseRequest(env, '/order_items', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: items
    });
  }
  return Array.isArray(saved) ? saved[0] : saved;
}

export async function listOrdersFromSupabase(env, auth, limit = 300) {
  if (!supabaseReady(env)) return null;
  const capped = Math.min(Number(limit) || 300, 500);
  let path = `/orders?select=*,order_items(*)&deleted_at=is.null&order=created_at.desc&limit=${capped}`;
  if (auth && auth.role === 'vendedora' && auth.sellerId) path += `&seller_id=eq.${encodeURIComponent(norm(auth.sellerId))}`;
  const rows = await supabaseRequest(env, path);
  return (Array.isArray(rows) ? rows : []).map(orderFromRow);
}

export async function findOrderInSupabase(env, number) {
  if (!supabaseReady(env)) return null;
  const wanted = String(number || '').trim().toUpperCase();
  if (!wanted) return null;
  const q = encodeURIComponent(wanted);
  const rows = await supabaseRequest(env, `/orders?select=*,order_items(*)&deleted_at=is.null&or=(id.eq.${q},order_number.eq.${q},order_code.eq.${q},display_id.eq.${q},legacy_id.eq.${q})&limit=1`);
  return Array.isArray(rows) && rows[0] ? orderFromRow(rows[0]) : null;
}

export async function updateOrderStatusInSupabase(env, auth, id, status) {
  if (!supabaseReady(env)) return null;
  let path = `/orders?id=eq.${encodeURIComponent(id)}&select=*,order_items(*)`;
  if (auth && auth.role === 'vendedora' && auth.sellerId) path += `&seller_id=eq.${encodeURIComponent(norm(auth.sellerId))}`;
  const rows = await supabaseRequest(env, path, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { status: String(status || 'Novo'), updated_at: new Date().toISOString() }
  });
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? orderFromRow(row) : null;
}

export async function softDeleteOrderInSupabase(env, id) {
  if (!supabaseReady(env)) return null;
  const rows = await supabaseRequest(env, `/orders?id=eq.${encodeURIComponent(id)}&select=id`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: { deleted_at: new Date().toISOString() }
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function upsertCustomer(env, customer) {
  const whatsapp = digits(customer.whatsapp || customer.phone);
  const phone = digits(customer.phone || customer.whatsapp);
  if (!whatsapp && !phone) return null;
  const match = whatsapp || phone;
  const existing = await supabaseRequest(env, `/customers?whatsapp_digits=eq.${encodeURIComponent(match)}&select=id&limit=1`);
  if (Array.isArray(existing) && existing[0] && existing[0].id) {
    await supabaseRequest(env, `/customers?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { name: String(customer.name || ''), phone, whatsapp, metadata: customer || {} }
    });
    return existing[0].id;
  }
  const inserted = await supabaseRequest(env, '/customers?select=id', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { name: String(customer.name || ''), phone, whatsapp, metadata: customer || {} }
  });
  return Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
}

export function orderFromRow(row) {
  const raw = row.raw && typeof row.raw === 'object' ? row.raw : {};
  const items = Array.isArray(row.order_items) ? row.order_items.map(item => ({
    code: item.code || '',
    theme: item.theme || '',
    product: item.product || '',
    productName: item.product_name || '',
    qty: Number(item.qty || 1),
    image: item.image || ''
  })) : (Array.isArray(raw.items) ? raw.items : []);
  return {
    ...raw,
    id: row.id,
    orderNumber: row.order_number,
    orderCode: row.order_code || row.order_number,
    displayId: row.display_id || row.order_number,
    legacyId: row.legacy_id || raw.legacyId || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || undefined,
    status: row.status || raw.status || 'Novo',
    seller: raw.seller || { id: row.seller_id, label: row.seller_name },
    customer: raw.customer || { name: row.customer_name, whatsapp: row.customer_whatsapp },
    totals: row.totals || raw.totals || {},
    qty: Number(row.qty || raw.qty || 0),
    source: row.source || raw.source || 'catalog',
    userAgent: row.user_agent || raw.userAgent || '',
    items
  };
}

function normalizeItems(items) { return Array.isArray(items) ? items.slice(0, 200) : []; }
function digits(value) { return String(value || '').replace(/\D/g, ''); }
function norm(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
