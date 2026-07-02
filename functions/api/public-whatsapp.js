import { applyTokens, json, loadConfig } from "./_config.js";

const REAL_DEFAULT = {
  intro: "Oi, {vendedora}! Separei minhas artes por aqui e quero finalizar minha seleção.",
  orderLine: "Pedido: {pedido}",
  sellerLine: "Minha seleção:",
  itemLine: "• Arte #{codigo}{quantidadeTexto}",
  totalLine: "Observação: há medida personalizada nesta seleção.",
  footer: "Pode conferir para mim e me ajudar a finalizar?"
};

export async function onRequestGet(context) {
  const { config } = await loadConfig(context.env);
  const raw = config.content && config.content.whatsapp || {};
  const whatsapp = realWhatsapp(raw);
  return json({
    ok: true,
    whatsapp,
    example: {
      orderLine: applyTokens(whatsapp.orderLine, config, { pedido: "PED2600003A" })
    }
  });
}

function realWhatsapp(raw = {}) {
  const intro = String(raw.intro || "").trim();
  const totalLine = String(raw.totalLine || "").trim();
  return {
    intro: !intro || /desconto/i.test(intro) ? REAL_DEFAULT.intro : intro,
    orderLine: raw.orderLine || REAL_DEFAULT.orderLine,
    sellerLine: raw.sellerLine && !/vendedora/i.test(raw.sellerLine) ? raw.sellerLine : REAL_DEFAULT.sellerLine,
    itemLine: raw.itemLine && !/tema/i.test(raw.itemLine) ? raw.itemLine : REAL_DEFAULT.itemLine,
    totalLine: !totalLine || /total com desconto/i.test(totalLine) ? REAL_DEFAULT.totalLine : totalLine,
    footer: raw.footer && !/catálogo online/i.test(raw.footer) ? raw.footer : REAL_DEFAULT.footer
  };
}
