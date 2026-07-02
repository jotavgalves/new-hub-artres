import { buildProductionPayload, findOrderByNumber, jsonCors, loadProductionConfig, optionsResponse, requireDesktopToken, updateOrderProductionStatus } from "./_helpers.js";

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const token = await requireDesktopToken(context.request, context.env);
  if (!token.ok) return jsonCors({ ok: false, error: token.error }, token.status);

  const { config, production } = await loadProductionConfig(context.env);
  if (!production.enabled) return jsonCors({ ok: false, error: "API_DE_PRODUCAO_DESATIVADA" }, 403);
  if (!production.allowStatusUpdate) return jsonCors({ ok: false, error: "ATUALIZACAO_DE_STATUS_DESATIVADA" }, 403);

  const body = await context.request.json().catch(() => ({}));
  const number = String(body.number || body.orderNumber || body.pedido || "").trim();
  if (!number) return jsonCors({ ok: false, error: "NUMERO_DO_PEDIDO_OBRIGATORIO" }, 400);

  const found = await findOrderByNumber(context.env, number);
  if (!found.order) return jsonCors({ ok: false, error: found.error || "PEDIDO_NAO_ENCONTRADO" }, 404);

  const status = String(body.status || production.statusOnComplete || "Separado").trim();
  const order = await updateOrderProductionStatus(context.env, found, status, production.actorName, body.message || "Status atualizado pelo app desktop.");
  return jsonCors(buildProductionPayload(order || found.order, config));
}
