(function(){
  'use strict';
  if(window.__ARMAZEM_CHECKOUT_V3__)return;
  window.__ARMAZEM_CHECKOUT_V3__='review-customer-processing';

  var CUSTOMER_DRAFT='armazem:production:customer';
  var CHECKOUT_RECOVERY='armazem:production:checkout-recovery-v3';
  var overlay=null;
  var busy=false;
  var pending=null;

  installStyle();
  window.addEventListener('click',interceptCheckout,true);

  function installStyle(){
    if(document.getElementById('checkoutV3Style'))return;
    var style=document.createElement('style');
    style.id='checkoutV3Style';
    style.textContent=`
      .checkoutV3{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(25,23,26,.68);backdrop-filter:blur(10px)}
      .checkoutV3Card{width:min(100%,720px);max-height:min(92vh,880px);overflow:auto;border:1px solid rgba(255,255,255,.8);border-radius:28px;background:#fff;box-shadow:0 32px 110px rgba(0,0,0,.32);animation:checkoutV3In .18s ease-out}
      .checkoutV3Head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:24px 24px 17px;border-bottom:1px solid #f0e7e9}.checkoutV3Eyebrow{display:block;margin:0 0 6px;color:#d9366b;font-size:10px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.checkoutV3Head h2{margin:0;font-family:Montserrat,Arial,sans-serif;font-size:clamp(22px,4vw,30px);line-height:1.08;letter-spacing:-.045em}.checkoutV3Head p{margin:8px 0 0;color:#716a71;font-size:13px;line-height:1.55}.checkoutV3Close{flex:0 0 42px;width:42px;height:42px;border:1px solid #eadfe3;border-radius:999px;background:#fff;color:#625a61;font-size:20px;cursor:pointer}
      .checkoutV3Body{padding:20px 24px 24px}.checkoutV3List{display:grid;gap:10px;max-height:42vh;overflow:auto;padding-right:3px}.checkoutV3Item{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:13px;align-items:center;padding:11px;border:1px solid #eee4e6;border-radius:19px;background:#fffdfd}.checkoutV3Thumb{width:76px;height:76px;object-fit:cover;border-radius:14px;background:linear-gradient(135deg,#fff1f6,#eefdff)}.checkoutV3Info{min-width:0}.checkoutV3Info b{display:block;font-family:Montserrat,Arial,sans-serif;font-size:14px}.checkoutV3Info span,.checkoutV3Info small{display:block;margin-top:4px;color:#766f76;font-size:11.5px;line-height:1.4}.checkoutV3Qty{min-width:48px;padding:8px 9px;border-radius:999px;background:#fff1f6;color:#ca3565;font-size:11px;font-weight:950;text-align:center}
      .checkoutV3Summary{display:grid;grid-template-columns:1fr auto;gap:8px 16px;margin-top:16px;padding:16px;border-radius:19px;background:#faf7f8}.checkoutV3Summary span{color:#756e75;font-size:12px}.checkoutV3Summary strong{font-family:Montserrat,Arial,sans-serif;text-align:right}.checkoutV3Fields{display:grid;gap:13px}.checkoutV3Fields label{display:grid;gap:7px}.checkoutV3Fields label span{font-size:10px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:#716a71}.checkoutV3Fields input{width:100%;height:51px;border:1px solid #e5dedd;border-radius:15px;padding:0 14px;outline:none;font:inherit}.checkoutV3Fields input:focus{border-color:#ef5585;box-shadow:0 0 0 4px rgba(239,85,133,.12)}.checkoutV3Seller{padding:13px 15px;border:1px solid #e7e0e2;border-radius:15px;background:#faf8f8;color:#625b62;font-size:12px}
      .checkoutV3Actions{display:grid;grid-template-columns:minmax(110px,.72fr) minmax(180px,1.28fr);gap:10px;margin-top:18px}.checkoutV3Actions button,.checkoutV3OpenWa{min-height:49px;border-radius:15px;border:1px solid #eadfe3;background:#fff;color:#4f484e;font-weight:950;cursor:pointer}.checkoutV3Actions button[data-primary],.checkoutV3OpenWa{border:0;background:linear-gradient(135deg,#ef5585,#d9366b);color:#fff;box-shadow:0 12px 24px rgba(217,54,107,.2)}.checkoutV3Error{display:block;min-height:19px;margin-top:10px;color:#a1264d;font-size:12px;font-weight:850}
      .checkoutV3Process,.checkoutV3Success{display:grid;place-items:center;min-height:350px;padding:34px;text-align:center}.checkoutV3Spinner{width:58px;height:58px;border:5px solid #f4dfe6;border-top-color:#ef5585;border-radius:999px;animation:checkoutV3Spin .8s linear infinite}.checkoutV3Process h2,.checkoutV3Success h2{margin:22px 0 8px;font-family:Montserrat,Arial,sans-serif;font-size:27px;letter-spacing:-.04em}.checkoutV3Process p,.checkoutV3Success p{max-width:430px;margin:0;color:#716a71;line-height:1.6}.checkoutV3Steps{display:grid;gap:9px;width:min(100%,380px);margin-top:22px;text-align:left}.checkoutV3Step{padding:11px 13px;border-radius:13px;background:#f8f5f6;color:#817980;font-size:12px;font-weight:850}.checkoutV3Step.active{background:#fff1f6;color:#c92d62}.checkoutV3Step.done{background:#eefaf4;color:#167153}.checkoutV3Check{display:grid;place-items:center;width:72px;height:72px;border-radius:999px;background:#eafaf2;color:#18875b;font-size:34px;font-weight:950}.checkoutV3Order{margin:18px 0;padding:11px 16px;border-radius:999px;background:#fff1f6;color:#c82f60;font-family:Montserrat,Arial,sans-serif;font-weight:950}.checkoutV3OpenWa{display:inline-flex;align-items:center;justify-content:center;width:min(100%,360px);text-decoration:none;background:#25d366!important}.checkoutV3Retry{margin-top:11px;border:0;background:transparent;color:#b62d59;font-weight:900;cursor:pointer}.checkoutV3Note{margin-top:13px;color:#8b838a;font-size:11px;line-height:1.5}
      @keyframes checkoutV3Spin{to{transform:rotate(360deg)}}@keyframes checkoutV3In{from{opacity:0;transform:translateY(10px) scale(.985)}}
      @media(max-width:760px){.checkoutV3{padding:0;align-items:end}.checkoutV3Card{width:100%;max-height:94vh;border-radius:26px 26px 0 0}.checkoutV3Head{padding:20px 18px 15px}.checkoutV3Body{padding:16px 18px calc(20px + env(safe-area-inset-bottom))}.checkoutV3Item{grid-template-columns:62px minmax(0,1fr) auto}.checkoutV3Thumb{width:62px;height:62px}.checkoutV3Actions{grid-template-columns:1fr}.checkoutV3Actions button[data-primary]{grid-row:1}.checkoutV3Process,.checkoutV3Success{min-height:430px;padding:28px 20px calc(30px + env(safe-area-inset-bottom))}}
    `;
    document.head.appendChild(style);
  }

  function interceptCheckout(event){
    var link=event.target&&event.target.closest?event.target.closest('a.wa'):null;
    if(!link)return;
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    if(busy)return;
    if(link.classList.contains('disabled'))return notifyUser('Revise o carrinho antes de enviar.');
    var rule=typeof cartRule==='function'?cartRule():{ok:false,msg:'Revise o carrinho.'};
    if(!rule||rule.ok!==true)return notifyUser(rule&&rule.msg||'Revise o carrinho antes de enviar.');
    openReview();
  }

  function openReview(){
    var items=safeCart();
    if(!items.length)return notifyUser('Seu carrinho está vazio.');
    var sellerData=resolveSeller();
    var content='<div class="checkoutV3Head"><div><span class="checkoutV3Eyebrow">1 de 3 · Conferência</span><h2>Confira suas artes</h2><p>Veja cada item antes de registrar. Você ainda pode voltar ao carrinho para alterar quantidades ou medidas.</p></div><button class="checkoutV3Close" type="button" data-close aria-label="Fechar">×</button></div><div class="checkoutV3Body"><div class="checkoutV3List">'+items.map(reviewItem).join('')+'</div><div class="checkoutV3Summary"><span>Vendedora</span><strong>'+escapeHtml(sellerData?sellerData.profile.label:'Não selecionada')+'</strong><span>Quantidade total</span><strong>'+safeQuantity()+' unidade(s)</strong><span>Total</span><strong>'+escapeHtml(safeMoney())+'</strong></div><div class="checkoutV3Actions"><button type="button" data-close>Voltar ao carrinho</button><button type="button" data-primary data-next>Continuar</button></div><small class="checkoutV3Error" data-error></small></div>';
    var root=mount(content);
    root.querySelectorAll('[data-close]').forEach(function(button){button.onclick=close;});
    root.querySelector('[data-next]').onclick=function(){if(!resolveSeller())root.querySelector('[data-error]').textContent='Escolha uma vendedora no carrinho antes de continuar.';else openCustomer();};
  }

  function openCustomer(){
    var draft={};try{draft=JSON.parse(sessionStorage.getItem(CUSTOMER_DRAFT)||'{}')||{};}catch(_){ }
    var sellerData=resolveSeller();
    var content='<div class="checkoutV3Head"><div><span class="checkoutV3Eyebrow">2 de 3 · Identificação</span><h2>Como podemos falar com você?</h2><p>Esses dados identificam o pedido e permitem continuar o atendimento no WhatsApp.</p></div><button class="checkoutV3Close" type="button" data-close aria-label="Fechar">×</button></div><form class="checkoutV3Body" data-form><div class="checkoutV3Fields"><div class="checkoutV3Seller">Atendimento com <strong>'+escapeHtml(sellerData?sellerData.profile.label:'vendedora selecionada')+'</strong></div><label><span>Seu nome</span><input name="customerName" maxlength="160" required autocomplete="name" placeholder="Digite seu nome"></label><label><span>WhatsApp com DDD</span><input name="customerWhatsapp" maxlength="20" required inputmode="tel" autocomplete="tel" placeholder="Ex.: 81999999999"></label></div><div class="checkoutV3Actions"><button type="button" data-back>Voltar</button><button type="submit" data-primary>Registrar pedido</button></div><small class="checkoutV3Error" data-error></small></form>';
    var root=mount(content),form=root.querySelector('[data-form]');
    form.elements.customerName.value=draft.name||'';form.elements.customerWhatsapp.value=draft.whatsapp||'';
    root.querySelector('[data-close]').onclick=close;root.querySelector('[data-back]').onclick=openReview;
    form.onsubmit=function(event){event.preventDefault();prepare(form);};
    setTimeout(function(){(form.elements.customerName.value?form.elements.customerWhatsapp:form.elements.customerName).focus();},0);
  }

  async function prepare(form){
    if(busy)return;
    var error=form.querySelector('[data-error]'),name=clean(form.elements.customerName.value).slice(0,160),whatsapp=digits(form.elements.customerWhatsapp.value).slice(0,20),sellerData=resolveSeller();
    if(!name)return void(error.textContent='Informe seu nome.');
    if(whatsapp.length<10)return void(error.textContent='Informe um WhatsApp válido com DDD.');
    if(!sellerData)return void(error.textContent='Escolha uma vendedora no carrinho.');
    var items=safeCart().map(function(item){return {driveFileId:String(item.driveFileId||item.id||''),productKey:String(item.product||''),variantKey:String(item.variantKey||item.variant||'default'),sizeKey:String(item.sizeKey||item.size||'default'),quantity:Number(item.qty||0),details:item.details&&typeof item.details==='object'?item.details:{}};});
    var intent={seller:{id:sellerData.id,label:sellerData.profile.label},customer:{name:name,whatsapp:whatsapp},items:items};
    try{sessionStorage.setItem(CUSTOMER_DRAFT,JSON.stringify({name:name,whatsapp:whatsapp}));}catch(_){ }
    pending={intent:intent,key:await idempotency(intent),sellerData:sellerData};
    showProcessing();
    submitPending();
  }

  async function submitPending(){
    if(!pending||busy)return;
    busy=true;setStep(0);
    try{
      setStep(1);
      var result=await postWithRetry(pending.intent,pending.key);
      setStep(2);
      var url='https://wa.me/'+digits(pending.sellerData.profile.phone)+'?text='+encodeURIComponent(buildMessage(result.orderNumber));
      if(!/^https:\/\/wa\.me\/\d{10,20}\?text=/.test(url))throw failure('WHATSAPP_URL_INVALIDA',0,'');
      try{sessionStorage.setItem(CHECKOUT_RECOVERY,JSON.stringify({orderNumber:result.orderNumber,url:url,createdAt:Date.now()}));}catch(_){ }
      showSuccess(result.orderNumber,url,result.action);
    }catch(error){showFailure(error);}finally{busy=false;}
  }

  async function postWithRetry(intent,key){
    var last=null;
    for(var attempt=0;attempt<2;attempt+=1){
      var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},22000);
      try{
        var response=await fetch('/api/orders-v2',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json','Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(intent)});
        var data=await response.json().catch(function(){return {};});clearTimeout(timer);
        if(response.ok&&data.ok===true&&data.orderNumber)return {orderNumber:data.orderNumber,action:data.action||'CREATED'};
        var current=failure(data.error||'ORDER_SAVE_FAILED',response.status,data.detail||'');
        if(response.status>=500&&attempt===0){last=current;await delay(650);continue;}
        throw current;
      }catch(error){
        clearTimeout(timer);
        if(error&&error.checkoutCode)throw error;
        last=failure(error&&error.name==='AbortError'?'ORDER_TIMEOUT':'NETWORK_ERROR',0,String(error&&error.message||''));
        if(attempt===0){await delay(650);continue;}
      }
    }
    throw last||failure('ORDER_SAVE_FAILED',0,'');
  }

  function showProcessing(){mount('<div class="checkoutV3Process"><div class="checkoutV3Spinner" aria-hidden="true"></div><h2>Registrando seu pedido</h2><p>Não feche esta tela. Estamos validando as artes e salvando o pedido com segurança.</p><div class="checkoutV3Steps"><div class="checkoutV3Step active" data-step="0">Conferindo os dados</div><div class="checkoutV3Step" data-step="1">Registrando o pedido</div><div class="checkoutV3Step" data-step="2">Preparando o WhatsApp</div></div></div>',false);}
  function setStep(index){if(!overlay)return;overlay.querySelectorAll('[data-step]').forEach(function(step){var value=Number(step.dataset.step);step.classList.toggle('done',value<index);step.classList.toggle('active',value===index);});}
  function showSuccess(orderNumber,url,action){var replay=action==='REPLAY';var root=mount('<div class="checkoutV3Success"><div class="checkoutV3Check">✓</div><h2>Pedido registrado</h2><p>'+(replay?'O pedido já estava salvo e foi recuperado sem duplicidade.':'Seu pedido foi salvo com sucesso.')+'</p><div class="checkoutV3Order">'+escapeHtml(orderNumber)+'</div><a class="checkoutV3OpenWa" href="'+escapeHtml(url)+'" target="_blank" rel="noopener">Abrir WhatsApp</a><button class="checkoutV3Retry" type="button" data-close>Continuar escolhendo artes</button><small class="checkoutV3Note">Se o WhatsApp não abrir, toque novamente no botão verde. O pedido não será registrado outra vez.</small></div>',false);root.querySelector('[data-close]').onclick=close;}
  function showFailure(error){var root=mount('<div class="checkoutV3Head"><div><span class="checkoutV3Eyebrow">Não foi possível concluir</span><h2>O pedido ainda não foi confirmado</h2><p>'+escapeHtml(message(error&&error.checkoutCode,error&&error.detail))+'</p></div><button class="checkoutV3Close" type="button" data-close>×</button></div><div class="checkoutV3Body"><div class="checkoutV3Actions"><button type="button" data-edit>Revisar dados</button><button type="button" data-primary data-retry>Tentar novamente</button></div><small class="checkoutV3Note">A tentativa usa a mesma chave de segurança. Se o servidor já recebeu o pedido, ele será recuperado sem duplicação.</small></div>');root.querySelector('[data-close]').onclick=close;root.querySelector('[data-edit]').onclick=openCustomer;root.querySelector('[data-retry]').onclick=function(){showProcessing();submitPending();};}

  function mount(content,backdrop){close();var root=document.createElement('div');root.className='checkoutV3';root.innerHTML='<section class="checkoutV3Card" role="dialog" aria-modal="true">'+content+'</section>';document.body.appendChild(root);overlay=root;if(backdrop!==false)root.onclick=function(event){if(event.target===root)close();};return root;}
  function close(){if(overlay)overlay.remove();overlay=null;}
  function safeCart(){try{return typeof cart!=='undefined'&&Array.isArray(cart)?cart.slice():[];}catch(_){return [];}}
  function resolveSeller(){try{var id=String((typeof seller!=='undefined'&&seller)||(typeof LOCKED_SELLER!=='undefined'&&LOCKED_SELLER)||''),all=typeof SELLERS!=='undefined'&&SELLERS&&typeof SELLERS==='object'?SELLERS:null;if(!id||!all||!all[id]||!all[id].phone)return null;return {id:id,profile:all[id]};}catch(_){return null;}}
  function reviewItem(item){var details=item&&item.details&&typeof item.details==='object'?item.details:{},measure=clean(details.measurement||details.measurements||details.size||item.size),note=clean(details.observations||details.observation||details.observacao||details.observacoes),extra=[measure?'Medida: '+measure:'',note?'Observação: '+note:''].filter(Boolean).join(' · ');return '<article class="checkoutV3Item"><img class="checkoutV3Thumb" src="'+escapeHtml(item.image||'')+'" alt="Arte #'+escapeHtml(item.code||'')+'"><div class="checkoutV3Info"><b>Arte #'+escapeHtml(item.code||item.id||'')+'</b><span>'+escapeHtml(item.productName||item.product||'Produto')+' · '+escapeHtml(item.theme||'Sem tema')+'</span>'+(extra?'<small>'+escapeHtml(extra.slice(0,240))+'</small>':'')+'</div><div class="checkoutV3Qty">'+Number(item.qty||0)+' un.</div></article>';}
  function safeQuantity(){try{return typeof cartQty==='function'?Number(cartQty()||0):safeCart().reduce(function(sum,item){return sum+Number(item.qty||0);},0);}catch(_){return 0;}}
  function safeMoney(){try{return typeof total==='function'?money(total()):'Calculado no servidor';}catch(_){return 'Calculado no servidor';}}
  function buildMessage(orderNumber){var base='Olá, gostaria de finalizar meu pedido.';try{if(typeof waMsg==='function')base=waMsg();}catch(_){ }return 'Pedido: '+orderNumber+'\n\n'+base;}
  async function idempotency(intent){var canonical=JSON.stringify({day:new Date().toISOString().slice(0,10),seller:intent.seller,customer:intent.customer,items:intent.items.slice().sort(function(a,b){return (a.driveFileId+a.productKey+a.variantKey+a.sizeKey).localeCompare(b.driveFileId+b.productKey+b.variantKey+b.sizeKey);})}),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));return 'pages-v3-'+Array.from(new Uint8Array(digest)).map(function(byte){return byte.toString(16).padStart(2,'0');}).join('').slice(0,56);}
  function failure(code,status,detail){var error=new Error(code);error.checkoutCode=code;error.status=status;error.detail=String(detail||'').slice(0,220);return error;}
  function message(code,detail){var messages={ARTE_NAO_ENCONTRADA:'Uma arte do carrinho não está mais disponível. Volte ao carrinho, remova essa arte e escolha novamente.',ARTE_PRODUTO_INCOMPATIVEL:'Uma arte não pertence ao produto selecionado. Volte ao carrinho e adicione novamente.',PRODUTO_INDISPONIVEL:'Um produto do carrinho está temporariamente indisponível.',QUANTIDADE_BOLINHAS_INVALIDA:'Revise a quantidade de Bolinhas.',QUANTIDADE_PAINEL_150_INVALIDA:'Revise a quantidade do Painel 150.',WHATSAPP_CLIENTE_INVALIDO:'Informe um WhatsApp válido com DDD.',NOME_CLIENTE_OBRIGATORIO:'Informe seu nome.',VENDEDORA_OBRIGATORIA:'Escolha uma vendedora no carrinho.',ORDER_TIMEOUT:'A conexão demorou mais que o esperado. Tente novamente com segurança.',NETWORK_ERROR:'A internet oscilou durante o registro. Verifique a conexão e tente novamente.',ORDER_SAVE_FAILED:'O servidor não conseguiu salvar o pedido agora. Tente novamente.',ORDER_V2_FAILED:'O servidor encontrou uma falha ao registrar o pedido.'};return messages[code]||clean(detail)||'Não foi possível registrar o pedido. Revise os dados e tente novamente.';}
  function notifyUser(text){try{if(typeof toast==='function')toast(text);else alert(text);}catch(_){alert(text);}}
  function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
  function digits(value){return String(value||'').replace(/\D/g,'');}
  function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function escapeHtml(value){return clean(value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
  function delay(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
})();
