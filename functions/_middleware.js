import { loadConfig, getBolinhas } from "./api/_config.js";

function bolinhasRuleCode(bolinhas) {
  const product = JSON.stringify(bolinhas.productKey);
  const minQty = Number(bolinhas.minQty || 6);
  const step = Number(bolinhas.step || 2);
  const title = JSON.stringify(`${bolinhas.label || "Bolinhas"} ${bolinhas.productKey || "50x50"}`);
  return `function rule50(){const q=cart.filter(i=>i.product===${product}).reduce((s,i)=>s+i.qty,0);if(q===0)return null;if(q<${minQty}){const falta=${minQty}-q;return{type:"bad",title:${title},msg:"Faltam "+falta+" para fechar o mínimo de ${minQty}."}}if(q>${minQty}&&((q-${minQty})%${step})!==0){const next=q+(${step}-((q-${minQty})%${step}));return{type:"warn",title:${title},msg:"Adicione mais "+(next-q)+" bolinha"+((next-q)>1?"s":"")+" para fechar "+next+". Depois de ${minQty}, seguimos sempre em pares."};}return{type:"ok",title:${title},msg:q===${minQty}?"Mínimo fechado. Se quiser, acrescente de ${step} em ${step}.":"Quantidade certinha."}}\nfunction hasCustomizedItems()`;
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

function rewriteHtml(html, config) {
  const bolinhas = getBolinhas(config);
  const unitPrice = Number(bolinhas.unitPrice || 9.75);
  const basePrice = Number((unitPrice * Number(bolinhas.minQty || 6)).toFixed(2));
  const discountPercentRaw = config && config.ui ? config.ui.discountPercent : 10;
  const discountPercent = Number(discountPercentRaw == null ? 10 : discountPercentRaw);
  const discountFactor = Number((discountPercent / 100).toFixed(4));

  return html
    .replaceAll('R$ 9,90 cada', bolinhas.priceLabel)
    .replaceAll('R$ 9,90', bolinhas.priceLabel.replace(' cada', ''))
    .replaceAll('unitPrice:9.90,baseQty:6,basePrice:58.90,afterStep:2', `unitPrice:${unitPrice},baseQty:${bolinhas.minQty},basePrice:${basePrice},afterStep:${bolinhas.step},disableCustomization:${bolinhas.disableCustomization !== false}`)
    .replaceAll('if(key==="50x50")return "R$ 9,90 cada";', `if(key==="50x50")return ${JSON.stringify(bolinhas.priceLabel)};`)
    .replaceAll('if(item.product==="50x50")return "R$ 9,90 cada";', `if(item.product==="50x50")return ${JSON.stringify(bolinhas.priceLabel)};`)
    .replaceAll('if(product==="50x50")return qty>=6?58.90+Math.max(0,qty-6)*9.90:qty*9.90;', `if(product==="50x50")return qty*${unitPrice};`)
    .replace(/function rule50\(\)\{[\s\S]*?function hasCustomizedItems\(\)/, bolinhasRuleCode(bolinhas))
    .replace(/const SELLERS=\{[\s\S]*?\};\nfunction getLockedSellerFromUrl/, sellersCode(config))
    .replace('function discount(){return gross()*0.10}', `function discount(){return gross()*${discountFactor}}`)
    .replaceAll('10% OFF por aqui', `${discountPercent}% OFF por aqui`)
    .replaceAll('10% de desconto', `${discountPercent}% de desconto`)
    .replaceAll('desconto de 10%', `desconto de ${discountPercent}%`)
    .replaceAll('com 10% de desconto', `com ${discountPercent}% de desconto`)
    .replaceAll('Enviar pedido com 10% OFF', `Enviar pedido com ${discountPercent}% OFF`)
    .replaceAll('Desconto por aqui 10%', `Desconto por aqui ${discountPercent}%`)
    .replace('if(cfg.type==="bag")return `<button type="button" class="bagSizeMiniBtn" data-edit-size="${esc(i.id)}">Trocar tamanho</button>`;\n   return `<button type="button" class="iconMeasureBtn" data-customize="${esc(i.id)}" aria-label="Personalizar medidas" title="Personalizar medidas">Personalizar tamanho</button>`;', 'if(i.product==="50x50")return "";\n   if(cfg.type==="bag")return `<button type="button" class="bagSizeMiniBtn" data-edit-size="${esc(i.id)}">Trocar tamanho</button>`;\n   return `<button type="button" class="iconMeasureBtn" data-customize="${esc(i.id)}" aria-label="Personalizar medidas" title="Personalizar medidas">Personalizar tamanho</button>`;')
    .replace('if(cfg.type==="bag")return bagFields(item);\n   if(!item.details.customizing){', 'if(item.product==="50x50")return "";\n   if(cfg.type==="bag")return bagFields(item);\n   if(!item.details.customizing){')
    .replace('if(view==="products" || view==="bagSizes" || view==="items"){\n     add("Produtos",()=>showProducts(),"products");\n   }', 'if((view==="products" || view==="bagSizes" || view==="items") && !(view==="items" && selectedProduct && selectedProduct.__directBolinhas)){\n     add("Produtos",()=>showProducts(),"products");\n   }')
    .replace('if(view==="items" && selectedProduct){\n     const productName = selectedProduct.product==="sacolinha" && selectedProduct.bagSize', 'if(view==="items" && selectedProduct && !selectedProduct.__directBolinhas){\n     const productName = selectedProduct.product==="sacolinha" && selectedProduct.bagSize')
    .replace('products=d.folders||[];showProducts()', 'products=d.folders||[];const onlyDirectBolinhas=products.length===1&&products[0].product==="50x50"&&products[0].kind!=="folder";if(onlyDirectBolinhas){await loadItems({...products[0],id:folder.id,name:"Bolinhas",rawName:"Bolinhas",product:"50x50",productName:"Bolinhas",__directBolinhas:true});return}showProducts()');
}

const STYLE_PATCH = `
<style id="bolinhas-drive-patch-style">
  #breadcrumbs,
  .breadcrumbs{
    min-width:0!important;
    align-items:center!important;
  }
  #breadcrumbs .pathPill,
  .breadcrumbs .pathPill,
  .pathLine .pathChip{
    max-width:min(46vw,360px)!important;
    min-width:0!important;
    width:auto!important;
    height:auto!important;
    min-height:38px!important;
    white-space:normal!important;
    overflow:visible!important;
    text-overflow:clip!important;
    overflow-wrap:anywhere!important;
    word-break:break-word!important;
    line-height:1.12!important;
    padding:8px 12px!important;
  }
  .iconMeasureBtn[data-customize]{display:none!important;}
  @media(max-width:560px){
    #breadcrumbs .pathPill,
    .breadcrumbs .pathPill,
    .pathLine .pathChip{
      max-width:72vw!important;
      min-width:auto!important;
      white-space:normal!important;
    }
  }
</style>`;

const CONFIRM_MODAL_SCRIPT = '<script src="/assets/confirm-modal.js?v=1" defer></script>';

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const url = new URL(context.request.url);
  if (url.pathname === "/adm" || url.pathname.startsWith("/adm/")) {
    return response;
  }

  const { config } = await loadConfig(context.env);
  let html = await response.text();
  html = rewriteHtml(html, config);
  if (!html.includes("bolinhas-drive-patch-style")) html = html.replace("</head>", `${STYLE_PATCH}</head>`);
  if (config.ui.confirmModal !== false && !html.includes("/assets/confirm-modal.js")) html = html.replace("</body>", `${CONFIRM_MODAL_SCRIPT}</body>`);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store, max-age=0");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
