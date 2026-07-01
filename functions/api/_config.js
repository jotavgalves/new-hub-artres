export const CONFIG_KEY = "APP_CONFIG";

export const DEFAULT_CONFIG = {
  version: 2,
  sellers: [
    { id: "ana", label: "Ana", phone: "5581996763982", active: true },
    { id: "dayane", label: "Dayane", phone: "5581983383002", active: true }
  ],
  products: {
    bolinhas: {
      label: "Bolinhas",
      productKey: "50x50",
      unitPrice: 9.75,
      priceLabel: "R$ 9,75 cada",
      minQty: 6,
      step: 2,
      disableCustomization: true,
      skipProductsStep: true
    }
  },
  drives: [
    {
      id: "bolinhas",
      name: "Drive Bolinhas",
      folderId: "193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae",
      active: true,
      type: "bolinhas",
      productKey: "50x50",
      structure: "theme-or-subtheme-images",
      filenamePattern: "ID_TEMA_PRODUTO_DIMENSAO"
    }
  ],
  ui: {
    discountPercent: 10,
    confirmModal: true
  },
  content: {
    hero: {
      eyebrow: "ESCOLHA SUAS ARTES",
      title: "Vamos montar sua festa?",
      subtitle: "Escolha o tema, veja os produtos disponíveis e selecione as artes que mais combinam com a sua comemoração. Escolhendo por aqui, seu pedido já sai com {desconto}% de desconto no atendimento pelo WhatsApp."
    },
    steps: [
      { title: "1. Escolha o tema", text: "Comece pelo universo da festa." },
      { title: "2. Escolha o produto", text: "Veja só as opções disponíveis naquele tema." },
      { title: "3. Selecione as artes", text: "Toque para ampliar, favoritar ou adicionar." },
      { title: "4. Envie pronto", text: "A vendedora recebe tudo organizado." }
    ],
    promo: {
      pill: "{desconto}% OFF POR AQUI",
      title: "Escolha suas artes com calma e já envie com desconto",
      text: "Montando sua seleção por aqui, o desconto de {desconto}% é aplicado automaticamente no orçamento. Você chega no WhatsApp com tudo organizado para a vendedora confirmar."
    },
    catalog: {
      title: "Escolha suas artes",
      caption: "Toque na arte para ver melhor. O valor aparece em cada item e o desconto entra no carrinho.",
      searchPlaceholder: "Buscar pelo código da arte...",
      addButton: "Adicionar arte",
      addedButton: "No carrinho: {quantidade} unidade(s)",
      addUnit: "Adicionar 1 unidade",
      removeUnit: "Tirar 1 unidade",
      favorites: "Ver favoritas",
      addFavorites: "Adicionar favoritas"
    },
    cart: {
      title: "Seu orçamento",
      sellerTitle: "Escolha sua vendedora",
      sellerHint: "Selecione para quem você quer enviar sua seleção no WhatsApp.",
      savingsBadge: "{desconto}% OFF POR AQUI",
      savingsTitle: "Você economiza {valor}",
      savingsText: "O desconto já entra automaticamente no total antes de enviar para a vendedora. Quanto mais você escolhe por aqui, mais fácil fica finalizar seu pedido.",
      chooseSellerWarning: "Escolha para quem você quer enviar sua seleção antes de finalizar.",
      sendButton: "Enviar pedido com {desconto}% OFF",
      emptyCart: "Seu carrinho ainda está vazio."
    },
    validation: {
      minQty: "Faltam {quantidade} para fechar o mínimo de {minimo}.",
      stepQty: "Adicione mais {quantidade} bolinha{plural} para fechar {proxima}. Depois de {minimo}, seguimos sempre em pares.",
      minOk: "Mínimo fechado. Se quiser, acrescente de {passo} em {passo}.",
      qtyOk: "Quantidade certinha."
    },
    modal: {
      title: "Confira suas artes antes de enviar",
      subtitle: "Dê uma última olhada nas imagens escolhidas. Toque em qualquer arte para ampliar.",
      countText: "Você selecionou {quantidade} arte(s).",
      backButton: "Voltar e ajustar",
      confirmButton: "Confirmar e enviar",
      previousButton: "Anterior",
      nextButton: "Próxima",
      closeButton: "Fechar"
    },
    whatsapp: {
      intro: "Olá, gostaria de fazer esse pedido com {desconto}% de desconto:",
      sellerLine: "Vendedora: {vendedora}",
      itemLine: "• Código #{codigo} — {tema} — {quantidade} unidade(s)",
      totalLine: "Total com desconto: {total}",
      footer: "Pedido enviado pelo catálogo online."
    },
    admin: {
      title: "Admin do Hub de Artes",
      subtitle: "Controle textos, vendedoras, preços, regras e Drives sem mexer no código.",
      loginTitle: "Painel administrativo",
      loginSubtitle: "Entre com sua senha administrativa.",
      passwordPlaceholder: "Digite sua senha"
    }
  },
  appearance: {
    adminTheme: "clean",
    primaryColor: "#ef5585",
    accentColor: "#38bae3",
    background: "soft"
  }
};

