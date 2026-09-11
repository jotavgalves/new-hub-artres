const PEDIDOS_SIDEBAR_SCRIPT = '<script id="adminPedidosSidebarScript" src="/assets/pedidos-sidebar.js?v=3" defer></script>';
const PAINEL_ROMANO_ADMIN_SCRIPT = '<script id="adminPainelRomanoScript" src="/assets/admin-painel-romano.js?v=1" defer></script>';
const RETANGULAR_1X2_ADMIN_SCRIPT = '<script id="adminRetangular1x2Script" src="/assets/admin-retangular-1x2.js?v=1" defer></script>';

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const scripts = [];
  if (!html.includes('/assets/pedidos-sidebar.js')) scripts.push(PEDIDOS_SIDEBAR_SCRIPT);
  if (!html.includes('/assets/admin-painel-romano.js')) scripts.push(PAINEL_ROMANO_ADMIN_SCRIPT);
  if (!html.includes('/assets/admin-retangular-1x2.js')) scripts.push(RETANGULAR_1X2_ADMIN_SCRIPT);
  if (scripts.length) html = html.replace('</body>', `${scripts.join('')}</body>`);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
