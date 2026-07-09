import { buildProductionPayload, findOrderByNumber, jsonCors, loadProductionConfig, optionsResponse, requireDesktopToken, updateOrderProductionStatus } from "./_helpers.js";

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  return handle(context);
}

export async function onRequestPost(context) {
  return handle(context);
}

async function handle(context) {
  const token = await requireDesktopToken(context.request, context.env);
  if (!token.ok) return jsonCors({ ok: false, error: token.error }, token.status);

  const { production } = await loadProductionConfig(context.env);
  if (!production.enabled) return jsonCors({ ok: false, error: "API_DE_PRODUCAO_DESATIVADA" }, 403);

  const url = new URL(context.request.url);
  const body = context.request.method === "POST" ? await context.request.json().catch(() => ({})) : {};
  const number = String(url.searchParams.get("number") || url.searchParams.get("pedido") || body.number || body.orderNumber || body.pedido || "").trim();
  if (!number) return jsonCors({ ok: false, error: "NUMERO_DO_PEDIDO_OBRIGATORIO" }, 400);

  const found = await findOrderByNumber(context.env, number);
  if (!found.order) return jsonCors({ ok: false, error: found.error || "PEDIDO_NAO_ENCONTRADO" }, found.error === "CONFIG_KV_NAO_CONFIGURADO" ? 500 : 404);

  if (production.allowStatusUpdate && production.statusOnFetch) {
    found.order = await updateOrderProductionStatus(context.env, found, production.statusOnFetch, production.actorName, "Pedido consultado pelo app desktop.") || found.order;
  }

  return jsonCors(await buildProductionPayload(found.order, context.env));
}
