(function(){
  if(window.__ARMAZEM_ADMIN_PAINEL_ROMANO__)return;
  window.__ARMAZEM_ADMIN_PAINEL_ROMANO__='1';

  var KEY='painel-romano';
  var ROOT='15f6Ge0jZCHSIWMhmEUOs4bfXy9y5U3wk';
  var state={config:null,loading:false,saving:false};

  function $(id){return document.getElementById(id)}
  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
  function num(v,fallback){var n=Number(String(v==null?'':v).replace(',','.'));return Number.isFinite(n)?n:fallback}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function clone(v){return JSON.parse(JSON.stringify(v&&typeof v==='object'?v:{}))}
  function active(){return document.body.dataset.userRole!=='vendedora'&&document.body.dataset.adminTab==='productsView'}
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
    var p=products.painelRomano||products[KEY]||{};
    var price=Math.max(0,num(p.unitPrice,0));
    return {
      label:clean(p.label||'Painel Romano 1x2'),
      unitPrice:price,
      enabled:p.enabled===true||(p.enabled!==false&&price>0),
      neverConfigured:!products.painelRomano&&!products[KEY]
    };
  }
  function status(msg,tone){var el=$('romanAdminStatus');if(!el)return;el.textContent=msg||'';el.dataset.tone=tone||''}

  function render(){
    if(!active())return false;
    var host=document.querySelector('#productsV2Form .pv2Cards')||document.querySelector('#productsPanel .pv2Cards')||$('productsPanel');
    if(!host)return false;
    var existing=$('romanProductCard');
    if(existing)return true;
    var p=rawProduct(state.config||{});
    var checked=p.enabled||p.unitPrice<=0;
    var card=document.createElement('article');
    card.id='romanProductCard';
    card.className='pv2Card romanProductCard';
    card.dataset.product=KEY;
    card.innerHTML='<div class="pv2Head"><div class="pv2Title"><i>▱</i><div><h3>'+esc(p.label)+'</h3><small>'+KEY+'</small></div></div><label class="pv2Enabled"><input id="romanEnabled" type="checkbox" '+(checked?'checked':'')+'> Disponível</label></div>'+
      '<div class="pv2Origin"><b>ORIGEM PROTEGIDA</b><code>'+ROOT+'</code><span>As artes deste produto vêm exclusivamente da pasta ROMANO informada.</span></div>'+
      '<div class="romanFixedInfo"><b>MEDIDA FIXA</b><span>1,00 × 2,00 m</span><small>100 × 200 cm · o cliente não pode alterar essa medida.</small></div>'+
      '<div class="pv2Grid"><label class="pv2Field"><span>Nome do produto</span><input id="romanLabel" type="text" maxlength="80" value="'+esc(p.label)+'"></label><label class="pv2Field"><span>Preço unitário</span><input id="romanPrice" type="number" min="0" step="0.01" value="'+esc(p.unitPrice)+'"></label></div>'+
      '<div class="pv2Summary"><span>Preço atual <b id="romanPricePreview">'+money(p.unitPrice)+'</b></span><span>Pedido mínimo <b>1 unidade</b></span></div>'+
      '<div id="romanAdminStatus" class="pv2Status">Defina o preço e salve. Com preço zero, o produto permanece oculto no site.</div>'+
      '<div class="pv2Actions"><button id="romanReload" class="btn secondary" type="button">Recarregar</button><button id="romanSave" class="btn green" type="button">Salvar Painel Romano</button></div>';
    host.appendChild(card);
    bind();
    return true;
  }

  function bind(){
    var price=$('romanPrice'),save=$('romanSave'),reload=$('romanReload');
    if(price)price.addEventListener('input',function(){var v=Math.max(0,num(this.value,0));if($('romanPricePreview'))$('romanPricePreview').textContent=money(v);if(v>0&&$('romanEnabled')&&!$('romanEnabled').dataset.touched)$('romanEnabled').checked=true;status(v>0?'Pronto para salvar.':'Informe um preço maior que zero para disponibilizar o produto.',v>0?'ok':'')});
    if($('romanEnabled'))$('romanEnabled').addEventListener('change',function(){this.dataset.touched='1'});
    if(save)save.onclick=saveRoman;
    if(reload)reload.onclick=function(){load(true)};
  }

  async function saveRoman(){
    if(state.saving)return;
    var label=clean($('romanLabel')&&$('romanLabel').value)||'Painel Romano 1x2';
    var price=Math.max(0,num($('romanPrice')&&$('romanPrice').value,0));
    var enabled=!!($('romanEnabled')&&$('romanEnabled').checked);
    if(enabled&&price<=0){status('Informe um preço maior que zero antes de deixar o produto disponível.','error');return}
    state.saving=true;status('Salvando Painel Romano...','');
    try{
      var fresh=await api('/api/admin/config?roman='+Date.now());
      var c=clone(fresh.config||state.config||{});
      c.products=c.products&&typeof c.products==='object'?c.products:{};
      var product={
        label:label,
        productKey:KEY,
        enabled:enabled,
        unitPrice:price,
        priceLabel:price>0?money(price)+' cada':'Preço não definido',
        minQty:1,
        step:1,
        initialQty:1,
        disableCustomization:true,
        skipProductsStep:true,
        fixedSize:'1X2',
        sizeKey:'100x200'
      };
      c.products.painelRomano=clone(product);
      c.products[KEY]=clone(product);

      c.productCatalog=Array.isArray(c.productCatalog)?c.productCatalog:[];
      c.productCatalog=c.productCatalog.filter(function(x){return !x||x.productKey!==KEY});
      c.productCatalog.push({id:KEY,label:label,productKey:KEY,active:enabled,editable:true});

      c.drives=Array.isArray(c.drives)?c.drives:[];
      c.drives=c.drives.filter(function(d){return !d||d.productKey!==KEY});
      c.drives.push({id:KEY,name:'Drive Painel Romano 1x2',folderId:ROOT,active:true,type:KEY,productKey:KEY,structure:'theme-or-subtheme-images',filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO'});

      c.ui=c.ui&&typeof c.ui==='object'?c.ui:{};
      var version=Math.max(1,parseInt(c.commercialVersion||c.ui.cacheVersion||1,10)||1)+1;
      c.commercialVersion=version;
      c.ui.cacheVersion=version;
      c.commercialUpdatedAt=new Date().toISOString();

      var saved=await api('/api/admin/config',{method:'POST',body:JSON.stringify({config:c})});
      state.config=clone(saved.config||c);
      status(enabled?'Painel Romano salvo e disponível no site.':'Painel Romano salvo, mas oculto no site.','ok');
      if($('romanPricePreview'))$('romanPricePreview').textContent=money(price);
    }catch(error){status(error.message,'error')}finally{state.saving=false}
  }

  async function load(show){
    if(state.loading)return;
    state.loading=true;
    try{
      /* Também dispara a migração aditiva da configuração comercial, se ainda não existir. */
      await fetch('/api/commercial-config?romanAdmin='+Date.now(),{cache:'no-store',credentials:'include'}).catch(function(){});
      var d=await api('/api/admin/config?roman='+Date.now());
      state.config=clone(d.config||{});
      var old=$('romanProductCard');if(old)old.remove();
      render();
      if(show)status('Configuração recarregada.','ok');
    }catch(error){if(active()){render();status(error.message,'error')}}finally{state.loading=false}
  }

  function injectStyle(){
    if($('romanAdminStyle'))return;
    var s=document.createElement('style');s.id='romanAdminStyle';
    s.textContent='.romanProductCard{border-color:#d9eaf6!important}.romanProductCard .pv2Title i{background:#eef8ff!important;color:#176b91!important}.romanFixedInfo{margin:0 0 16px;padding:14px;border-radius:16px;background:#f6fbff;border:1px solid #dbeef8}.romanFixedInfo b,.romanFixedInfo span,.romanFixedInfo small{display:block}.romanFixedInfo b{font-size:10px;letter-spacing:.1em;color:#176b91}.romanFixedInfo span{margin:5px 0 2px;font:900 18px Montserrat,Arial,sans-serif;color:#222124}.romanFixedInfo small{font-size:12px;color:#756e76;font-weight:700}#romanAdminStatus[data-tone="ok"]{background:#edfbf5;color:#116b52}#romanAdminStatus[data-tone="error"]{background:#fff0f3;color:#a1264d}';
    document.head.appendChild(s);
  }

  function schedule(){setTimeout(function(){if(active()){if(state.config)render();else load(false)}},220)}
  injectStyle();
  document.addEventListener('click',function(e){if(e.target&&e.target.closest('[data-tab="productsView"]'))schedule()});
  new MutationObserver(function(){if(active()&&!$('romanProductCard'))schedule()}).observe(document.body,{childList:true,subtree:true});
  setTimeout(function(){load(false);schedule()},1000);
})();
