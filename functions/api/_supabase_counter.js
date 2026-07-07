import { supabaseReady, supabaseRequest } from "./_supabase.js";

export async function nextOrderNumberFromSupabase(env, createdAt) {
  if (!supabaseReady(env)) return "";
  const value = await supabaseRequest(env, "/rpc/next_order_number", {
    method: "POST",
    body: { p_created_at: createdAt || new Date().toISOString() }
  });
  return String(value || "").trim();
}
