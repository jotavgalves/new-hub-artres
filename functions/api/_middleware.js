export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/api/drive')) return response;
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  headers.delete('ETag');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
