const BOLINHAS_CONFIG = {
  label: "Bolinhas",
  product: "50x50",
  unitPrice: 9.75,
  priceLabel: "R$ 9,75 cada",
  minQty: 6,
  step: 2,
  disableCustomization: true,
  skipProductsStep: true
};

function bolinhasRuleCode() {
  return 'function rule50(){const q=cart.filter(i=>i.product==="50x50").reduce((s,i)=>s+i.qty,0);if(q===0)return null;if(q<6){const falta=6-q;return{type:"bad",title:"Bolinhas 50x50",msg:"Faltam "+falta+" para fechar o mínimo de 6."}}if(q>6&&q%2!==0)return{type:"warn",title:"Bolinhas 50x50",msg:"Adicione mais 1 bolinha para fechar "+(q+1)+". Depois de 6, seguimos sempre em pares."};return{type:"ok",title:"Bolinhas 50x50",msg:q===6?"Mínimo fechado. Se quiser, acrescente de 2 em 2.":"Quantidade certinha em par."}}\nfunction hasCustomizedItems()';
}

function rewriteHtml(html) {
  return html
    .replaceAll('R$ 9,90 cada', BOLINHAS_CONFIG.priceLabel)
    .replaceAll('R$ 9,90', 'R$ 9,75')
    .replaceAll('unitPrice:9.90,baseQty:6,basePrice:58.90,afterStep:2', 'unitPrice:9.75,baseQty:6,basePrice:58.50,afterStep:2,disableCustomization:true')
    .replaceAll('if(product==="50x50")return qty>=6?58.90+Math.max(0,qty-6)*9.90:qty*9.90;', 'if(product==="50x50")return qty*9.75;')
    .replace(/function rule50\(\)\{[\s\S]*?function hasCustomizedItems\(\)/, bolinhasRuleCode())
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

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  html = rewriteHtml(html);
  if (!html.includes("bolinhas-drive-patch-style")) html = html.replace("</head>", `${STYLE_PATCH}</head>`);

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store, max-age=0");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
