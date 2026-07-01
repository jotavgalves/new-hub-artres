import { json } from "../_config.js";
import { clearSessionCookie } from "./_auth.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}
