const BOLINHAS_CONFIG = {
  label: "Bolinhas",
  product: "50x50",
  unitPrice: 9.75,
  priceLabel: "R$ 9,75 cada",
  minQty: 1,
  step: 1,
  disableCustomization: true,
  skipProductsStep: true
};

const STYLE_PATCH = `
<style id="bolinhas-drive-patch-style">
  /* Evita que nomes grandes de temas/subtemas sejam comidos nas pílulas */
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

function patchScript(){
  const cfg = JSON.stringify(BOLINHAS_CONFIG);
  return `
<script id="bolinhas-drive-patch">
(function(){
  const BOLINHAS = ${cfg};
  window.ARMAZEM_BOLINHAS_CONFIG = BOLINHAS;

  const brl = value => Number(value || 0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });

  function isBolinhas(itemOrProduct){
    if(!itemOrProduct) return false;
    if(typeof itemOrProduct === "string") return itemOrProduct === BOLINHAS.product;
    return itemOrProduct.product === BOLINHAS.product || itemOrProduct.productName === BOLINHAS.label || itemOrProduct.label === BOLINHAS.label;
  }

  function patchGlobals(){
    try{
      if(typeof productConfig === "function" && !window.__bolinhasOriginalProductConfig){
        window.__bolinhasOriginalProductConfig = productConfig;
        productConfig = function(product){
          if(product === BOLINHAS.product){
            return { label:BOLINHAS.label, type:"bolinhas", unitPrice:BOLINHAS.unitPrice, minQty:BOLINHAS.minQty, step:BOLINHAS.step, disableCustomization:true };
          }
          return window.__bolinhasOriginalProductConfig(product);
        };
      }

      if(typeof priceTextFor === "function" && !window.__bolinhasOriginalPriceTextFor){
        window.__bolinhasOriginalPriceTextFor = priceTextFor;
        priceTextFor = function(p){
          if(isBolinhas(p)) return BOLINHAS.priceLabel;
          return window.__bolinhasOriginalPriceTextFor(p);
        };
      }

      if(typeof artPriceText === "function" && !window.__bolinhasOriginalArtPriceText){
        window.__bolinhasOriginalArtPriceText = artPriceText;
        artPriceText = function(item){
          if(isBolinhas(item)) return BOLINHAS.priceLabel;
          return window.__bolinhasOriginalArtPriceText(item);
        };
      }

      if(typeof price === "function" && !window.__bolinhasOriginalPrice){
        window.__bolinhasOriginalPrice = price;
        price = function(product, qty, item){
          if(product === BOLINHAS.product) return Number(qty || 0) * BOLINHAS.unitPrice;
          return window.__bolinhasOriginalPrice(product, qty, item);
        };
      }

      if(typeof rule50 === "function" && !window.__bolinhasOriginalRule50){
        window.__bolinhasOriginalRule50 = rule50;
        rule50 = function(){ return null; };
      }

      if(typeof ensureDetails === "function" && !window.__bolinhasOriginalEnsureDetails){
        window.__bolinhasOriginalEnsureDetails = ensureDetails;
        ensureDetails = function(item){
          if(isBolinhas(item)){
            if(!item.details) item.details = {};
            item.details.customizing = false;
            item.details.customized = false;
            item.details.unknown = false;
            return item.details;
          }
          return window.__bolinhasOriginalEnsureDetails(item);
        };
      }

      if(typeof itemActionButton === "function" && !window.__bolinhasOriginalItemActionButton){
        window.__bolinhasOriginalItemActionButton = itemActionButton;
        itemActionButton = function(item){
          if(isBolinhas(item)) return "";
          return window.__bolinhasOriginalItemActionButton(item);
        };
      }

      if(typeof measureFields === "function" && !window.__bolinhasOriginalMeasureFields){
        window.__bolinhasOriginalMeasureFields = measureFields;
        measureFields = function(item){
          if(isBolinhas(item)) return "";
          return window.__bolinhasOriginalMeasureFields(item);
        };
      }

      if(typeof hasCustomizedItems === "function" && !window.__bolinhasOriginalHasCustomizedItems){
        window.__bolinhasOriginalHasCustomizedItems = hasCustomizedItems;
        hasCustomizedItems = function(){
          return Array.isArray(cart) && cart.some(i => !isBolinhas(i) && productConfig(i.product).type !== "bag" && i.details && (i.details.customized || i.details.unknown));
        };
      }

      if(typeof renderCrumbs === "function" && !window.__bolinhasOriginalRenderCrumbs){
        window.__bolinhasOriginalRenderCrumbs = renderCrumbs;
        renderCrumbs = function(){
          const b = document.getElementById("breadcrumbs");
          if(!b) return;
          const directBolinhas = view === "items" && selectedProduct && selectedProduct.__directBolinhas;
          if(!directBolinhas) return window.__bolinhasOriginalRenderCrumbs();

          const pills=[];
          const sanitize=value=>String(value||"").replace(/[←‹❮›]/g,"").replace(/^Voltar para\s+/i,"").replace(/\s+/g," ").trim();
          const add=(label,fn)=>{ label=sanitize(label); if(label) pills.push({label,fn}); };

          add("Temas",()=>showThemes());
          if(selectedTheme) add(selectedTheme.name,()=>loadProducts(selectedTheme,"root"));
          if(Array.isArray(folderTrail) && folderTrail.length){
            folderTrail.forEach((folder,index)=>add(folder.name,()=>goToFolder(index)));
          }

          const currentIndex = pills.length - 1;
          b.innerHTML = pills.map((p,index)=>'<button type="button" class="pathPill '+(index===currentIndex?'current':'')+'" data-path-index="'+index+'">'+esc(p.label)+'</button>').join("");
          b.querySelectorAll("[data-path-index]").forEach(btn=>{
            const idx = Number(btn.dataset.pathIndex);
            btn.onclick = () => {
              if(idx === currentIndex) return;
              const pill = pills[idx];
              if(pill && typeof pill.fn === "function") pill.fn();
            };
          });
        };
      }

      if(typeof loadProducts === "function" && !window.__bolinhasOriginalLoadProducts){
        window.__bolinhasOriginalLoadProducts = loadProducts;
        loadProducts = async function(folder, navMode){
          await window.__bolinhasOriginalLoadProducts(folder, navMode);
          const onlyDirectBolinhas = Array.isArray(products) && products.length === 1 && isBolinhas(products[0]) && products[0].kind !== "folder";
          if(onlyDirectBolinhas && BOLINHAS.skipProductsStep){
            const p = Object.assign({}, products[0], {
              id: folder && folder.id ? folder.id : products[0].id,
              name: BOLINHAS.label,
              rawName: BOLINHAS.label,
              product: BOLINHAS.product,
              productName: BOLINHAS.label,
              __directBolinhas: true
            });
            await loadItems(p);
          }
        };
      }

      if(typeof smartBack === "function" && !window.__bolinhasOriginalSmartBack){
        window.__bolinhasOriginalSmartBack = smartBack;
        smartBack = function(){
          if(view === "items" && selectedProduct && selectedProduct.__directBolinhas){
            if(folderTrail && folderTrail.length){
              goToFolder(folderTrail.length - 2);
              return;
            }
            showThemes();
            return;
          }
          return window.__bolinhasOriginalSmartBack();
        };
      }

      if(typeof renderItems === "function" && Array.isArray(items)){
        items.forEach(i=>{
          if(isBolinhas(i)){
            i.productName = BOLINHAS.label;
            i.price = BOLINHAS.unitPrice;
            i.unitPrice = BOLINHAS.unitPrice;
            i.disableCustomization = true;
          }
        });
      }
    }catch(err){
      console.warn("Patch Bolinhas não aplicado completamente", err);
    }
  }

  patchGlobals();
  document.addEventListener("DOMContentLoaded", patchGlobals);
  setTimeout(patchGlobals, 0);
})();
</script>`;
}

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  if (!html.includes("bolinhas-drive-patch-style")) {
    html = html.replace("</head>", `${STYLE_PATCH}</head>`);
  }
  if (!html.includes("bolinhas-drive-patch")) {
    html = html.replace("</body>", `${patchScript()}</body>`);
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
