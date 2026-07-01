import { loadConfig, getBolinhas, getContent, applyTokens } from "./api/_config.js";

function bolinhasRuleCode(bolinhas, content) {
  const product = JSON.stringify(bolinhas.productKey);
  const minQty = Number(bolinhas.minQty || 6);
  const step = Number(bolinhas.step || 2);
  const title = JSON.stringify(`${bolinhas.label || "Bolinhas"} ${bolinhas.productKey || "50x50"}`);
  const v = content.validation || {};
  const minTpl = JSON.stringify(v.minQty || "Faltam {quantidade} para fechar o mínimo de {minimo}.");
  const stepTpl = JSON.stringify(v.stepQty || "Adicione mais {quantidade} bolinha{plural} para fechar {proxima}. Depois de {minimo}, seguimos sempre em pares.");
  const minOkTpl = JSON.stringify(v.minOk || "Mínimo fechado. Se quiser, acrescente de {passo} em {passo}.");
  const okTpl = JSON.stringify(v.qtyOk || "Quantidade certinha.");
  return `function rule50(){function fmt(t,m){return String(t||"").replace(/\\{(quantidade|plural|proxima|minimo|passo)\\}/g,function(_,k){return m[k]!==undefined?m[k]:""})}const q=cart.filter(i=>i.product===${product}).reduce((s,i)=>s+i.qty,0);if(q===0)return null;if(q<${minQty}){const falta=${minQty}-q;return{type:"bad",title:${title},msg:fmt(${minTpl},{quantidade:falta,minimo:${minQty},passo:${step},plural:falta>1?"s":""})}}if(q>${minQty}&&((q-${minQty})%${step})!==0){const add=${step}-((q-${minQty})%${step});const next=q+add;return{type:"warn",title:${title},msg:fmt(${stepTpl},{quantidade:add,plural:add>1?"s":"",proxima:next,minimo:${minQty},passo:${step}})}}return{type:"ok",title:${title},msg:q===${minQty}?fmt(${minOkTpl},{minimo:${minQty},passo:${step}}):fmt(${okTpl},{minimo:${minQty},passo:${step}})}}\nfunction hasCustomizedItems()`;
}

function sellersCode(config) {
  const active = (Array.isArray(config.sellers) ? config.sellers : [])
    .filter(s => s.active !== false && s.id && s.label && s.phone)
    .reduce((obj, s) => {
      obj[s.id] = { label: s.label, phone: String(s.phone).replace(/\D/g, "") };
      return obj;
    }, {});
  if (!Object.keys(active).length) active.ana = { label: "Ana", phone: "5581996763982" };
  return `const SELLERS=${JSON.stringify(active)};\nfunction getLockedSellerFromUrl`;
}

function replaceContent(html, config) {
  const content = getContent(config);
  const tx = value => applyTokens(value, config);
  let out = html;
  const replacements = [
    ["ESCOLHA SUAS ARTES", tx(content.hero.eyebrow)],
    ["Vamos montar sua festa?", tx(content.hero.title)],
    ["Escolha o tema, veja os produtos disponíveis e selecione as artes que mais combinam com a sua comemoração. Escolhendo por aqui, seu pedido já sai com 10% de desconto no atendimento pelo WhatsApp.", tx(content.hero.subtitle)],
    ["1. Escolha o tema", tx(content.steps[0].title)],
    ["Comece pelo universo da festa.", tx(content.steps[0].text)],
    ["2. Escolha o produto", tx(content.steps[1].title)],
    ["Veja só as opções disponíveis naquele tema.", tx(content.steps[1].text)],
    ["3. Selecione as artes", tx(content.steps[2].title)],
    ["Toque para ampliar, favoritar ou adicionar.", tx(content.steps[2].text)],
    ["4. Envie pronto", tx(content.steps[3].title)],
    ["A vendedora recebe tudo organizado.", tx(content.steps[3].text)],
    ["10% OFF POR AQUI", tx(content.promo.pill)],
    ["Escolha suas artes com calma e já envie com desconto", tx(content.promo.title)],
    ["Montando sua seleção por aqui, o desconto de 10% é aplicado automaticamente no orçamento. Você chega no WhatsApp com tudo organizado para a vendedora confirmar.", tx(content.promo.text)],
    ["Escolha suas artes", tx(content.catalog.title)],
    ["Toque na arte para ver melhor. O valor aparece em cada item e o desconto entra no carrinho.", tx(content.catalog.caption)],
    ["Buscar pelo código da arte...", tx(content.catalog.searchPlaceholder)],
    ["Adicionar arte", tx(content.catalog.addButton)],
    ["Adicionar 1 unidade", tx(content.catalog.addUnit)],
    ["Tirar 1 unidade", tx(content.catalog.removeUnit)],
    ["Ver favoritas", tx(content.catalog.favorites)],
    ["Adicionar favoritas", tx(content.catalog.addFavorites)],
    ["Seu orçamento", tx(content.cart.title)],
    ["ESCOLHA SUA VENDEDORA", tx(content.cart.sellerTitle).toUpperCase()],
    ["Selecione para quem você quer enviar sua seleção no WhatsApp.", tx(content.cart.sellerHint)],
    ["Escolha para quem você quer enviar sua seleção antes de finalizar.", tx(content.cart.chooseSellerWarning)],
    ["Enviar pedido com 10% OFF", tx(content.cart.sendButton)],
    ["Seu carrinho ainda está vazio.", tx(content.cart.emptyCart)]
  ];
  for (const [from, to] of replacements) if (from && to && from !== to) out = out.replaceAll(from, to);
  return out;
}