export function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

export function moneyBR(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function normalizeConfig(input = {}) {
  const merged = structuredClone(DEFAULT_CONFIG);
  const src = input && typeof input === "object" ? input : {};

  const sellers = Array.isArray(src.sellers) ? src.sellers : merged.sellers;
  merged.sellers = sellers
    .map((seller, index) => ({
      id: sanitizeId(seller.id || seller.label || `vendedora-${index + 1}`),
      label: cleanText(seller.label || seller.name || `Vendedora ${index + 1}`),
      phone: String(seller.phone || "").replace(/\D/g, ""),
      active: seller.active !== false
    }))
    .filter(seller => seller.id && seller.label && seller.phone);

  if (!merged.sellers.length) merged.sellers = structuredClone(DEFAULT_CONFIG.sellers);

  const bolinhasInput = src.products && src.products.bolinhas ? src.products.bolinhas : {};
  const unitPrice = Number(String(valueOr(bolinhasInput.unitPrice, merged.products.bolinhas.unitPrice)).replace(",", "."));
  const minQty = parseInt(valueOr(bolinhasInput.minQty, merged.products.bolinhas.minQty), 10);
  const step = parseInt(valueOr(bolinhasInput.step, merged.products.bolinhas.step), 10);
  const label = cleanText(bolinhasInput.label || merged.products.bolinhas.label);
  const productKey = cleanText(bolinhasInput.productKey || merged.products.bolinhas.productKey);

  merged.products.bolinhas = {
    label: label || "Bolinhas",
    productKey: productKey || "50x50",
    unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : DEFAULT_CONFIG.products.bolinhas.unitPrice,
    priceLabel: moneyBR(Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : DEFAULT_CONFIG.products.bolinhas.unitPrice) + " cada",
    minQty: Number.isFinite(minQty) && minQty > 0 ? minQty : DEFAULT_CONFIG.products.bolinhas.minQty,
    step: Number.isFinite(step) && step > 0 ? step : DEFAULT_CONFIG.products.bolinhas.step,
    disableCustomization: bolinhasInput.disableCustomization !== false,
    skipProductsStep: bolinhasInput.skipProductsStep !== false
  };

  const drives = Array.isArray(src.drives) ? src.drives : merged.drives;
  merged.drives = drives
    .map((drive, index) => ({
      id: sanitizeId(drive.id || drive.name || `drive-${index + 1}`),
      name: cleanText(drive.name || `Drive ${index + 1}`),
      folderId: sanitizeDriveId(drive.folderId || drive.idDaPasta || ""),
      active: drive.active !== false,
      type: cleanText(drive.type || "bolinhas"),
      productKey: cleanText(drive.productKey || merged.products.bolinhas.productKey),
      structure: cleanText(drive.structure || "theme-or-subtheme-images"),
      filenamePattern: cleanText(drive.filenamePattern || "ID_TEMA_PRODUTO_DIMENSAO")
    }))
    .filter(drive => drive.id && drive.name && drive.folderId);

  if (!merged.drives.length) merged.drives = structuredClone(DEFAULT_CONFIG.drives);

  const ui = src.ui && typeof src.ui === "object" ? src.ui : {};
  const discountPercent = Number(String(valueOr(ui.discountPercent, merged.ui.discountPercent)).replace(",", "."));
  merged.ui = {
    discountPercent: Number.isFinite(discountPercent) && discountPercent >= 0 ? discountPercent : DEFAULT_CONFIG.ui.discountPercent,
    confirmModal: ui.confirmModal !== false
  };

  merged.content = normalizeContent(src.content || {});
  merged.appearance = {
    ...DEFAULT_CONFIG.appearance,
    ...(src.appearance && typeof src.appearance === "object" ? src.appearance : {})
  };

  merged.version = 2;
  return merged;
}

export async function loadConfig(env) {
  const fallback = normalizeConfig(DEFAULT_CONFIG);
  if (!env || !env.CONFIG_KV) {
    return { config: fallback, source: "default", storageReady: false };
  }

  const raw = await env.CONFIG_KV.get(CONFIG_KEY);
  if (!raw) {
    await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(fallback, null, 2));
    return { config: fallback, source: "default-created", storageReady: true };
  }

  try {
    return { config: normalizeConfig(JSON.parse(raw)), source: "kv", storageReady: true };
  } catch (error) {
    return { config: fallback, source: "default-invalid-kv", storageReady: true, warning: "CONFIG_KV_INVALIDO" };
  }
}

