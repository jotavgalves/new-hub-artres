import { json } from "../_config.js";
import { requireRole } from "../admin/_auth.js";

const ORDER_PREFIX = "ORDER:";
const DELETED_ORDER_PREFIX = "ORDER_DELETED:";

export async function onRequestPost(context) {
  const auth = await requireRole(context.request, context.env, ["admin"]);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!context.env.CONFIG_KV) return json({ ok: false, error: "CONFIG_KV_NAO_CONFIGURADO" }, 500);

  const body = await context.request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return json({ ok: false, error: "ID_OBRIGATORIO" }, 400);

  const key = `${ORDER_PREFIX}${id}`;
  const raw = await context.env.CONFIG_KV.get(key);
  if (!raw) return json({ ok: true, deleted: false, alreadyMissing: true, id });

  const order = JSON.parse(raw);
  order.deletedAt = new Date().toISOString();
  await context.env.CONFIG_KV.put(`${DELETED_ORDER_PREFIX}${id}`, JSON.stringify(order, null, 2));
  await context.env.CONFIG_KV.delete(key);
  return json({ ok: true, deleted: true, id });
}
