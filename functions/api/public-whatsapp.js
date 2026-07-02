import { applyTokens, json, loadConfig } from "./_config.js";

export async function onRequestGet(context) {
  const { config } = await loadConfig(context.env);
  const whatsapp = config.content && config.content.whatsapp || {};
  return json({
    ok: true,
    whatsapp: {
      intro: whatsapp.intro || "",
      orderLine: whatsapp.orderLine || "Pedido: {pedido}",
      sellerLine: whatsapp.sellerLine || "",
      itemLine: whatsapp.itemLine || "",
      totalLine: whatsapp.totalLine || "",
      footer: whatsapp.footer || ""
    },
    example: {
      orderLine: applyTokens(whatsapp.orderLine || "Pedido: {pedido}", config, { pedido: "PED2600003A" })
    }
  });
}
