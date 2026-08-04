(function(){
  'use strict';
  if(window.__ARMAZEM_PRODUCTION_CHECKOUT_FLOW__)return;
  window.__ARMAZEM_PRODUCTION_CHECKOUT_FLOW__='2026-08-04.1';

  var CUSTOMER_DRAFT='armazem:production:customer';
  var ACCEPTED_ORDER='armazem:production:accepted-order-v2';
  var ACCEPTED_TTL=12*60*60*1000;
  var overlay=null;
  var step='review';
  var submission=null;
  var busy=false;

  installStyle();
  window.addEventListener('click',interceptCheckout,true);
  document.documentElement.dataset.productionCheckoutFlow='review-customer-register-v1';

  function interceptCheckout(event){
    var anchor=event.target&&event.target.closest&&event.target.closest('a.wa');
    if(!anchor)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(anchor.classList.contains('disabled')){notify('Revise o carrinho antes de enviar.');return;}
    var rule=typeof cartRule==='function'?cartRule():{ok:false,msg:'Revise o carrinho.'};
    if(!rule||rule.ok!==true){notify(rule&&rule.msg||'Revise o carrinho antes de enviar.');return;}
    var snapshot=createSnapshot();
    if(!snapshot.items.length){notify('Seu carrinho está vazio.');return;}
    submission={snapshot:snapshot,customer:readDraft(),idempotencyKey:'',accepted:null,whatsappUrl:''};
    showReview();
  }

  function createSnapshot(){
    var source=typeof cart!=='undefined'&&Array.isArray(cart)?cart:[];
    var sellerId=String((typeof seller!=='undefined'&&seller)||(typeof LOCKED_SELLER!=='undefined'&&LOCKED_SELLER)||'');
    var sellers=typeof SELLERS!=='undefined'&&SELLERS?SELLERS:{};
    var profile=sellers[sellerId]||null;
    var items=source.map(function(item,index){
      var details=item&&item.details&&typeof item.details==='object'?clone(item.details):{};
      return {
        index:index,
        driveFileId:String(item&&item.driveFileId||item&&item.id||''),
        productKey:String(item&&item.product||''),
        productName:clean(item&&item.productName||productLabel(item&&item.product)),
        code:clean(item&&item.code||''),
        theme:clean(item&&item.theme||'Sem tema'),
        quantity:Math.max(1,parseInt(item&&item.qty,10)||1),
        image:safeImage(item&&item.image),
        details:details,
        measurement:measurementText(item,details),
        observation:observationText(item,details)
      };
    }).filter(function(item){return item.driveFileId&&item.productKey&&item.code;});
    return {
      sellerId:sellerId,
      seller:profile?{id:sellerId,label:clean(profile.label||sellerId),phone:digits(profile.phone)}:null,
      items:items,
      total:typeof total==='function'?Number(total()||0):0,
      gross:typeof gross==='function'?Number(gross()||0):0,
      discount:typeof discount==='function'?Number(discount()||0):0,
      createdAt:new Date().toISOString()
    };
  }

  function showReview(){
    step='review';
    ensureOverlay();
    var snapshot=submission.snapshot;
    overlay.innerHTML='<section class="checkoutFlowCard checkoutFlowReview" role="dialog" aria-modal="true" aria-labelledby="checkoutFlowTitle">'+
      progress(1)+
      '<header class="checkoutFlowHeader"><div><span class="checkoutFlowEyebrow">Antes de registrar</span><h2 id="checkoutFlowTitle">Confira suas artes</h2><p>Veja cada item, quantidade e produto. Você ainda pode voltar ao carrinho para alterar.</p></div><button type="button" class="checkoutFlowClose" data-close aria-label="Fechar">×</button></header>'+
      '<div class="checkoutFlowItems">'+snapshot.items.map(reviewItem).join('')+'</div>'+
      totalsMarkup(snapshot)+
      '<footer class="checkoutFlowActions"><button type="button" class="checkoutFlowSecondary" data-close>Voltar ao carrinho</button><button type="button" class="checkoutFlowPrimary" data-next>Continuar</button></footer>'+
    '</section>';
    bindCommon();
    overlay.querySelector('[data-next]').onclick=showCustomer;
    focusHeading();
  }

  function reviewItem(item){
    var meta=[item.productName,item.theme,item.measurement,item.observation].filter(Boolean);
    return '<article class="checkoutFlowItem">'+
      '<div class="checkoutFlowThumb">'+(item.image?'<img src="'+escapeHtml(item.image)+'" alt="Arte código '+escapeHtml(item.code)+'" loading="lazy">':'<span>Sem imagem</span>')+'</div>'+
      '<div class="checkoutFlowItemInfo"><div class="checkoutFlowItemTop"><strong>Arte #'+escapeHtml(item.code)+'</strong><b>'+item.quantity+' un.</b></div><div class="checkoutFlowMeta">'+meta.map(function(value){return '<span>'+escapeHtml(value)+'</span>';}).join('')+'</div></div>'+
    '</article>';
  }

  function totalsMarkup(snapshot){
    var discount=Number(snapshot.discount||0);
    return '<aside class="checkoutFlowTotals">'+
      '<div><span>'+snapshot.items.length+' arte(s) selecionada(s)</span><strong>'+snapshot.items.reduce(function(sum,item){return sum+item.quantity;},0)+' unidade(s)</strong></div>'+
      (discount>0?'<div><span>Desconto</span><strong>- '+money(discount)+'</strong></div>':'')+
      '<div class="checkoutFlowGrand"><span>Total</span><strong>'+money(snapshot.total)+'</strong></div>'+
    '</aside>';
  }

  function showCustomer(){
    step='customer';
    ensureOverlay();
    var draft=submission.customer||{};
    overlay.innerHTML='<form class="checkoutFlowCard checkoutFlowCustomer" role="dialog" aria-modal="true" aria-labelledby="checkoutFlowTitle">'+
      progress(2)+
      '<header class="checkoutFlowHeader"><div><span class="checkoutFlowEyebrow">Identificação</span><h2 id="checkoutFlowTitle">Como podemos falar com você?</h2><p>Esses dados ficam vinculados ao pedido para a vendedora localizar seu atendimento.</p></div><button type="button" class="checkoutFlowClose" data-close aria-label="Fechar">×</button></header>'+
      '<div class="checkoutFlowFields"><label><span>Seu nome</span><input name="name" maxlength="160" required autocomplete="name" placeholder="Digite seu nome completo"></label><label><span>WhatsApp com DDD</span><input name="whatsapp" maxlength="20" required inputmode="tel" autocomplete="tel" placeholder="(81) 99999-9999"></label></div>'+
      '<p class="checkoutFlowError" data-error role="alert"></p>'+
      '<footer class="checkoutFlowActions"><button type="button" class="checkoutFlowSecondary" data-back>Voltar</button><button type="submit" class="checkoutFlowPrimary">Registrar pedido</button></footer>'+
    '</form>';
    bindCommon();
    var form=overlay.querySelector('form');
    form.elements.name.value=draft.name||'';
    form.elements.whatsapp.value=formatPhone(draft.whatsapp||'');
    form.elements.whatsapp.addEventListener('input',function(){this.value=formatPhone(this.value);});
    overlay.querySelector('[data-back]').onclick=showReview;
    form.onsubmit=beginRegistration;
    setTimeout(function(){(form.elements.name.value?form.elements.whatsapp:form.elements.name).focus();},0);
  }

  async function beginRegistration(event){
    event.preventDefault();
    if(busy)return;
    var form=event.currentTarget;
    var error=form.querySelector('[data-error]');
    var name=clean(form.elements.name.value).slice(0,160);
    var whatsapp=normalizeBrazilPhone(form.elements.whatsapp.value);
    if(!name){error.textContent='Informe seu nome.';form.elements.name.focus();return;}
    if(!whatsapp){error.textContent='Informe um WhatsApp válido com DDD.';form.elements.whatsapp.focus();return;}
    if(!submission.snapshot.seller){error.textContent='Escolha uma vendedora antes de continuar.';return;}
    submission.customer={name:name,whatsapp:whatsapp};
    writeDraft(submission.customer);
    var intent=createIntent(submission.snapshot,submission.customer);
    submission.intent=intent;
    try{submission.idempotencyKey=await idempotency(intent);}catch(_){error.textContent='Seu navegador não conseguiu preparar o pedido. Recarregue a página e tente novamente.';return;}
    showRegistering('Validando suas artes','Estamos conferindo produtos e quantidades antes de gravar o pedido.');
    await submitIntent();
  }

  function createIntent(snapshot,customer){
    return {
      seller:{id:snapshot.seller.id,label:snapshot.seller.label},
      customer:{name:customer.name,whatsapp:customer.whatsapp},
      items:snapshot.items.map(function(item){return {driveFileId:item.driveFileId,productKey:item.productKey,quantity:item.quantity};})
    };
  }

  async function submitIntent(){
    if(busy)return;
    busy=true;
    updateRegistering('Registrando seu pedido','Não feche esta tela. Estamos salvando sua seleção com segurança.');
    try{
      var response=await fetch('/api/orders-v2',{
        method:'POST',
        credentials:'same-origin',
        headers:{Accept:'application/json','Content-Type':'application/json','Idempotency-Key':submission.idempotencyKey},
        body:JSON.stringify(submission.intent)
      });
      var data=await response.json().catch(function(){return {};});
      if(!response.ok||data.ok!==true||!data.orderNumber){
        var failure=new Error(data.error||'ORDER_SAVE_FAILED');failure.status=response.status;throw failure;
      }
      updateRegistering('Pedido registrado','Agora estamos preparando a conversa no WhatsApp.');
      submission.accepted={orderNumber:String(data.orderNumber),action:String(data.action||'CREATED')};
      submission.whatsappUrl=createWhatsappUrl(submission.snapshot,submission.accepted.orderNumber);
      persistAccepted(submission.accepted.orderNumber,submission.whatsappUrl,submission.idempotencyKey);
      showSuccess();
    }catch(error){
      showFailure(error);
    }finally{
      busy=false;
    }
  }

  function showRegistering(title,text){
    step='registering';
    ensureOverlay();
    overlay.innerHTML='<section class="checkoutFlowCard checkoutFlowStatus" role="dialog" aria-modal="true" aria-labelledby="checkoutFlowTitle" aria-live="polite">'+
      progress(3)+
      '<div class="checkoutFlowSpinner" aria-hidden="true"><i></i><i></i><i></i></div>'+
      '<span class="checkoutFlowEyebrow">Registro seguro</span><h2 id="checkoutFlowTitle" data-status-title>'+escapeHtml(title)+'</h2><p data-status-text>'+escapeHtml(text)+'</p><div class="checkoutFlowStatusBar"><span></span></div><small>Uma nova tentativa usará a mesma identificação e não deverá duplicar o pedido.</small>'+
    '</section>';
    focusHeading();
  }

  function updateRegistering(title,text){
    if(!overlay||step!=='registering')return;
    var titleNode=overlay.querySelector('[data-status-title]');
    var textNode=overlay.querySelector('[data-status-text]');
    if(titleNode)titleNode.textContent=title;
    if(textNode)textNode.textContent=text;
  }

  function showSuccess(){
    step='success';
    ensureOverlay();
    var number=submission.accepted.orderNumber;
    overlay.innerHTML='<section class="checkoutFlowCard checkoutFlowStatus checkoutFlowSuccess" role="dialog" aria-modal="true" aria-labelledby="checkoutFlowTitle">'+
      progress(3)+
      '<div class="checkoutFlowSuccessIcon" aria-hidden="true">✓</div><span class="checkoutFlowEyebrow">Tudo certo</span><h2 id="checkoutFlowTitle">Pedido registrado</h2><p>Seu pedido <strong>'+escapeHtml(number)+'</strong> já foi salvo. Agora abra o WhatsApp para falar com a vendedora.</p>'+
      '<div class="checkoutFlowOrderNumber"><span>Número do pedido</span><strong>'+escapeHtml(number)+'</strong></div>'+
      '<footer class="checkoutFlowActions checkoutFlowActionsStack"><button type="button" class="checkoutFlowWhatsapp" data-open-whatsapp>Abrir WhatsApp</button><button type="button" class="checkoutFlowSecondary" data-close>Fechar</button></footer><small>Se o WhatsApp não abrir, o pedido continua registrado e este botão pode ser usado novamente.</small>'+
    '</section>';
    bindCommon();
    overlay.querySelector('[data-open-whatsapp]').onclick=openAcceptedWhatsapp;
    focusHeading();
  }

  function openAcceptedWhatsapp(){
    var url=submission&&submission.whatsappUrl||readAcceptedUrl();
    if(!validWhatsappUrl(url)){showPostAcceptanceFailure();return;}
    var opened=null;
    try{opened=window.open(url,'_blank','noopener');}catch(_){ }
    if(!opened){try{location.assign(url);}catch(_){showPostAcceptanceFailure();}}
  }

  function showPostAcceptanceFailure(){
    if(!submission||!submission.accepted)return;
    step='success';
    ensureOverlay();
    var number=submission.accepted.orderNumber;
    overlay.innerHTML='<section class="checkoutFlowCard checkoutFlowStatus" role="dialog" aria-modal="true" aria-labelledby="checkoutFlowTitle">'+
      '<div class="checkoutFlowWarningIcon" aria-hidden="true">!</div><span class="checkoutFlowEyebrow">Pedido salvo</span><h2 id="checkoutFlowTitle">O WhatsApp não abriu</h2><p>O pedido <strong>'+escapeHtml(number)+'</strong> está registrado. Nenhum novo pedido será criado ao tentar abrir o WhatsApp novamente.</p>'+
      '<footer class="checkoutFlowActions checkoutFlowActionsStack"><button type="button" class="checkoutFlowWhatsapp" data-open-whatsapp>Tentar abrir novamente</button><button type="button" class="checkoutFlowSecondary" data-close>Fechar</button></footer>'+
    '</section>';
    bindCommon();overlay.querySelector('[data-open-whatsapp]').onclick=openAcceptedWhatsapp;focusHeading();
  }

  function showFailure(error){
    step='failure';
    ensureOverlay();
    var message=checkoutMessage(error&&error.message,error&&error.status);
    overlay.innerHTML='<section class="checkoutFlowCard checkoutFlowStatus checkoutFlowFailure" role="dialog" aria-modal="true" aria-labelledby="checkoutFlowTitle">'+
      '<div class="checkoutFlowWarningIcon" aria-hidden="true">!</div><span class="checkoutFlowEyebrow">Não concluído</span><h2 id="checkoutFlowTitle">Não conseguimos confirmar o registro</h2><p>'+escapeHtml(message)+'</p><div class="checkoutFlowHelp">Sua seleção e seus dados foram mantidos. Ao tentar novamente, usaremos a mesma chave de segurança para recuperar o pedido caso ele já tenha sido salvo.</div>'+
      '<footer class="checkoutFlowActions"><button type="button" class="checkoutFlowSecondary" data-back>Revisar dados</button><button type="button" class="checkoutFlowPrimary" data-retry>Tentar novamente</button></footer>'+
    '</section>';
    bindCommon();
    overlay.querySelector('[data-back]').onclick=showCustomer;
    overlay.querySelector('[data-retry]').onclick=function(){showRegistering('Verificando a tentativa anterior','Vamos recuperar o pedido se ele já tiver sido salvo, sem criar outro.');submitIntent();};
    focusHeading();
  }

  function createWhatsappUrl(snapshot,orderNumber){
    var phone=digits(snapshot.seller&&snapshot.seller.phone);
    if(phone.length<10)return '';
    var base=typeof waMsg==='function'?String(waMsg()||''):'Olá, gostaria de finalizar meu pedido.';
    var message='Pedido: '+orderNumber+'\n\n'+base;
    return 'https://wa.me/'+phone+'?text='+encodeURIComponent(message);
  }

  async function idempotency(intent){
    var canonical=JSON.stringify({seller:intent.seller,customer:intent.customer,items:intent.items.slice().sort(function(a,b){return (a.driveFileId+':'+a.productKey).localeCompare(b.driveFileId+':'+b.productKey);})});
    var digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
    return 'pages-v2-'+Array.from(new Uint8Array(digest)).map(function(byte){return byte.toString(16).padStart(2,'0');}).join('').slice(0,56);
  }

  function persistAccepted(orderNumber,url,key){
    if(!validWhatsappUrl(url))return;
    try{sessionStorage.setItem(ACCEPTED_ORDER,JSON.stringify({orderNumber:orderNumber,url:url,key:key,createdAt:Date.now()}));}catch(_){ }
  }

  function readAcceptedUrl(){
    try{
      var value=JSON.parse(sessionStorage.getItem(ACCEPTED_ORDER)||'null');
      if(!value||Date.now()-Number(value.createdAt||0)>ACCEPTED_TTL||!validWhatsappUrl(value.url)){sessionStorage.removeItem(ACCEPTED_ORDER);return '';}
      return value.url;
    }catch(_){return '';}
  }

  function validWhatsappUrl(value){
    try{var url=new URL(String(value||''));return url.protocol==='https:'&&url.hostname==='wa.me'&&/^\/\d{10,20}$/.test(url.pathname)&&url.searchParams.has('text');}catch(_){return false;}
  }

  function ensureOverlay(){
    if(!overlay){overlay=document.createElement('div');overlay.className='checkoutFlowOverlay';document.body.appendChild(overlay);}
    overlay.classList.add('show');
    document.documentElement.classList.add('checkoutFlowOpen');
  }

  function bindCommon(){
    overlay.querySelectorAll('[data-close]').forEach(function(button){button.onclick=closeFlow;});
    overlay.onclick=function(event){if(event.target===overlay&&step!=='registering')closeFlow();};
  }

  function closeFlow(){if(busy||step==='registering')return;if(overlay)overlay.remove();overlay=null;document.documentElement.classList.remove('checkoutFlowOpen');}
  function focusHeading(){setTimeout(function(){var heading=overlay&&overlay.querySelector('h2');if(heading){heading.setAttribute('tabindex','-1');heading.focus();}},0);}

  function progress(active){
    return '<nav class="checkoutFlowProgress" aria-label="Etapas da finalização"><span class="'+(active>=1?'active':'')+'"><i>1</i>Conferir</span><b></b><span class="'+(active>=2?'active':'')+'"><i>2</i>Seus dados</span><b></b><span class="'+(active>=3?'active':'')+'"><i>3</i>Registrar</span></nav>';
  }

  function measurementText(item,details){
    var explicit=details.measurements||item&&item.measurements||details.medidas;
    if(typeof explicit==='string')return clean(explicit);
    var values=[];
    if(details.diameter)values.push('Diâmetro '+clean(details.diameter)+' cm');
    if(details.width&&details.height)values.push(clean(details.width)+' × '+clean(details.height)+' '+clean(details.unit||'cm'));
    if(details.size)values.push('Tamanho '+clean(details.size));
    if(details.unknown)values.push('Medida a confirmar');
    return values.join(' · ');
  }

  function observationText(item,details){return clean(details.observations||details.observation||details.observacoes||details.observacao||item&&item.observations||'');}
  function productLabel(key){return key==='50x50'?'Bolinhas 50x50':key==='painel-150'?'Painel 150 cm':clean(key);}
  function safeImage(value){var text=String(value||'').trim();return /^(https?:|\/)/i.test(text)?text.slice(0,1200):'';}
  function readDraft(){try{var value=JSON.parse(sessionStorage.getItem(CUSTOMER_DRAFT)||'{}');return value&&typeof value==='object'?value:{};}catch(_){return {};}}
  function writeDraft(value){try{sessionStorage.setItem(CUSTOMER_DRAFT,JSON.stringify(value));}catch(_){ }}
  function normalizeBrazilPhone(value){var number=digits(value);if(number.indexOf('55')===0&&number.length>=12)number=number.slice(2);if(number.length===10||number.length===11)return '55'+number;return '';}
  function formatPhone(value){var number=digits(value);if(number.indexOf('55')===0&&number.length>11)number=number.slice(2);number=number.slice(0,11);if(number.length<=2)return number;if(number.length<=6)return '('+number.slice(0,2)+') '+number.slice(2);if(number.length<=10)return '('+number.slice(0,2)+') '+number.slice(2,6)+'-'+number.slice(6);return '('+number.slice(0,2)+') '+number.slice(2,7)+'-'+number.slice(7);}
  function checkoutMessage(code,status){
    var messages={ARTE_NAO_ENCONTRADA:'Uma arte do carrinho não está mais disponível. Volte ao carrinho, remova essa arte e escolha outra.',ARTE_PRODUTO_INCOMPATIVEL:'Uma arte não corresponde ao produto indicado. Volte ao carrinho e selecione novamente.',PRODUTO_INDISPONIVEL:'Um produto do carrinho está temporariamente indisponível.',QUANTIDADE_BOLINHAS_INVALIDA:'Revise a quantidade de Bolinhas antes de registrar.',QUANTIDADE_PAINEL_150_INVALIDA:'Revise a quantidade do Painel 150 antes de registrar.',WHATSAPP_CLIENTE_INVALIDO:'Informe um WhatsApp válido com DDD.',NOME_CLIENTE_OBRIGATORIO:'Informe seu nome.',VENDEDORA_OBRIGATORIA:'Escolha uma vendedora.',CARRINHO_VAZIO_OU_INVALIDO:'O carrinho não contém itens válidos para registro.'};
    if(messages[code])return messages[code];
    if(status===429)return 'Muitas tentativas foram feitas em pouco tempo. Aguarde um instante e tente novamente.';
    if(status>=500||!status)return 'Houve uma falha de conexão ou do servidor. Tente novamente para recuperar o pedido com segurança.';
    return 'Revise os dados e tente registrar novamente.';
  }
  function notify(message){if(typeof toast==='function')toast(message);else alert(message);}
  function clone(value){try{return JSON.parse(JSON.stringify(value));}catch(_){return {};}}
  function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
  function digits(value){return String(value||'').replace(/\D/g,'');}
  function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}

  function installStyle(){
    if(document.getElementById('productionCheckoutFlowStyle'))return;
    var style=document.createElement('style');style.id='productionCheckoutFlowStyle';style.textContent=`
      html.checkoutFlowOpen{overflow:hidden!important}.checkoutFlowOverlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(28,25,29,.68);backdrop-filter:blur(12px);overflow:auto}.checkoutFlowCard{width:min(100%,760px);max-height:min(92vh,900px);overflow:auto;padding:26px;border:1px solid rgba(255,255,255,.75);border-radius:30px;background:#fffdfc;box-shadow:0 34px 110px rgba(0,0,0,.32);color:#2a272b}.checkoutFlowHeader{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin:20px 0}.checkoutFlowHeader h2,.checkoutFlowStatus h2{margin:4px 0 8px;font:900 clamp(25px,4vw,36px)/1.05 Montserrat,Arial,sans-serif;letter-spacing:-.045em}.checkoutFlowHeader p,.checkoutFlowStatus>p{margin:0;color:#716a71;line-height:1.55}.checkoutFlowEyebrow{display:block;color:#d9366b;font-size:10px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}.checkoutFlowClose{flex:0 0 42px;width:42px;height:42px;border:1px solid #eadfe3;border-radius:999px;background:#fff;color:#655e65;font-size:25px;cursor:pointer}.checkoutFlowProgress{display:grid;grid-template-columns:auto 1fr auto 1fr auto;align-items:center;gap:8px;color:#989097;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.05em}.checkoutFlowProgress span{display:flex;align-items:center;gap:6px;white-space:nowrap}.checkoutFlowProgress i{display:grid;place-items:center;width:24px;height:24px;border-radius:999px;background:#f1ecee;color:#817980;font-style:normal}.checkoutFlowProgress span.active{color:#d9366b}.checkoutFlowProgress span.active i{background:#ef5585;color:#fff}.checkoutFlowProgress b{height:2px;background:#efe7e9;border-radius:999px}.checkoutFlowItems{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;max-height:380px;overflow:auto;padding:2px}.checkoutFlowItem{display:grid;grid-template-columns:92px minmax(0,1fr);gap:13px;padding:11px;border:1px solid #eee4e6;border-radius:20px;background:#fff;box-shadow:0 10px 25px rgba(34,33,36,.045)}.checkoutFlowThumb{width:92px;aspect-ratio:1;border-radius:15px;overflow:hidden;display:grid;place-items:center;background:#f7f2f4;color:#8c848b;font-size:10px;text-align:center}.checkoutFlowThumb img{width:100%;height:100%;object-fit:cover}.checkoutFlowItemInfo{min-width:0}.checkoutFlowItemTop{display:flex;justify-content:space-between;gap:8px;align-items:center;margin:3px 0 10px}.checkoutFlowItemTop strong{font:900 14px Montserrat,Arial,sans-serif}.checkoutFlowItemTop b{flex:0 0 auto;padding:5px 8px;border-radius:999px;background:#fff1f6;color:#d9366b;font-size:10px}.checkoutFlowMeta{display:flex;flex-wrap:wrap;gap:5px}.checkoutFlowMeta span{max-width:100%;overflow:hidden;text-overflow:ellipsis;padding:5px 7px;border-radius:999px;background:#f6f2f3;color:#756e74;font-size:9.5px;font-weight:800}.checkoutFlowTotals{margin-top:16px;padding:15px 17px;border-radius:20px;background:#f9f5f6}.checkoutFlowTotals>div{display:flex;justify-content:space-between;gap:14px;padding:5px 0;color:#716a71}.checkoutFlowTotals strong{color:#302c31}.checkoutFlowTotals .checkoutFlowGrand{margin-top:5px;padding-top:12px;border-top:1px solid #e8dfe2;font-size:17px}.checkoutFlowTotals .checkoutFlowGrand strong{color:#d9366b;font:950 20px Montserrat,Arial,sans-serif}.checkoutFlowActions{display:grid;grid-template-columns:1fr 1.35fr;gap:10px;margin-top:18px}.checkoutFlowActions button{min-height:50px;padding:0 16px;border-radius:16px;font:900 13px Montserrat,Arial,sans-serif;cursor:pointer}.checkoutFlowSecondary{border:1px solid #e5dce0;background:#fff;color:#625b62}.checkoutFlowPrimary{border:0;background:linear-gradient(135deg,#ef5585,#d9366b);color:#fff;box-shadow:0 13px 28px rgba(239,85,133,.22)}.checkoutFlowCustomer{width:min(100%,520px)}.checkoutFlowFields{display:grid;gap:14px}.checkoutFlowFields label{display:grid;gap:7px}.checkoutFlowFields label span{color:#6f686f;font-size:10px;font-weight:950;letter-spacing:.08em;text-transform:uppercase}.checkoutFlowFields input{height:52px;border:1px solid #e4dade;border-radius:16px;padding:0 15px;background:#fff;font:700 15px inherit;outline:none}.checkoutFlowFields input:focus{border-color:#ef8dad;box-shadow:0 0 0 4px rgba(239,85,133,.10)}.checkoutFlowError{min-height:20px;margin:10px 0 0;color:#a52650;font-size:12px;font-weight:850}.checkoutFlowStatus{width:min(100%,520px);text-align:center;padding:34px}.checkoutFlowSpinner{height:94px;display:flex;align-items:center;justify-content:center;gap:8px}.checkoutFlowSpinner i{width:16px;height:16px;border-radius:999px;background:#ef5585;animation:checkoutFlowBounce 1s infinite ease-in-out}.checkoutFlowSpinner i:nth-child(2){animation-delay:.14s;background:#38bae3}.checkoutFlowSpinner i:nth-child(3){animation-delay:.28s;background:#f7d240}@keyframes checkoutFlowBounce{0%,80%,100%{transform:scale(.55);opacity:.45}40%{transform:scale(1);opacity:1}}.checkoutFlowStatusBar{height:7px;margin:24px 0 14px;border-radius:999px;background:#f1eaec;overflow:hidden}.checkoutFlowStatusBar span{display:block;width:42%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ef5585,#38bae3);animation:checkoutFlowProgress 1.25s infinite ease-in-out}@keyframes checkoutFlowProgress{0%{transform:translateX(-110%)}100%{transform:translateX(340%)}}.checkoutFlowStatus small{display:block;color:#918991;line-height:1.5}.checkoutFlowSuccessIcon,.checkoutFlowWarningIcon{display:grid;place-items:center;width:78px;height:78px;margin:12px auto 18px;border-radius:999px;background:#eafaf1;color:#128c49;font:950 38px Montserrat,Arial,sans-serif}.checkoutFlowWarningIcon{background:#fff4e8;color:#b8672f}.checkoutFlowOrderNumber{display:grid;gap:5px;margin:22px 0;padding:16px;border:1px solid #e7dee1;border-radius:18px;background:#fff}.checkoutFlowOrderNumber span{color:#817980;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.checkoutFlowOrderNumber strong{font:950 22px Montserrat,Arial,sans-serif}.checkoutFlowActionsStack{grid-template-columns:1fr}.checkoutFlowWhatsapp{border:0;background:#25d366;color:#fff;box-shadow:0 13px 28px rgba(37,211,102,.22)}.checkoutFlowHelp{margin:20px 0;padding:13px;border-radius:16px;background:#fff6ed;color:#7b5a43;font-size:12px;line-height:1.5;text-align:left}@media(max-width:680px){.checkoutFlowOverlay{padding:0;align-items:end}.checkoutFlowCard{width:100%;max-height:94vh;border-radius:28px 28px 0 0;padding:20px}.checkoutFlowItems{grid-template-columns:1fr;max-height:42vh}.checkoutFlowItem{grid-template-columns:76px minmax(0,1fr)}.checkoutFlowThumb{width:76px}.checkoutFlowProgress{font-size:8px}.checkoutFlowProgress span{gap:4px}.checkoutFlowProgress i{width:21px;height:21px}.checkoutFlowActions{grid-template-columns:1fr}.checkoutFlowHeader h2,.checkoutFlowStatus h2{font-size:26px}}
    `;document.head.appendChild(style);
  }
})();
