import { json } from "../_config.js";
import { createSessionCookie, getAdminSecret } from "./_auth.js";

export async function onRequestPost(context) {
  try {
    const secret = getAdminSecret(context.env);
    if (!secret) return json({ ok: false, error: "ADMIN_SECRET_KEY_NAO_CONFIGURADA" }, 500);

    const body = await context.request.json().catch(() => ({}));
    const password = String(body.password || "").trim();
    if (!password || password !== secret) {
      return json({ ok: false, error: "SENHA_INVALIDA" }, 401);
    }

    const cookie = await createSessionCookie(context.env);
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message || error) }, 500);
  }
}
