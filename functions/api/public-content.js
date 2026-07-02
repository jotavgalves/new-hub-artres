import { json, loadConfig } from "./_config.js";

const REAL_DEFAULTS = {
  hero: {
    eyebrow: "Escolha suas artes",
    title: "Vamos montar sua festa?",
    subtitle: "Escolha o tema, veja os produtos disponíveis e selecione as artes que mais combinam com a sua comemoração. Escolhendo por aqui, seu pedido já sai organizado no atendimento pelo WhatsApp."
  },
  steps: [
    { title: "1. Escolha o tema", text: "Comece pelo universo da festa." },
    { title: "2. Escolha o produto", text: "Veja só as opções disponíveis naquele tema." },
    { title: "3. Selecione as artes", text: "Toque para ampliar, favoritar ou adicionar." },
    { title: "4. Envie pronto", text: "A vendedora recebe tudo organizado." }
  ],
  promo: {
    pill: "Pedido organizado",
    title: "Escolha suas artes com calma",
    text: "Monte sua seleção por aqui e envie tudo organizado para a vendedora confirmar pelo WhatsApp."
  },
  catalog: {
    initialTitle: "Escolha um tema",
    initialCaption: "Escolha o tema da sua festa. Depois você vê as peças disponíveis e adiciona só as artes que mais gostar.",
    searchPlaceholder: "Buscar por código, tema ou peça...",
    favoritesButton: "Ver favoritas",
    addFavoritesButton: "Adicionar favoritas",
    previewText: "Gostou dessa arte? Adicione ao pedido ou marque como favorita para comparar depois.",
    addButton: "Adicionar arte",
    favoriteButton: "Favoritar",
    closeButton: "Fechar"
  },
  cart: {
    title: "Seu orçamento",
    sellerTitle: "Escolha sua vendedora",
    sellerHint: "Selecione para quem você quer enviar sua seleção no WhatsApp.",
    sendButton: "Enviar pedido",
    openCartButton: "Ver carrinho",
    emptyCart: "Seu carrinho ainda está vazio."
  }
};

export async function onRequestGet(context) {
  const { config } = await loadConfig(context.env);
  return json({ ok: true, content: realContent(config.content || {}) });
}

function realContent(raw = {}) {
  return {
    hero: cleanGroup(REAL_DEFAULTS.hero, raw.hero),
    steps: normalizeSteps(raw.steps),
    promo: cleanGroup(REAL_DEFAULTS.promo, raw.promo),
    catalog: cleanGroup(REAL_DEFAULTS.catalog, raw.catalog),
    cart: cleanGroup(REAL_DEFAULTS.cart, raw.cart)
  };
}
function cleanGroup(defaults, raw = {}) {
  const out = { ...defaults };
  Object.keys(out).forEach(key => {
    const value = String(raw && raw[key] || "").trim();
    if (value) out[key] = value;
  });
  out.hero = undefined;
  return out;
}
function normalizeSteps(steps) {
  const src = Array.isArray(steps) ? steps : [];
  return REAL_DEFAULTS.steps.map((base, i) => ({
    title: String(src[i] && src[i].title || base.title).trim() || base.title,
    text: String(src[i] && src[i].text || base.text).trim() || base.text
  }));
}
