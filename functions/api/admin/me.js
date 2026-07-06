import { json } from "../_config.js";
import { requireAdmin } from "./_auth.js";

export async function onRequestGet(context) {
  const auth = await requireAdmin(context.request, context.env);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  return json({ ok: true, user: auth.user });
}
