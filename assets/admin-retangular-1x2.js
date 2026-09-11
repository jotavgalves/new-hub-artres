(function(){
  if(window.__ARMAZEM_ADMIN_RETANGULAR_1X2__==='2')return;
  window.__ARMAZEM_ADMIN_RETANGULAR_1X2__='2';

  var KEY='retangular-1x2';
  var ROOT='1r4BdVOZasdtlE16K7TKIVkHCfVSHLRML';
  var DEFAULT_LABEL='Painel Retangular 1x2';
  var state={config:null,loading:false,saving:false};

  function $(id){return document.getElementById(id)}
  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
  function num(v,fallback){var n=Number(String(v==null?'':v).replace(',','.'));return Number.isFinite(n)?n:fallback}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function clone(v){return JSON.parse(JSON.stringify(v&&typeof v==='object'?v:{}))}
  function active(){var view=$('productsView');return document.body.dataset.userRole!=='vendedora'&&(document.body.dataset.adminTab==='productsView'||!!(view&&!view.classList.contains('hidden')))}
  function api(url,opts){opts=opts||{};return fetch(url,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts}).then(async function(r){var text=await r.text();var data={};try{data=text?JSON.parse(text):{}}catch(e){throw new Error('Resposta inválida do servidor.')}if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||'Erro na solicitação.');return data})}
  function rawProduct(config){var products=config&&config.products&&typeof config.products==='object'?config.products:{};var p=products.retangular1x2||products[KEY]||{};var price=Math.max(0,num(p.unitPrice,0));var label=clean(p.label||DEFAULT_LABEL);if(label==='Retangular 1x2')label=DEFAULT_LABEL;return{label:label||DEFAULT_LABEL,unitPrice:price,enabled:p.enabled===true||(p.enabled!==false&&price>0)}}
  function status(msg,tone){var el=$('retangular1x2AdminStatus');if(!el)return;el.textContent=msg||'';el.dataset.tone=tone||''}

  function render(){
    if(!active())return false;
    var host=document.querySelector('#productsV2Form .pv2Cards')||document.querySelector('#productsPanel .pv2Cards')||$('productsPanel');if(!host)return false;if($('retangular1x2ProductCard'))return true;
    var p=rawProduct(state.config||{});var checked=p.enabled||p.unitPrice<=0;var card=document.createElement('article');card.id='retangular1x2ProductCard';card.className='pv2Card retangular1x2ProductCard';card.dataset.product=KEY;
    card.innerHTML='<div class="pv2Head"><div class="pv2Title"><i>▯</i><div><h3>'+esc(p.label)+'</h3><small>'+KEY+'</small></div></div><label class="pv2Enabled"><input id="retangular1x2Enabled" type="checkbox" '+(checked?'checked':'')+'> Disponível</label></div>'+ 
      '<div class="retangularOrigin"><b>ORIGEM PROTEGIDA</b><code>'+ROOT+'</code><span>As artes vêm exclusivamente da pasta do Painel Retangular informada.</span></div>'+ 
      '<div class="retangularFixedInfo"><b>MEDIDA FIXA</b><span>1,00 × 2,00 m</span><small>100 × 200 cm · o cliente não pode alterar essa medida.</small></div>'+ 
      '<div class="pv2Grid"><label class="pv2Field"><span>Nome do produto</span><input id="retangular1x2Label" type="text" maxlength="80" value="'+esc(p.label)+'"></label><label class="pv2Field"><span>Preço unitário</span><input id="retangular1x2Price" type="number" min="0" step="0.01" value="'+esc(p.unitPrice)+'"></label></div>'+ 
      '<div class="pv2Summary"><span>Preço atual <b id="retangular1x2PricePreview">'+money(p.unitPrice)+'</b></span><span>Pedido mínimo <b>1 unidade</b></span></div>'+ 
      '<div id="retangular1x2AdminStatus" class="pv2Status">A pasta já está conectada. Você pode deixar R$ 0,00 por enquanto; o produto fica visível para consulta, mas não pode ser adicionado ao pedido até receber preço.</div>'+ 
      '<div class="pv2Actions"><button id="retangular1x2Reload" class="btn secondary" type="button">Recarregar</button><button id="retangular1x2Save" class="btn green" type="button">Salvar Painel Retangular</button></div>';
    host.appendChild(card);bind();return true;
  }

  function bind(){var price=$('retangular1x2Price'),save=$('retangular1x2Save'),reload=$('retangular1x2Reload');if(price)price.addEventListener('input',function(){var v=Math.max(0,num(this.value,0));if($('retangular1x2PricePreview'))$('retangular1x2PricePreview').textContent=money(v);if(v>0&&$('retangular1x2Enabled')&&!$('retangular1x2Enabled').dataset.touched)$('retangular1x2Enabled').checked=true;status(v>0?'Pronto para salvar.':'Preço pode permanecer em R$ 0,00 até você decidir.',v>0?'ok':'')});if($('retangular1x2Enabled'))$('retangular1x2Enabled').addEventListener('change',function(){this.dataset.touched='1'});if(save)save.onclick=saveProduct;if(reload)reload.onclick=function(){load(true)}}

  async function saveProduct(){
    if(state.saving)return;
    var label=clean($('retangular1x2Label')&&$('retangular1x2Label').value)||DEFAULT_LABEL;var price=Math.max(0,num($('retangular1x2Price')&&$('retangular1x2Price').value,0));var enabled=!!($('retangular1x2Enabled')&&$('retangular1x2Enabled').checked);
    if(enabled&&price<=0){enabled=false;if($('retangular1x2Enabled'))$('retangular1x2Enabled').checked=false;status('Preço zerado: o Painel Retangular será salvo sem liberação para pedidos.','')}
    state.saving=true;
    try{
      var fresh=await api('/api/admin/config?retangular1x2='+Date.now());var c=clone(fresh.config||state.config||{});c.products=c.products&&typeof c.products==='object'?c.products:{};
      var product={label:label,productKey:KEY,enabled:enabled,unitPrice:price,priceLabel:price>0?money(price)+' cada':'Preço não definido',minQty:1,step:1,initialQty:1,disableCustomization:true,skipProductsStep:true,fixedSize:'1X2',sizeKey:'100x200',catalogReady:true};
      c.products.retangular1x2=clone(product);c.products[KEY]=clone(product);
      c.productCatalog=Array.isArray(c.productCatalog)?c.productCatalog:[];c.productCatalog=c.productCatalog.filter(function(x){return!x||x.productKey!==KEY});c.productCatalog.push({id:KEY,label:label,productKey:KEY,active:enabled,editable:true,catalogReady:true});
      c.drives=Array.isArray(c.drives)?c.drives:[];c.drives=c.drives.filter(function(d){return!d||d.productKey!==KEY});c.drives.push({id:KEY,name:'Drive Painel Retangular 1x2',folderId:ROOT,active:true,type:KEY,productKey:KEY,structure:'theme-or-subtheme-images',filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO'});
      c.ui=c.ui&&typeof c.ui==='object'?c.ui:{};var version=Math.max(1,parseInt(c.commercialVersion||c.ui.cacheVersion||1,10)||1)+1;c.commercialVersion=version;c.ui.cacheVersion=version;c.commercialUpdatedAt=new Date().toISOString();
      var saved=await api('/api/admin/config',{method:'POST',body:JSON.stringify({config:c})});state.config=clone(saved.config||c);status(price>0&&enabled?'Painel Retangular salvo e disponível para pedidos.':'Painel Retangular salvo. O catálogo está conectado; falta apenas definir/liberar o preço para vender.','ok');if($('retangular1x2PricePreview'))$('retangular1x2PricePreview').textContent=money(price);
    }catch(error){status(error.message,'error')}finally{state.saving=false}
  }

  async function load(show){if(state.loading)return;state.loading=true;try{await fetch('/api/commercial-config?retangular1x2Admin='+Date.now(),{cache:'no-store',credentials:'include'}).catch(function(){});var d=await api('/api/admin/config?retangular1x2='+Date.now());state.config=clone(d.config||{});var old=$('retangular1x2ProductCard');if(old)old.remove();render();if(show)status('Configuração recarregada.','ok')}catch(error){if(active()){render();status(error.message,'error')}}finally{state.loading=false}}
  function injectStyle(){if($('retangular1x2AdminStyle'))return;var s=document.createElement('style');s.id='retangular1x2AdminStyle';s.textContent='.retangular1x2ProductCard{border-color:#eadff2!important}.retangular1x2ProductCard .pv2Title i{background:#f7f1fb!important;color:#74458e!important}.retangularOrigin,.retangularFixedInfo{margin:0 0 16px;padding:14px;border-radius:16px}.retangularOrigin{background:#f8fbff;border:1px solid #dfeaf3}.retangularFixedInfo{background:#f8f5fb;border:1px solid #e8dcf0}.retangularOrigin b,.retangularOrigin code,.retangularOrigin span,.retangularFixedInfo b,.retangularFixedInfo span,.retangularFixedInfo small{display:block}.retangularOrigin b,.retangularFixedInfo b{font-size:10px;letter-spacing:.1em;color:#74458e}.retangularOrigin code{margin:6px 0;font-size:11px;word-break:break-all}.retangularOrigin span,.retangularFixedInfo small{font-size:12px;color:#756e76;font-weight:700}.retangularFixedInfo span{margin:5px 0 2px;font:900 18px Montserrat,Arial,sans-serif;color:#222124}#retangular1x2AdminStatus[data-tone="ok"]{background:#edfbf5;color:#116b52}#retangular1x2AdminStatus[data-tone="error"]{background:#fff0f3;color:#a1264d}';document.head.appendChild(s)}
  function schedule(){setTimeout(function(){if(active()){if(state.config)render();else load(false)}},220)}
  injectStyle();document.addEventListener('click',function(e){if(e.target&&e.target.closest('[data-tab="productsView"]'))schedule()});new MutationObserver(function(){if(active()&&!$('retangular1x2ProductCard'))schedule()}).observe(document.body,{childList:true,subtree:true});setTimeout(function(){load(false);schedule()},1000);
})();
