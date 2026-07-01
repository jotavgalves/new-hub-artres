import { json, loadConfig } from "./_config.js";

export async function onRequestGet(context) {
  const loaded = await loadConfig(context.env);
  return json({ ok: true, ...loaded });
}