export async function saveConfig(env, config) {
  if (!env || !env.CONFIG_KV) {
    throw new Error("CONFIG_KV_NAO_CONFIGURADO");
  }
  const normalized = normalizeConfig(config);
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function getActiveDrive(config, preferredType = "bolinhas") {
  const drives = Array.isArray(config.drives) ? config.drives : [];
  return drives.find(d => d.active && d.type === preferredType) || drives.find(d => d.active) || DEFAULT_CONFIG.drives[0];
}

export function getBolinhas(config) {
  return normalizeConfig(config).products.bolinhas;
}

export function getContent(config) {
  return normalizeConfig(config).content;
}

export function applyTokens(value, config = {}) {
  const normalized = normalizeConfig(config);
  const bolinhas = normalized.products.bolinhas;
  const tokens = {
    desconto: normalized.ui.discountPercent,
    produto: bolinhas.label,
    preco: bolinhas.priceLabel,
    minimo: bolinhas.minQty,
    passo: bolinhas.step
  };
  return String(value || "").replace(/\{(desconto|produto|preco|minimo|passo)\}/g, (_, key) => String(tokens[key] || ""));
}

function normalizeContent(content) {
  const base = structuredClone(DEFAULT_CONFIG.content);
  const src = content && typeof content === "object" ? content : {};
  mergeTextObject(base.hero, src.hero);
  mergeTextObject(base.promo, src.promo);
  mergeTextObject(base.catalog, src.catalog);
  mergeTextObject(base.cart, src.cart);
  mergeTextObject(base.validation, src.validation);
  mergeTextObject(base.modal, src.modal);
  mergeTextObject(base.whatsapp, src.whatsapp);
  mergeTextObject(base.admin, src.admin);

  if (Array.isArray(src.steps)) {
    base.steps = [0, 1, 2, 3].map(index => ({
      title: cleanText(src.steps[index] && src.steps[index].title || base.steps[index].title),
      text: cleanText(src.steps[index] && src.steps[index].text || base.steps[index].text)
    }));
  }
  return base;
}

function mergeTextObject(target, source) {
  if (!source || typeof source !== "object") return;
  Object.keys(target).forEach(key => {
    if (typeof source[key] === "string" && source[key].trim()) target[key] = cleanText(source[key]);
  });
}

function valueOr(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeId(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function sanitizeDriveId(value) {
  const direct = cleanText(value);
  const folderMatch = direct.match(/folders\/([A-Za-z0-9_-]+)/);
  const id = folderMatch ? folderMatch[1] : direct;
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : "";
}
