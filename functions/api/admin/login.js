import { json } from "../_config.js";
import { authenticateUser, createSessionCookie, safeUser } from "./_auth.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const username = String(body.username || body.user || body.login || "admin").trim();
    const password = String(body.password || "").trim();

    const auth = await authenticateUser(context.env, username, password);
    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status || 401);

    const cookie = await createSessionCookie(context.env, auth.user);
    return json({ ok: true, user: safeUser(auth.user) }, 200, { "Set-Cookie": cookie });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message || error) }, 500);
  }
}
