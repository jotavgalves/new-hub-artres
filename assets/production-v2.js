(function(){
  'use strict';
  if(window.__ARMAZEM_PRODUCTION_V2__)return;
  window.__ARMAZEM_PRODUCTION_V2__='2026-07-31';

  const STORAGE='armazem:production:workspace';
  const CUSTOMER_DRAFT='armazem:production:customer';
  const PRODUCTS={
    bolinhas:{id:'bolinhas',key:'50x50',label:'Bolinhas',title:'Bolinhas 50x50',icon:'●'},
    'painel-150':{id:'painel-150',key:'painel-150',label:'Painel 150 cm',title:'Painel redondo 150 cm',icon:'◯'}
  };
  const ALIASES={bolinhas:'bolinhas',bolinha:'bolinhas','50x50':'bolinhas',painel:'painel-150',painel150:'painel-150','painel-150':'painel-150'};
  let activeId='';
  let commercial=null;
  let checkoutBusy=false;
  let dialog=null;

  const legacy={
    api:typeof api==='function'?api:null,
    productConfig:typeof productConfig==='function'?productConfig:null,
    price:typeof price==='function'?price:null,
    discount:typeof discount==='function'?discount:null,
    rule50:typeof rule50==='function'?rule50:null,
    cartRule:typeof cartRule==='function'?cartRule:null,
    renderCart:typeof renderCart==='function'?renderCart:null,
    addItem:typeof addItem==='function'?addItem:null
  };

  start().catch(function(error){
    console.error('PRODUCTION_V2_START_FAILED',error);
    notify('Não foi possível carregar os produtos atualizados. Recarregue a página.');
  });

  async function start(){
    installStyle();
    commercial=await loadCommercial();
    installRuntime();
    installNavigation();
    installCheckout();
    patchCopy();
    const selected=resolveInitial();
    if(selected)activate(selected.id,false);
    else showChooser();
    setInterval(refreshCommercial,60000);
    document.documentElement.dataset.productionV2='active';
  }

  async function loadCommercial(){
    const response=await fetch('/api/commercial-config',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
    const data=await response.json().catch(function(){return {}});
    if(!response.ok||data.ok!==true||!data.config)throw new Error(data.error||'COMMERCIAL_CONFIG_FAILED');
    return normalizeCommercial(data.config);
  }

  function normalizeCommercial(input){
    const products=input&&input.products||{};
    return {
      version:positive(input&&input.version,1),
      discount:percent(input&&input.effectiveDiscountPercent),
      products:{
        '50x50':normalizeProduct(products['50x50'],{label:'Bolinhas 50x50',unitPrice:9.90,minimum:6,step:2,initial:6,enabled:true,scope:'cart-product-total'}),
        'painel-150':normalizeProduct(products['painel-150'],{label:'Painel 150 cm',unitPrice:59.90,minimum:1,step:1,initial:1,enabled:true,scope:'item'})
      }
    };
  }

  function normalizeProduct(value,fallback){
    const raw=value&&typeof value==='object'?value:{};
    const quantity=raw.quantity&&typeof raw.quantity==='object'?raw.quantity:{};
    return {
      label:clean(raw.label||fallback.label),
      unitPrice:nonNegative(raw.unitPrice,fallback.unitPrice),
      minimum:positive(quantity.minimum,fallback.minimum),
      step:positive(quantity.step,fallback.step),
      initial:positive(quantity.initial,fallback.initial),
      enabled:raw.enabled!==false,
      scope:quantity.scope==='item'?'item':fallback.scope
    };
  }

  async function refreshCommercial(){
    try{
      const next=await loadCommercial();
      if(!commercial||next.version!==commercial.version){
        commercial=next;
        if(typeof renderCart==='function')renderCart();
        patchCopy();
        refreshNavigation();
        notify('Preços e quantidades foram atualizados.');
      }
    }catch(_){ }
  }

  function installRuntime(){
    if(!legacy.api||!legacy.productConfig||!legacy.price||!legacy.discount||!legacy.cartRule||!legacy.renderCart)return;

    api=function(params,options){
      const workspace=currentWorkspace();
      if(!workspace)return Promise.reject(new Error('ESCOLHA_UM_PRODUTO'));
      const scoped={...(params||{}),product:workspace.key};
      const q=new URLSearchParams(scoped);
      return fetch('/api/catalog-v2?'+q.toString(),{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}}).then(async function(response){
        const data=await response.json().catch(function(){return {}});
        if(!response.ok||data.ok===false)throw new Error(data.detail||data.error||'Não conseguimos carregar as artes agora.');
        return data;
      });
    };

    productConfig=function(productKey){
      const base=legacy.productConfig(productKey)||{};
      const current=commercial&&commercial.products&&commercial.products[productKey];
      if(!current)return base;
      return {...base,label:current.label,unitPrice:current.unitPrice,baseQty:current.minimum,basePrice:round(current.minimum*current.unitPrice),afterStep:current.step,initialQuantity:current.initial,checkoutEnabled:current.enabled};
    };

    price=function(productKey,quantity,item){
      const current=commercial&&commercial.products&&commercial.products[productKey];
      if(!current)return legacy.price(productKey,quantity,item);
      const qty=Number(quantity||0);
      return qty>0?round(qty*current.unitPrice):0;
    };

    discount=function(){return round((typeof gross==='function'?gross():0)*(commercial.discount/100));};

    rule50=function(){
      const rule=commercial.products['50x50'];
      const quantity=safeCart().filter(function(item){return item.product==='50x50'}).reduce(function(sum,item){return sum+Number(item.qty||0)},0);
      if(!quantity)return null;
      if(!rule.enabled)return {type:'bad',title:rule.label,msg:'Este produto está temporariamente indisponível.'};
      if(quantity<rule.minimum)return {type:'bad',title:rule.label,msg:'Faltam '+(rule.minimum-quantity)+' para fechar o mínimo de '+rule.minimum+'.'};
      const remainder=(quantity-rule.minimum)%rule.step;
      if(remainder)return {type:'warn',title:rule.label,msg:'Adicione mais '+(rule.step-remainder)+' para respeitar o incremento de '+rule.step+'.'};
      return {type:'ok',title:rule.label,msg:quantity===rule.minimum?'Mínimo fechado. Os próximos incrementos são de '+rule.step+'.':'Quantidade dentro da regra comercial.'};
    };

    cartRule=function(){
      const base=legacy.cartRule();
      if(!safeCart().length)return {ok:false,msg:'Seu pedido ainda está vazio. Escolha o produto e adicione as artes que mais gostar.'};
      for(const key of Object.keys(commercial.products)){
        const product=commercial.products[key];
        const productItems=safeCart().filter(function(item){return item.product===key});
        if(productItems.length&&!product.enabled)return {ok:false,msg:product.label+' está temporariamente indisponível.'};
        if(key==='painel-150'){
          const invalid=productItems.find(function(item){const qty=Number(item.qty||0);return qty<product.minimum||(qty-product.minimum)%product.step!==0});
          if(invalid)return {ok:false,msg:'A quantidade de '+product.label+' deve começar em '+product.minimum+' e seguir de '+product.step+' em '+product.step+'.'};
        }
      }
      const bolinhas=rule50();
      if(bolinhas&&bolinhas.type!=='ok')return {ok:false,msg:bolinhas.msg};
      if(base&&base.ok===false&&!/10%|desconto/i.test(base.msg||''))return base;
      return {ok:true,msg:commercial.discount>0?'Perfeito. Sua seleção está pronta para enviar com '+formatPercent(commercial.discount)+' de desconto.':'Perfeito. Sua seleção está pronta para enviar.'};
    };

    renderCart=function(){
      const result=legacy.renderCart();
      patchCart();
      return result;
    };

    if(legacy.addItem){
      addItem=function(id){
        const source=(typeof items!=='undefined'&&Array.isArray(items)?items:[]).find(function(item){return item.id===id})||(typeof prev!=='undefined'?prev:null);
        const key=source&&source.product;
        const product=key&&commercial.products[key];
        if(product&&!product.enabled){notify(product.label+' está temporariamente indisponível.');return;}
        const existed=typeof entry==='function'?entry(id):null;
        const result=legacy.addItem(id);
        if(!existed&&product&&product.initial>1){
          const added=typeof entry==='function'?entry(id):null;
          if(added){added.qty=product.initial;if(typeof save==='function')save();if(typeof renderItems==='function'&&(typeof view==='undefined'||view==='items'||view==='search'))renderItems();renderCart();}
        }
        return result;
      };
    }

    renderCart();
  }

  function installNavigation(){
    const head=document.querySelector('.catHead');
    if(!head||document.getElementById('productionV2Nav'))return;
    const nav=document.createElement('section');
    nav.id='productionV2Nav';
    nav.className='productionV2Nav';
    nav.innerHTML='<div><span>Estou procurando</span><strong data-workspace-title>Escolha um produto</strong></div><div class="productionV2Tabs">'+buttons('tab')+'</div><small data-shared-cart>Mesmo carrinho para os dois produtos</small>';
    head.insertBefore(nav,head.firstChild);
    bindButtons(nav);
    refreshNavigation();
  }

  function buttons(kind){
    return Object.values(PRODUCTS).map(function(product){
      return '<button type="button" class="productionV2'+(kind==='card'?'Card':'Tab')+'" data-workspace="'+product.id+'"><i>'+product.icon+'</i><span><b>'+escapeHtml(product.label)+'</b>'+(kind==='card'?'<small>'+escapeHtml(product.title)+'</small>':'')+'</span></button>';
    }).join('');
  }

  function bindButtons(root){root.querySelectorAll('[data-workspace]').forEach(function(button){button.addEventListener('click',function(){activate(button.dataset.workspace,true)})});}

  function showChooser(){
    if(document.getElementById('productionV2Chooser'))return;
    const overlay=document.createElement('div');
    overlay.id='productionV2Chooser';
    overlay.className='productionV2Chooser';
    overlay.innerHTML='<section role="dialog" aria-modal="true"><p>ESCOLHA POR ONDE COMEÇAR</p><h2>Qual produto você está procurando?</h2><span>Você pode trocar depois. O carrinho continua compartilhado.</span><div>'+buttons('card')+'</div></section>';
    document.body.appendChild(overlay);bindButtons(overlay);requestAnimationFrame(function(){overlay.classList.add('show')});
  }

  function activate(value,announce){
    const product=resolve(value);if(!product)return;
    activeId=product.id;
    try{sessionStorage.setItem(STORAGE,activeId)}catch(_){ }
    try{const url=new URL(location.href);url.searchParams.set('produto',activeId);history.replaceState(history.state,'',url.pathname+url.search+url.hash)}catch(_){ }
    const chooser=document.getElementById('productionV2Chooser');if(chooser)chooser.remove();
    try{localStorage.removeItem('armazem:lastPlace')}catch(_){ }
    refreshNavigation();
    if(typeof loadThemes==='function')loadThemes();
    if(announce)notify('Agora você está vendo '+product.title+'. O carrinho foi mantido.');
  }

  function resolve(value){const id=ALIASES[String(value||'').toLowerCase()]||String(value||'').toLowerCase();return PRODUCTS[id]||null;}
  function resolveInitial(){let query='';try{const params=new URLSearchParams(location.search);query=params.get('produto')||params.get('product')||''}catch(_){ }let saved='';try{saved=sessionStorage.getItem(STORAGE)||''}catch(_){ }return resolve(query)||resolve(saved);}
  function currentWorkspace(){return resolve(activeId);}

  function refreshNavigation(){
    const current=currentWorkspace();
    document.querySelectorAll('[data-workspace]').forEach(function(button){button.classList.toggle('active',button.dataset.workspace===current?.id)});
    document.querySelectorAll('[data-workspace-title]').forEach(function(node){node.textContent=current?current.title:'Escolha um produto'});
    const qty=typeof cartQty==='function'?cartQty():0;
    document.querySelectorAll('[data-shared-cart]').forEach(function(node){node.textContent=qty?'Carrinho compartilhado: '+qty+' item(ns)':'Mesmo carrinho para os dois produtos'});
  }

  function patchCopy(){
    const hasDiscount=commercial&&commercial.discount>0;
    const percent=formatPercent(commercial?commercial.discount:0);
    const subtitle=document.querySelector('.subtitle');
    if(subtitle&&/10%|desconto/i.test(subtitle.textContent||''))subtitle.innerHTML=hasDiscount?'Escolha o tema e selecione suas artes. <strong>'+percent+' de desconto</strong> será aplicado automaticamente.':'Escolha o tema e selecione as artes para montar seu pedido.';
    const promo=document.querySelector('.promo');
    if(promo){promo.style.display=hasDiscount?'':'none';promo.setAttribute('aria-hidden',hasDiscount?'false':'true');const pill=promo.querySelector('.promoPill');if(pill)pill.textContent=percent+' OFF por aqui';}
    const caption=document.getElementById('viewCaption');
    if(caption&&!hasDiscount&&/desconto|10%/i.test(caption.textContent||''))caption.textContent='Toque na arte para ver melhor. Quando gostar, adicione ao seu pedido.';
    patchCart();
  }

  function patchCart(){
    if(!commercial)return;
    const hasDiscount=commercial.discount>0;
    const percent=formatPercent(commercial.discount);
    document.querySelectorAll('.discountCard').forEach(function(card){card.style.setProperty('display',hasDiscount?'':'none','important');card.setAttribute('aria-hidden',hasDiscount?'false':'true');if(hasDiscount){const span=card.querySelector('span');if(span)span.textContent=percent+' OFF por aqui';const strong=card.querySelector('strong');if(strong&&typeof discount==='function')strong.textContent='Você economiza '+moneyValue(discount());}});
    document.querySelectorAll('.totalLine').forEach(function(line){const label=line.querySelector('span');if(label&&/Desconto por aqui/i.test(label.textContent||'')){line.style.setProperty('display',hasDiscount?'flex':'none','important');line.setAttribute('aria-hidden',hasDiscount?'false':'true');if(hasDiscount)label.textContent='Desconto por aqui '+percent;}});
    document.querySelectorAll('.total').forEach(function(line){const label=line.querySelector('span');if(label)label.textContent=hasDiscount?'Total com desconto':'Total';});
    document.querySelectorAll('a.wa').forEach(function(link){link.textContent=hasDiscount?'Enviar pedido com '+percent+' OFF':'Enviar pedido';});
    document.querySelectorAll('.emptyCart').forEach(function(empty){if(!hasDiscount)empty.innerHTML='<b>Seu pedido ainda está vazio</b>Escolha um produto e adicione as artes que mais gostar.';});
    refreshNavigation();
  }

  function installCheckout(){
    document.addEventListener('click',function(event){
      const anchor=event.target&&event.target.closest&&event.target.closest('a.wa');
      if(!anchor)return;
      event.preventDefault();event.stopPropagation();
      if(anchor.classList.contains('disabled')){notify('Revise o carrinho antes de enviar.');return;}
      const rule=typeof cartRule==='function'?cartRule():{ok:false,msg:'Revise o carrinho.'};
      if(!rule.ok){notify(rule.msg);return;}
      openCustomerDialog();
    },true);
  }

  function openCustomerDialog(){
    closeDialog();
    let draft={};try{draft=JSON.parse(sessionStorage.getItem(CUSTOMER_DRAFT)||'{}')||{}}catch(_){ }
    const overlay=document.createElement('div');
    overlay.className='productionV2Checkout';
    overlay.innerHTML='<form role="dialog" aria-modal="true"><h2>Confirmar seus dados</h2><p>O pedido será registrado antes de abrir o WhatsApp.</p><label><span>Seu nome</span><input name="name" maxlength="160" required autocomplete="name"></label><label><span>WhatsApp com DDD</span><input name="whatsapp" maxlength="20" required inputmode="tel" autocomplete="tel"></label><div class="productionV2CheckoutActions"><button type="button" data-cancel>Cancelar</button><button type="submit">Registrar e abrir WhatsApp</button></div><small data-error></small></form>';
    document.body.appendChild(overlay);dialog=overlay;
    const form=overlay.querySelector('form');form.elements.name.value=draft.name||'';form.elements.whatsapp.value=draft.whatsapp||'';
    overlay.querySelector('[data-cancel]').onclick=closeDialog;overlay.onclick=function(e){if(e.target===overlay)closeDialog()};form.onsubmit=submitOrder;
    setTimeout(function(){(form.elements.name.value?form.elements.whatsapp:form.elements.name).focus()},0);
  }

  async function submitOrder(event){
    event.preventDefault();if(checkoutBusy)return;
    const form=event.currentTarget;const error=form.querySelector('[data-error]');const button=form.querySelector('button[type="submit"]');
    const name=clean(form.elements.name.value).slice(0,160);const whatsapp=digits(form.elements.whatsapp.value).slice(0,20);
    if(!name){error.textContent='Informe seu nome.';return}if(whatsapp.length<10){error.textContent='Informe um WhatsApp válido com DDD.';return}
    const sellerId=String((typeof seller!=='undefined'&&seller)||(typeof LOCKED_SELLER!=='undefined'&&LOCKED_SELLER)||'');
    const profile=typeof SELLERS!=='undefined'&&SELLERS?SELLERS[sellerId]:null;
    if(!profile){error.textContent='Escolha uma vendedora.';return}
    const mapped=safeCart().map(function(item){return {driveFileId:String(item.driveFileId||item.id||''),productKey:String(item.product||''),quantity:Number(item.qty||0)}});
    const intent={seller:{id:sellerId,label:profile.label},customer:{name,whatsapp},items:mapped};
    try{sessionStorage.setItem(CUSTOMER_DRAFT,JSON.stringify({name,whatsapp}))}catch(_){ }
    const popup=window.open('','_blank');if(popup)popup.document.body.textContent='Registrando seu pedido...';
    checkoutBusy=true;button.disabled=true;error.textContent='';
    try{
      const response=await fetch('/api/orders-v2',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','Idempotency-Key':await idempotency(intent)},body:JSON.stringify(intent)});
      const data=await response.json().catch(function(){return {}});
      if(!response.ok||data.ok!==true||!data.orderNumber)throw new Error(data.error||'ORDER_SAVE_FAILED');
      const message='Pedido: '+data.orderNumber+'\n\n'+(typeof waMsg==='function'?waMsg():'Olá, gostaria de finalizar meu pedido.');
      const url='https://wa.me/'+digits(profile.phone)+'?text='+encodeURIComponent(message);
      notify('Pedido '+data.orderNumber+' registrado. Abrindo o WhatsApp.');closeDialog();
      if(popup)popup.location.replace(url);else location.assign(url);
    }catch(err){if(popup)popup.close();error.textContent=checkoutMessage(err.message);}
    finally{checkoutBusy=false;button.disabled=false;}
  }

  async function idempotency(intent){
    const canonical=JSON.stringify({day:new Date().toISOString().slice(0,10),seller:intent.seller,customer:intent.customer,items:[...intent.items].sort(function(a,b){return (a.driveFileId+a.productKey).localeCompare(b.driveFileId+b.productKey)})});
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
    return 'pages-v2-'+Array.from(new Uint8Array(digest)).map(function(byte){return byte.toString(16).padStart(2,'0')}).join('').slice(0,56);
  }

  function checkoutMessage(code){const messages={ARTE_NAO_ENCONTRADA:'Uma arte do carrinho não está mais disponível.',ARTE_PRODUTO_INCOMPATIVEL:'Uma arte não pertence ao produto selecionado.',PRODUTO_INDISPONIVEL:'Um produto do carrinho está indisponível.',QUANTIDADE_BOLINHAS_INVALIDA:'Revise a quantidade de Bolinhas.',QUANTIDADE_PAINEL_150_INVALIDA:'Revise a quantidade do Painel 150.',WHATSAPP_CLIENTE_INVALIDO:'Informe um WhatsApp válido.'};return messages[code]||'Não foi possível registrar o pedido. Revise os dados e tente novamente.';}
  function closeDialog(){if(dialog)dialog.remove();dialog=null;}

  function installStyle(){
    if(document.getElementById('productionV2Style'))return;
    const style=document.createElement('style');style.id='productionV2Style';style.textContent='.productionV2Nav{display:grid;grid-template-columns:minmax(180px,.8fr) 1fr auto;gap:12px;align-items:center;margin:-4px 0 16px;padding:14px;border:1px solid #eadfe3;border-radius:20px;background:#fff}.productionV2Nav>div:first-child{display:grid;gap:3px}.productionV2Nav>div:first-child span{font-size:10px;font-weight:900;letter-spacing:.08em;color:#8a8189;text-transform:uppercase}.productionV2Nav>div:first-child strong{font-family:Montserrat;font-size:15px}.productionV2Tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}.productionV2Tab,.productionV2Card{border:1px solid #eadfe3;background:#fff;border-radius:15px;display:flex;align-items:center;gap:9px;text-align:left;cursor:pointer;font:inherit}.productionV2Tab{min-height:46px;padding:8px 12px}.productionV2Tab.active,.productionV2Card.active{border-color:#ef5585;background:#fff1f6;color:#d9366b}.productionV2Tab i,.productionV2Card i{font-style:normal;font-size:19px}.productionV2Tab b,.productionV2Card b{font-weight:950}.productionV2Nav>small{font-weight:850;color:#756d75}.productionV2Chooser,.productionV2Checkout{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(34,33,36,.6);backdrop-filter:blur(8px);opacity:0;transition:.18s}.productionV2Chooser.show,.productionV2Checkout{opacity:1}.productionV2Chooser>section,.productionV2Checkout>form{width:min(100%,580px);padding:26px;border-radius:28px;background:#fff;box-shadow:0 30px 90px rgba(0,0,0,.25)}.productionV2Chooser section>p{margin:0 0 8px;color:#d9366b;font-size:11px;font-weight:950;letter-spacing:.1em}.productionV2Chooser h2,.productionV2Checkout h2{margin:0 0 8px;font-family:Montserrat;letter-spacing:-.04em}.productionV2Chooser section>span,.productionV2Checkout p{display:block;margin-bottom:18px;color:#6c6670}.productionV2Chooser section>div{display:grid;grid-template-columns:1fr 1fr;gap:12px}.productionV2Card{min-height:105px;padding:18px}.productionV2Card span{display:grid;gap:5px}.productionV2Card small{color:#7a7379}.productionV2Checkout>form{width:min(100%,430px)}.productionV2Checkout label{display:grid;gap:7px;margin:13px 0}.productionV2Checkout label span{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.07em;color:#716a71}.productionV2Checkout input{height:49px;border:1px solid #e5dedd;border-radius:15px;padding:0 14px;font:inherit}.productionV2CheckoutActions{display:grid;grid-template-columns:1fr 1.5fr;gap:10px;margin-top:18px}.productionV2CheckoutActions button{min-height:48px;border-radius:15px;border:1px solid #eadfe3;background:#fff;font-weight:900;cursor:pointer}.productionV2CheckoutActions button[type="submit"]{border:0;background:#25d366;color:#fff}.productionV2Checkout [data-error]{display:block;min-height:18px;margin-top:10px;color:#a1264d;font-weight:850}@media(max-width:760px){.productionV2Nav{grid-template-columns:1fr}.productionV2Nav>small{display:none}.productionV2Chooser section>div{grid-template-columns:1fr}}';document.head.appendChild(style);
  }

  function safeCart(){return typeof cart!=='undefined'&&Array.isArray(cart)?cart:[];}
  function notify(message){if(typeof toast==='function')toast(message);else alert(message);}
  function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
  function digits(value){return String(value||'').replace(/\D/g,'');}
  function positive(value,fallback){const parsed=parseInt(value,10);return Number.isFinite(parsed)&&parsed>0?parsed:fallback;}
  function nonNegative(value,fallback){const parsed=Number(String(value==null?'':value).replace(',','.'));return Number.isFinite(parsed)&&parsed>=0?round(parsed):fallback;}
  function percent(value){const parsed=Number(String(value==null?'':value).replace(',','.'));return Number.isFinite(parsed)&&parsed>=0&&parsed<=100?round(parsed):0;}
  function round(value){return Math.round((Number(value)+Number.EPSILON)*100)/100;}
  function formatPercent(value){return String(round(value)).replace('.',',')+'%';}
  function moneyValue(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function escapeHtml(value){return clean(value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]});}
})();
