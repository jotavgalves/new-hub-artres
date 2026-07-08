import { json, loadConfig } from "./_config.js";

export async function onRequestGet(context) {
  const loaded = await loadConfig(context.env);
  return json({
    ok: true,
    public: true,
    config: publicConfig(loaded.config || {})
  });
}

function publicConfig(config) {
  return {
    version: config.version,
    sellers: publicSellers(config.sellers),
    products: config.products || {},
    productCatalog: Array.isArray(config.productCatalog) ? config.productCatalog : [],
    ui: config.ui || {},
    campaign: config.campaign || {},
    maintenance: config.maintenance || {},
    content: config.content || {},
    appearance: config.appearance || {}
  };
}

function publicSellers(sellers) {
  return (Array.isArray(sellers) ? sellers : [])
    .filter(seller => seller && seller.active !== false)
    .map(seller => ({
      id: String(seller.id || ""),
      label: String(seller.label || seller.name || ""),
      phone: String(seller.phone || "").replace(/\D/g, ""),
      active: true
    }))
    .filter(seller => seller.id && seller.label && seller.phone);
}