function rewriteHtml(html, config) {
  const bolinhas = getBolinhas(config);
  const content = getContent(config);
  const unitPrice = Number(bolinhas.unitPrice || 9.75);
  const basePrice = Number((unitPrice * Number(bolinhas.minQty || 6)).toFixed(2));
  const discountPercentRaw = config && config.ui ? config.ui.discountPercent : 10;
  const discountPercent = Number(discountPercentRaw == null ? 10 : discountPercentRaw);
  const discountFactor = Number((discountPercent / 100).toFixed(4));
  return replaceContent(html, config)
    .replaceAll('R$ 9,90 cada', bolinhas.priceLabel)
    .replaceAll('R$ 9,90', bolinhas.priceLabel.replace(' cada', ''))
    .replaceAll('unitPrice:9.90,baseQty:6,basePrice:58.90,afterStep:2', `unitPrice:${unitPrice},baseQty:${bolinhas.minQty},basePrice:${basePrice},afterStep:${bolinhas.step},disableCustomization:${bolinhas.disableCustomization !== false}`)
    .replaceAll('if(key==="50x50")return "R$ 9,90 cada";', `if(key==="50x50")return ${JSON.stringify(bolinhas.priceLabel)};`)
    .replaceAll('if(item.product==="50x50")return "R$ 9,90 cada";', `if(item.product==="50x50")return ${JSON.stringify(bolinhas.priceLabel)};`)
    .replaceAll('if(product==="50x50")return qty>=6?58.90+Math.max(0,qty-6)*9.90:qty*9.90;', `if(product==="50x50")return qty*${unitPrice};`)
    .replace(/function rule50\(\)\{[\s\S]*?function hasCustomizedItems\(\)/, bolinhasRuleCode(bolinhas, content))
    .replace(/const SELLERS=\{[\s\S]*?\};\nfunction getLockedSellerFromUrl/, sellersCode(config))
    .replace('function discount(){return gross()*0.10}', `function discount(){return gross()*${discountFactor}}`)
    .replaceAll('10% OFF por aqui', `${discountPercent}% OFF por aqui`)
    .replaceAll('10% de desconto', `${discountPercent}% de desconto`)
    .replaceAll('desconto de 10%', `desconto de ${discountPercent}%`)
    .replaceAll('com 10% de desconto', `com ${discountPercent}% de desconto`)
    .replaceAll('Desconto por aqui 10%', `Desconto por aqui ${discountPercent}%`)
    .replace('if(cfg.type==="bag")return `<button type="button" class="bagSizeMiniBtn" data-edit-size="${esc(i.id)}">Trocar tamanho</button>`;\n   return `<button type="button" class="iconMeasureBtn" data-customize="${esc(i.id)}" aria-label="Personalizar medidas" title="Personalizar medidas">Personalizar tamanho</button>`;', 'if(i.product==="50x50")return "";\n   if(cfg.type==="bag")return `<button type="button" class="bagSizeMiniBtn" data-edit-size="${esc(i.id)}">Trocar tamanho</button>`;\n   return `<button type="button" class="iconMeasureBtn" data-customize="${esc(i.id)}" aria-label="Personalizar medidas" title="Personalizar medidas">Personalizar tamanho</button>`;')
    .replace('if(cfg.type==="bag")return bagFields(item);\n   if(!item.details.customizing){', 'if(item.product==="50x50")return "";\n   if(cfg.type==="bag")return bagFields(item);\n   if(!item.details.customizing){')
    .replace('if(view==="products" || view==="bagSizes" || view==="items"){\n     add("Produtos",()=>showProducts(),"products");\n   }', 'if((view==="products" || view==="bagSizes" || view==="items") && !(view==="items" && selectedProduct && selectedProduct.__directBolinhas)){\n     add("Produtos",()=>showProducts(),"products");\n   }')
    .replace('if(view==="items" && selectedProduct){\n     const productName = selectedProduct.product==="sacolinha" && selectedProduct.bagSize', 'if(view==="items" && selectedProduct && !selectedProduct.__directBolinhas){\n     const productName = selectedProduct.product==="sacolinha" && selectedProduct.bagSize')
    .replace('products=d.folders||[];showProducts()', 'products=d.folders||[];const onlyDirectBolinhas=products.length===1&&products[0].product==="50x50"&&products[0].kind!=="folder";if(onlyDirectBolinhas){await loadItems({...products[0],id:folder.id,name:"Bolinhas",rawName:"Bolinhas",product:"50x50",productName:"Bolinhas",__directBolinhas:true});return}showProducts()');
}

const STYLE_PATCH = `<style id="bolinhas-drive-patch-style">#breadcrumbs,.breadcrumbs{min-width:0!important;align-items:center!important}#breadcrumbs .pathPill,.breadcrumbs .pathPill,.pathLine .pathChip{max-width:min(46vw,360px)!important;min-width:0!important;width:auto!important;height:auto!important;min-height:38px!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere!important;word-break:break-word!important;line-height:1.12!important;padding:8px 12px!important}.iconMeasureBtn[data-customize]{display:none!important}.campaignNotice{margin:0 auto 14px;width:min(100%,1280px);border-radius:20px;padding:13px 16px;background:#fff1f6;color:#b61f55;border:1px solid #ffd6e5;font-weight:900;box-shadow:0 14px 30px rgba(239,85,133,.10)}@media(max-width:560px){#breadcrumbs .pathPill,.breadcrumbs .pathPill,.pathLine .pathChip{max-width:72vw!important;min-width:auto!important;white-space:normal!important}}</style>`;
const CONFIRM_MODAL_SCRIPT = '<script src="/assets/confirm-modal.js?v=2" defer></script>';
const ORDER_CAPTURE_SCRIPT = '<script src="/assets/order-capture.js?v=1" defer></script>';

function escapeHtml(value){return String(value||"").replace(/[&<>'"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[m]));}
function maintenanceResponse(config){const m=config.maintenance||{};const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(m.title||"Manutenção")}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Arial,sans-serif;background:#fffaf6;color:#222}.box{width:min(520px,92vw);background:#fff;border-radius:28px;padding:30px;box-shadow:0 24px 70px rgba(31,27,35,.12);text-align:center}h1{margin:0 0 10px;font-size:30px}p{color:#6f6872;line-height:1.55}</style></head><body><main class="box"><h1>${escapeHtml(m.title||"Estamos atualizando o catálogo")}</h1><p>${escapeHtml(m.text||"Volte em instantes.")}</p></main></body></html>`;return new Response(html,{status:503,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}})}
function injectCampaign(html, config){const c=config.campaign||{};if(!c.noticeActive||!c.noticeText)return html;const notice=`<div class="campaignNotice">${escapeHtml(applyTokens(c.noticeText,config))}</div>`;return html.replace('<div class="app">', `<div class="app">${notice}`);}
function redirect(to){return Response.redirect(to,302)}
function sellerRedirect(url, config){const clean=url.pathname.replace(/^\/|\/$/g,"");if(!clean||clean.includes(".")||clean.includes("/"))return null;const sellers=Array.isArray(config.sellers)?config.sellers:[];const seller=sellers.find(s=>s.active!==false&&s.id===clean);if(!seller)return null;const target=new URL("/",url);target.search=`?${seller.id}`;return redirect(target.toString())}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname.startsWith("/api/")) return context.next();
  const { config } = await loadConfig(context.env);
  const routing = config.routing || {};
  const adminAlias = routing.adminAlias || "/adm";

  if (adminAlias && adminAlias !== "/adm" && (url.pathname === adminAlias || url.pathname.startsWith(adminAlias + "/"))) {
    return redirect(new URL("/adm", url).toString());
  }
  const sellerPathResponse = sellerRedirect(url, config);
  if (sellerPathResponse) return sellerPathResponse;

  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;
  if (url.pathname === "/adm" || url.pathname.startsWith("/adm/")) return response;
  if (config.maintenance && config.maintenance.active) return maintenanceResponse(config);

  let html = await response.text();
  html = rewriteHtml(html, config);
  html = injectCampaign(html, config);
  if (!html.includes("bolinhas-drive-patch-style")) html = html.replace("</head>", `${STYLE_PATCH}</head>`);
  if (config.ui.confirmModal !== false && !html.includes("/assets/confirm-modal.js")) html = html.replace("</body>", `${CONFIRM_MODAL_SCRIPT}</body>`);
  if (config.orderSettings && config.orderSettings.saveOrders !== false && !html.includes("/assets/order-capture.js")) html = html.replace("</body>", `${ORDER_CAPTURE_SCRIPT}</body>`);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store, max-age=0");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
