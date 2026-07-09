import { requireAdmin } from "./_auth.js";
import { json, loadConfig } from "../_config.js";
import { buildProductionPayload, desktopToken, findOrderByNumber, normalizeProductionApi, productionStatuses } from "../production/_helpers.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const { config } = await loadConfig(context.env);
  const production = normalizeProductionApi(config.productionApi || {});
  return json({
    ok: true,
    production,
    tokenConfigured: !!desktopToken(context.env),
    endpoint: "/api/production/order?number=PED2600001A",
    statusEndpoint: "/api/production/status",
    statuses: productionStatuses(config)
  });
}

export async function onRequestPost(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const body = await context.request.json().catch(() => ({}));
  const number = String(body.number || body.orderNumber || body.pedido || "").trim();
  if (!number) return json({ ok: false, error: "NUMERO_DO_PEDIDO_OBRIGATORIO" }, 400);
  const found = await findOrderByNumber(context.env, number);
  if (!found.order) return json({ ok: false, error: found.error || "PEDIDO_NAO_ENCONTRADO" }, 404);
  return json({ ok: true, payload: await buildProductionPayload(found.order, context.env) });
}
