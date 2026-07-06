import { json } from "../_config.js";
import { authenticateUser, createSessionCookie, getAdminSecret, safeUser } from "./_auth.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const rawUsername = String(body.username || body.user || body.login || "").trim();
    const username = rawUsername || "admin";
    const password = String(body.password || "").trim();

    let auth = await authenticateUser(context.env, username, password);

    // Compatibilidade: se a pessoa digitou qualquer texto no campo usuário,
    // mas a senha é a senha administrativa antiga, entra como admin.
    // Isso evita travar o admin por causa da migração para usuário + senha.
    if (!auth.ok && password && password === getAdminSecret(context.env)) {
      auth = await authenticateUser(context.env, "admin", password);
    }

    if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status || 401);

    const cookie = await createSessionCookie(context.env, auth.user);
    return json({ ok: true, user: safeUser(auth.user) }, 200, { "Set-Cookie": cookie });
  } catch (error) {
    return json({ ok: false, error: String(error && error.message || error) }, 500);
  }
}
