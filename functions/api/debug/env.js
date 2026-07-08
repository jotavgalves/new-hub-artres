import { json } from "../_config.js";

const ENV_KEYS = [
  "CONFIG_KV",
  "ADMIN_SECRET_KEY",
  "ARTS_SUPABASE_URL",
  "ARTS_SUPABASE_SERVICE_KEY",
  "SUPABASE_ARTS_URL",
  "SUPABASE_ARTS_SERVICE_KEY",
  "ARTWORKS_SUPABASE_URL",
  "ARTWORKS_SUPABASE_SERVICE_KEY",
  "SUPABASE_REST_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_API_KEY",
  "ARMAZEM_DESKTOP_TOKEN"
];

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const host = url.hostname;

  if (host === "new-hub-artres.pages.dev") {
    return json({ ok: false, error: "DEBUG_ENDPOINT_DISABLED_IN_PRODUCTION" }, 404);
  }

  const env = context.env || {};
  const selectedArtsUrlAlias = firstPresent(env, [
    "ARTS_SUPABASE_URL",
    "SUPABASE_ARTS_URL",
    "ARTWORKS_SUPABASE_URL",
    "SUPABASE_REST_URL"
  ]);
  const selectedArtsKeyAlias = firstPresent(env, [
    "ARTS_SUPABASE_SERVICE_KEY",
    "SUPABASE_ARTS_SERVICE_KEY",
    "ARTWORKS_SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY"
  ]);

  return json({
    ok: true,
    host,
    note: "diagnostic_only_no_secret_values_returned",
    selectedArtsUrlAlias,
    selectedArtsKeyAlias,
    runtime: Object.fromEntries(ENV_KEYS.map(key => [key, describeBinding(env[key])]))
  });
}

function firstPresent(env, keys) {
  return keys.find(key => isPresent(env[key])) || null;
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function describeBinding(value) {
  if (value === null || value === undefined) return { present: false, type: "missing", length: 0 };
  if (typeof value === "string") return { present: value.trim().length > 0, type: "string", length: value.length };
  return { present: true, type: typeof value, length: null };
}
