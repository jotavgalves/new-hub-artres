(function(){
  if(window.__ARMAZEM_ADMIN_PRODUCTS_V2__)return;
  window.__ARMAZEM_ADMIN_PRODUCTS_V2__='1';

  var ROOTS={
    '50x50':'193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
    'painel-150':'18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-'
  };
  var state={config:null,loading:false,saving:false};
  function $(id){return document.getElementById(id)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function num(v,fallback){var n=Number(String(v==null?'':v).replace(',','.'));return Number.isFinite(n)?n:fallback}
  function int(v,fallback){var n=parseInt(v,10);return Number.isFinite(n)&&n>0?n:fallback}
  function active(){return document.body.dataset.userRole!=='vendedora'&&(document.body.dataset.adminTab==='productsView'||!$('productsView')?.classList.contains('hidden'))}
  function panel(){return $('productsPanel')}
  function product(raw,defaults){raw=raw&&typeof raw==='object'?raw:{};return {label:String(raw.label||defaults.label),productKey:defaults.productKey,enabled:raw.enabled!==false,unitPrice:Math.max(0,num(raw.unitPrice,defaults.unitPrice)),minQty:int(raw.minQty||raw.minimum,defaults.minQty),step:int(raw.step,defaults.step),initialQty:int(raw.initialQty||raw.initial,defaults.initialQty),disableCustomization:true,skipProductsStep:true}}
  function normalize(config){
    config=config&&typeof config==='object'?config:{};
    config.products=config.products&&typeof config.products==='object'?config.products:{};
    config.products.bolinhas=product(config.products.bolinhas,{label:'Bolinhas 50x50',productKey:'50x50',unitPrice:9.9,minQty:6,step:2,initialQty:6});
    config.products.panel150=product(config.products.panel150||config.products['painel-150'],{label:'Painel 150 cm',productKey:'painel-150',unitPrice:0,minQty:1,step:1,initialQty:1});
    config.ui=config.ui&&typeof config.ui==='object'?config.ui:{};
    config.ui.discountPercent=Math.min(100,Math.max(0,num(config.ui.discountPercent,0)));
    return config;
  }
  async function api(url,opts){
    opts=opts||{};
    var r=await fetch(url,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})},...opts});
    var text=await r.text();var data={};
    try{data=text?JSON.parse(text):{}}catch(e){throw new Error('Resposta inválida do servidor.')}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||'Erro na solicitação.');
    return data;
  }
  function status(message,tone){var el=$('productsV2Status');if(!el)return;el.textContent=message;el.dataset.tone=tone||''}
  function field(key,label,value,type,extra){return '<label class="pv2Field"><span>'+esc(label)+'</span><input data-pv2="'+esc(key)+'" type="'+(type||'number')+'" value="'+esc(value)+'" '+(extra||'')+'></label>'}
  function card(id,p,icon){
    var key=p.productKey;
    var initialTotal=p.unitPrice*p.initialQty;
    return '<article class="pv2Card" data-product="'+esc(key)+'"><div class="pv2Head"><div class="pv2Title"><i>'+icon+'</i><div><h3>'+esc(p.label)+'</h3><small>'+esc(key)+'</small></div></div><label class="pv2Enabled"><input data-pv2="'+id+'.enabled" type="checkbox" '+(p.enabled?'checked':'')+'> Disponível</label></div><div class="pv2Origin"><b>ORIGEM PROTEGIDA</b><code>'+esc(ROOTS[key])+'</code><span>Somente descendentes desta pasta entram neste produto.</span></div><div class="pv2Grid">'+field(id+'.label','Nome do produto',p.label,'text','maxlength="80"')+field(id+'.unitPrice','Preço unitário',p.unitPrice,'number','min="0" step="0.01"')+field(id+'.minQty','Quantidade mínima',p.minQty,'number','min="1" step="1"')+field(id+'.step','Incremento',p.step,'number','min="1" step="1"')+field(id+'.initialQty','Quantidade inicial',p.initialQty,'number','min="1" step="1"')+'</div><div class="pv2Summary"><span>Preço unitário <b>'+money(p.unitPrice)+'</b></span><span>Pedido inicial <b>'+money(initialTotal)+'</b></span></div></article>';
  }
  function claim(){
    var p=panel();if(!p||!active())return false;
    if(p.dataset.productsOwner==='v2'&&$('productsV2Form'))return true;
    p.dataset.productsOwner='v2';
    var c=state.config||normalize({});var b=c.products.bolinhas;var panel150=c.products.panel150;
    p.innerHTML='<section class="card span-12"><div class="sectionHead"><div><h3>Produtos, preços e quantidades</h3><p>Bolinhas e Painel 150 cm são configurados separadamente. As raízes do Drive não podem ser alteradas aqui.</p></div></div><form id="productsV2Form"><div class="pv2Discount">'+field('discountPercent','Desconto geral (%)',c.ui.discountPercent,'number','min="0" max="100" step="0.01"')+'<p>Com desconto zero, o site remove toda comunicação de desconto.</p></div><div class="pv2Cards">'+card('bolinhas',b,'●')+card('panel150',panel150,'◯')+'</div><div id="productsV2Status" class="pv2Status">Última configuração carregada do servidor.</div><div class="pv2Actions"><button id="reloadProductsV2" class="btn secondary" type="button">Recarregar</button><button id="saveProductsV2" class="btn green" type="submit">Salvar produtos</button></div></form></section>';
    $('productsV2Form').onsubmit=save;
    $('reloadProductsV2').onclick=function(){load(true)};
    p.querySelectorAll('[data-pv2]').forEach(function(input){input.addEventListener('input',preview);input.addEventListener('change',preview)});
    return true;
  }
  function readForm(){
    var c=normalize(JSON.parse(JSON.stringify(state.config||{})));
    function val(key){var el=document.querySelector('[data-pv2="'+key+'"]');return el?el.value:''}
    function checked(key){var el=document.querySelector('[data-pv2="'+key+'"]');return !!(el&&el.checked)}
    c.ui.discountPercent=Math.min(100,Math.max(0,num(val('discountPercent'),0)));
    [['bolinhas','50x50'],['panel150','painel-150']].forEach(function(pair){var id=pair[0],key=pair[1],p=c.products[id];p.label=String(val(id+'.label')||p.label).trim();p.productKey=key;p.enabled=checked(id+'.enabled');p.unitPrice=Math.max(0,num(val(id+'.unitPrice'),0));p.minQty=int(val(id+'.minQty'),1);p.step=int(val(id+'.step'),1);p.initialQty=int(val(id+'.initialQty'),p.minQty);if(p.initialQty<p.minQty)p.initialQty=p.minQty;var rem=(p.initialQty-p.minQty)%p.step;if(rem)p.initialQty+=p.step-rem;p.priceLabel=money(p.unitPrice)+' cada';p.disableCustomization=true;p.skipProductsStep=true});
    c.products['painel-150']=c.products.panel150;
    c.productCatalog=Array.isArray(c.productCatalog)?c.productCatalog:[];
    c.productCatalog=c.productCatalog.filter(function(x){return x&&x.productKey!=='50x50'&&x.productKey!=='painel-150'}).concat([{id:'bolinhas',label:c.products.bolinhas.label,productKey:'50x50',active:c.products.bolinhas.enabled,editable:true},{id:'painel-150',label:c.products.panel150.label,productKey:'painel-150',active:c.products.panel150.enabled,editable:true}]);
    c.drives=Array.isArray(c.drives)?c.drives:[];
    c.drives=c.drives.filter(function(d){return d&&d.productKey!=='50x50'&&d.productKey!=='painel-150'}).concat([{id:'bolinhas',name:'Drive Bolinhas',folderId:ROOTS['50x50'],active:true,type:'bolinhas',productKey:'50x50',structure:'theme-or-subtheme-images',filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO'},{id:'painel-150',name:'Drive Painel 150 cm',folderId:ROOTS['painel-150'],active:true,type:'painel-150',productKey:'painel-150',structure:'theme-or-subtheme-images',filenamePattern:'ID_TEMA_PRODUTO_DIMENSAO'}]);
    c.commercialVersion=Math.max(1,int(c.commercialVersion,Number(c.ui.cacheVersion||1)))+1;c.ui.cacheVersion=c.commercialVersion;c.commercialUpdatedAt=new Date().toISOString();
    return c;
  }
  function validate(c){for(var id of ['bolinhas','panel150']){var p=c.products[id];if(!p.label)return 'Informe o nome dos dois produtos.';if(p.enabled&&p.unitPrice<=0)return 'Informe um preço maior que zero para '+p.label+'.';if(p.initialQty<p.minQty||(p.initialQty-p.minQty)%p.step!==0)return 'A quantidade inicial de '+p.label+' deve respeitar mínimo e incremento.'}return ''}
  function preview(){try{var c=readForm();var err=validate(c);status(err||'Configuração válida. Clique em Salvar produtos.',err?'error':'ok')}catch(e){status(e.message,'error')}}
  async function save(e){e.preventDefault();if(state.saving)return;var c=readForm();var err=validate(c);if(err){status(err,'error');return}state.saving=true;status('Salvando configuração...','');try{var d=await api('/api/admin/config',{method:'POST',body:JSON.stringify({config:c})});state.config=normalize(d.config||c);claim();status('Produtos, preços e quantidades salvos. O site já usa a nova versão.','ok')}catch(error){status(error.message,'error')}finally{state.saving=false}}
  async function load(show){if(state.loading)return;state.loading=true;try{var d=await api('/api/admin/config?productsV2='+Date.now());state.config=normalize(d.config||{});if(active())claim();if(show)status('Configuração recarregada.','ok')}catch(error){if(active()){claim();status(error.message,'error')}}finally{state.loading=false}}
  function injectStyle(){if($('adminProductsV2Style'))return;var s=document.createElement('style');s.id='adminProductsV2Style';s.textContent='.pv2Cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.pv2Card{border:1px solid #eadfe3;border-radius:24px;padding:20px;background:#fff;box-shadow:0 14px 34px rgba(31,27,35,.05)}.pv2Card[data-product="painel-150"]{border-color:#cfeefa}.pv2Head,.pv2Title,.pv2Summary,.pv2Actions{display:flex;align-items:center}.pv2Head{justify-content:space-between;gap:14px}.pv2Title{gap:11px}.pv2Title i{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:#effbff;color:#117696;font-style:normal;font-size:22px}.pv2Title h3{margin:0;font-family:Montserrat}.pv2Title small{color:#827982;font-weight:900}.pv2Enabled{display:flex;align-items:center;gap:7px;font-weight:900;color:#665f67}.pv2Enabled input{width:18px;height:18px}.pv2Origin{margin:16px 0;padding:13px;border-radius:16px;background:#f8fbfd;border:1px solid #d9f1fa}.pv2Origin b,.pv2Origin code,.pv2Origin span{display:block}.pv2Origin b{font-size:10px;letter-spacing:.1em;color:#117696}.pv2Origin code{margin:5px 0;overflow-wrap:anywhere;font-weight:900}.pv2Origin span{color:#777078;font-size:12px}.pv2Grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pv2Field{display:grid;gap:6px}.pv2Field span{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:900;color:#756d75}.pv2Field input{min-height:46px;border:1px solid #eadfe3;border-radius:14px;padding:0 13px;font:inherit;font-weight:800}.pv2Summary{justify-content:space-between;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid #eee5e7;color:#6f6872;font-size:12px}.pv2Summary span{display:grid;gap:3px}.pv2Summary b{color:#222124;font-size:15px}.pv2Discount{display:grid;grid-template-columns:minmax(180px,260px) 1fr;align-items:end;gap:16px;margin-bottom:16px;padding:16px;border-radius:20px;background:#fff8fb;border:1px solid #ffd6e5}.pv2Discount p{margin:0 0 12px;color:#766d77;font-weight:800}.pv2Status{margin-top:16px;padding:12px 14px;border-radius:15px;background:#f7f5f5;color:#746d73;font-weight:850}.pv2Status[data-tone="ok"]{background:#edfbf5;color:#116b52}.pv2Status[data-tone="error"]{background:#fff0f3;color:#a1264d}.pv2Actions{justify-content:flex-end;gap:10px;margin-top:14px}@media(max-width:800px){.pv2Cards,.pv2Grid{grid-template-columns:1fr}.pv2Discount{grid-template-columns:1fr}.pv2Head,.pv2Summary{align-items:flex-start;flex-direction:column}}';document.head.appendChild(s)}
  function schedule(){setTimeout(function(){if(active()){if(state.config)claim();else load(false)}},180)}
  injectStyle();
  document.addEventListener('click',function(e){if(e.target&&e.target.closest('[data-tab="productsView"]'))schedule()});
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
  setTimeout(function(){load(false);schedule()},900);
})();
