const PEDIDOS_SIDEBAR_SCRIPT = '<script src="/assets/pedidos-sidebar.js?v=1" defer></script>';

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  if (!html.includes('/assets/pedidos-sidebar.js')) {
    html = html.replace('</body>', `${PEDIDOS_SIDEBAR_SCRIPT}</body>`);
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
