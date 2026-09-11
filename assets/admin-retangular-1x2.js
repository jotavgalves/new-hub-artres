(function(){
  if(window.__ARMAZEM_ADMIN_RETANGULAR_1X2__)return;
  window.__ARMAZEM_ADMIN_RETANGULAR_1X2__='1';

  var KEY='retangular-1x2';
  var state={config:null,loading:false,saving:false};

  function $(id){return document.getElementById(id)}
  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
  function num(v,fallback){var n=Number(String(v==null?'':v).replace(',','.'));return Number.isFinite(n)?n:fallback}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function clone(v){return JSON.parse(JSON.stringify(v&&typeof v==='object'?v:{}))}
  function active(){var view=$('productsView');return document.body.dataset.userRole!=='vendedora'&&(document.body.dataset.adminTab==='productsView'||!!(view&&!view.classList.contains('hidden')))}
  function api(url,opts){
    opts=opts||{};
    return fetch(url,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts}).then(async function(r){
      var text=await r.text();var data={};
      try{data=text?JSON.parse(text):{}}catch(e){throw new Error('Resposta inválida do servidor.')}
      if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||'Erro na solicitação.');
      return data;
    });
  }
  function rawProduct(config){
    var products=config&&config.products&&typeof config.products==='object'?config.products:{};
    var p=products.retangular1x2||products[KEY]||{};
    return {
      label:clean(p.label||'Retangular 1x2'),
      unitPrice:Math.max(0,num(p.unitPrice,0))
    };
  }
  function status(msg,tone){var el=$('retangular1x2AdminStatus');if(!el)return;el.textContent=msg||'';el.dataset.tone=tone||''}

  function render(){
    if(!active())return false;
    var host=document.querySelector('#productsV2Form .pv2Cards')||document.querySelector('#productsPanel .pv2Cards')||$('productsPanel');
    if(!host)return false;
    var existing=$('retangular1x2ProductCard');
    if(existing)return true;
    var p=rawProduct(state.config||{});
    var card=document.createElement('article');
    card.id='retangular1x2ProductCard';
    card.className='pv2Card retangular1x2ProductCard';
    card.dataset.product=KEY;
    card.innerHTML='<div class="pv2Head"><div class="pv2Title"><i>▯</i><div><h3>'+esc(p.label)+'</h3><small>'+KEY+'</small></div></div><label class="pv2Enabled pv2Disabled"><input type="checkbox" disabled> Aguardando catálogo</label></div>'+ 
      '<div class="retangularPendingOrigin"><b>ORIGEM DO CATÁLOGO</b><span>Ainda não conectada.</span><small>Quando a pasta do Google Drive for informada, ela será vinculada exclusivamente a esta classe.</small></div>'+ 
      '<div class="retangularFixedInfo"><b>MEDIDA FIXA</b><span>1,00 × 2,00 m</span><small>100 × 200 cm · identidade técnica: 100x200.</small></div>'+ 
      '<div class="pv2Grid"><label class="pv2Field"><span>Nome do produto</span><input id="retangular1x2Label" type="text" maxlength="80" value="'+esc(p.label)+'"></label><label class="pv2Field"><span>Preço unitário</span><input id="retangular1x2Price" type="number" min="0" step="0.01" value="'+esc(p.unitPrice)+'"></label></div>'+ 
      '<div class="pv2Summary"><span>Preço configurado <b id="retangular1x2PricePreview">'+money(p.unitPrice)+'</b></span><span>Pedido mínimo <b>1 unidade</b></span></div>'+ 
      '<div id="retangular1x2AdminStatus" class="pv2Status">Você pode definir o preço agora ou deixar R$ 0,00. O produto permanece fora do catálogo público até a pasta do Drive ser conectada.</div>'+ 
      '<div class="pv2Actions"><button id="retangular1x2Reload" class="btn secondary" type="button">Recarregar</button><button id="retangular1x2Save" class="btn green" type="button">Salvar Retangular 1x2</button></div>';
    host.appendChild(card);
    bind();
    return true;
  }

  function bind(){
    var price=$('retangular1x2Price'),save=$('retangular1x2Save'),reload=$('retangular1x2Reload');
    if(price)price.addEventListener('input',function(){var v=Math.max(0,num(this.value,0));if($('retangular1x2PricePreview'))$('retangular1x2PricePreview').textContent=money(v);status(v>0?'Preço pronto para salvar. O catálogo continua aguardando a pasta do Drive.':'Preço pode permanecer em R$ 0,00 até você decidir.','')});
    if(save)save.onclick=saveProduct;
    if(reload)reload.onclick=function(){load(true)};
  }

  async function saveProduct(){
    if(state.saving)return;
    var label=clean($('retangular1x2Label')&&$('retangular1x2Label').value)||'Retangular 1x2';
    var price=Math.max(0,num($('retangular1x2Price')&&$('retangular1x2Price').value,0));
    state.saving=true;status('Salvando Retangular 1x2...','');
    try{
      var fresh=await api('/api/admin/config?retangular1x2='+Date.now());
      var c=clone(fresh.config||state.config||{});
      c.products=c.products&&typeof c.products==='object'?c.products:{};
      var product={
        label:label,
        productKey:KEY,
        enabled:false,
        unitPrice:price,
        priceLabel:price>0?money(price)+' cada':'Preço não definido',
        minQty:1,
        step:1,
        initialQty:1,
        disableCustomization:true,
        skipProductsStep:true,
        fixedSize:'1X2',
        sizeKey:'100x200',
        catalogReady:false
      };
      c.products.retangular1x2=clone(product);
      c.products[KEY]=clone(product);

      c.productCatalog=Array.isArray(c.productCatalog)?c.productCatalog:[];
      c.productCatalog=c.productCatalog.filter(function(x){return !x||x.productKey!==KEY});
      c.productCatalog.push({id:KEY,label:label,productKey:KEY,active:false,editable:true,catalogReady:false});

      c.ui=c.ui&&typeof c.ui==='object'?c.ui:{};
      var version=Math.max(1,parseInt(c.commercialVersion||c.ui.cacheVersion||1,10)||1)+1;
      c.commercialVersion=version;
      c.ui.cacheVersion=version;
      c.commercialUpdatedAt=new Date().toISOString();

      var saved=await api('/api/admin/config',{method:'POST',body:JSON.stringify({config:c})});
      state.config=clone(saved.config||c);
      status('Retangular 1x2 salvo. Preço registrado; falta apenas conectar a pasta do catálogo para liberar no site.','ok');
      if($('retangular1x2PricePreview'))$('retangular1x2PricePreview').textContent=money(price);
    }catch(error){status(error.message,'error')}finally{state.saving=false}
  }

  async function load(show){
    if(state.loading)return;
    state.loading=true;
    try{
      await fetch('/api/commercial-config?retangular1x2Admin='+Date.now(),{cache:'no-store',credentials:'include'}).catch(function(){});
      var d=await api('/api/admin/config?retangular1x2='+Date.now());
      state.config=clone(d.config||{});
      var old=$('retangular1x2ProductCard');if(old)old.remove();
      render();
      if(show)status('Configuração recarregada.','ok');
    }catch(error){if(active()){render();status(error.message,'error')}}finally{state.loading=false}
  }

  function injectStyle(){
    if($('retangular1x2AdminStyle'))return;
    var s=document.createElement('style');s.id='retangular1x2AdminStyle';
    s.textContent='.retangular1x2ProductCard{border-color:#eadff2!important}.retangular1x2ProductCard .pv2Title i{background:#f7f1fb!important;color:#74458e!important}.retangularPendingOrigin,.retangularFixedInfo{margin:0 0 16px;padding:14px;border-radius:16px}.retangularPendingOrigin{background:#fff8eb;border:1px solid #f3dfb8}.retangularFixedInfo{background:#f8f5fb;border:1px solid #e8dcf0}.retangularPendingOrigin b,.retangularPendingOrigin span,.retangularPendingOrigin small,.retangularFixedInfo b,.retangularFixedInfo span,.retangularFixedInfo small{display:block}.retangularPendingOrigin b,.retangularFixedInfo b{font-size:10px;letter-spacing:.1em;color:#74458e}.retangularPendingOrigin span,.retangularFixedInfo span{margin:5px 0 2px;font:900 18px Montserrat,Arial,sans-serif;color:#222124}.retangularPendingOrigin small,.retangularFixedInfo small{font-size:12px;color:#756e76;font-weight:700}.pv2Enabled.pv2Disabled{opacity:.55}#retangular1x2AdminStatus[data-tone="ok"]{background:#edfbf5;color:#116b52}#retangular1x2AdminStatus[data-tone="error"]{background:#fff0f3;color:#a1264d}';
    document.head.appendChild(s);
  }

  function schedule(){setTimeout(function(){if(active()){if(state.config)render();else load(false)}},220)}
  injectStyle();
  document.addEventListener('click',function(e){if(e.target&&e.target.closest('[data-tab="productsView"]'))schedule()});
  new MutationObserver(function(){if(active()&&!$('retangular1x2ProductCard'))schedule()}).observe(document.body,{childList:true,subtree:true});
  setTimeout(function(){load(false);schedule()},1000);
})();
