(function(){
  if(window.__ARMAZEM_DYNAMIC_PRODUCT_COMMERCE_SYNC__==='1')return;
  window.__ARMAZEM_DYNAMIC_PRODUCT_COMMERCE_SYNC__='1';

  var KEYS=['painel-romano','retangular-1x2'];
  var state={
    'painel-romano':{label:'Painel Romano 1x2',unitPrice:78,enabled:true,minimum:1,step:1,initial:1},
    'retangular-1x2':{label:'Painel Retangular',unitPrice:78,enabled:true,minimum:1,step:1,initial:1}
  };
  window.__ARMAZEM_DYNAMIC_PRODUCT_STATE__=state;
  var loading=false;

  function clean(v){return String(v==null?'':v).replace(/\s+/g,' ').trim()}
  function money(v){return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function keyOf(v){return clean(v&&typeof v==='object'?(v.productKey||v.product||v.key):v)}
  function dynamic(v){var k=keyOf(v);return KEYS.indexOf(k)>=0?k:''}
  function notify(msg){try{if(typeof toast==='function')toast(msg);else alert(msg)}catch(_){}}

  function applyProduct(key,p){
    if(!state[key]||!p||typeof p!=='object')return;
    var q=p.quantity&&typeof p.quantity==='object'?p.quantity:{};
    var price=Math.max(0,Number(p.unitPrice||0));
    state[key].label=clean(p.label||state[key].label)||state[key].label;
    state[key].unitPrice=price;
    state[key].enabled=p.enabled!==false&&price>0;
    state[key].minimum=Math.max(1,Number(q.minimum||p.minQty||p.minimum||1));
    state[key].step=Math.max(1,Number(q.step||p.step||1));
    state[key].initial=Math.max(state[key].minimum,Number(q.initial||p.initialQty||p.initial||state[key].minimum));
  }

  async function refresh(){
    if(loading)return state;
    loading=true;
    try{
      var r=await fetch('/api/commercial-config?_dynamicCommerce='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json','Cache-Control':'no-store'}});
      var d=await r.json().catch(function(){return{}});
      var products=d&&d.ok===true&&d.config&&d.config.products?d.config.products:{};
      KEYS.forEach(function(key){applyProduct(key,products[key])});
      refreshVisiblePrices();
      if(typeof renderCart==='function')renderCart();
    }catch(_){}finally{loading=false}
    return state;
  }

  function refreshVisiblePrices(){
    try{
      if(typeof items==='undefined'||!Array.isArray(items))return;
      document.querySelectorAll('.card[data-card]').forEach(function(card){
        var id=card.getAttribute('data-card');
        var item=items.find(function(i){return String(i.id)===String(id)});
        var key=dynamic(item);if(!key)return;
        var price=card.querySelector('.artPrice');
        if(price)price.textContent=state[key].unitPrice>0?money(state[key].unitPrice):'Preço a definir';
      });
    }catch(_){}
  }

  function directAdd(id,key){
    try{
      var source=(typeof items!=='undefined'&&Array.isArray(items)?items:[]).find(function(i){return String(i.id)===String(id)})||((typeof cart!=='undefined'&&Array.isArray(cart))?cart.find(function(i){return String(i.id)===String(id)}):null)||(typeof prev!=='undefined'?prev:null);
      if(!source)return;
      var existing=typeof entry==='function'?entry(id):null;
      if(existing)existing.qty+=1;
      else{
        var newItem=Object.assign({},source,{qty:1,details:Object.assign({},source.details||{})});
        if(typeof ensureDetails==='function')ensureDetails(newItem);
        if(typeof cart!=='undefined'&&Array.isArray(cart))cart.push(newItem);else return;
      }
      if(typeof save==='function')save();
      notify(existing?'Prontinho, adicionamos mais 1 unidade dessa arte.':'Prontinho, essa arte entrou no seu pedido.');
      if(typeof renderItems==='function'&&(typeof view==='undefined'||view==='items'||view==='search'))renderItems();
      if(typeof renderCart==='function')renderCart();
    }catch(e){notify('Não foi possível adicionar essa arte agora.')}
  }

  function hookFunctions(){
    if(typeof artPriceText==='function'&&!artPriceText.__dynamicCommerce){
      var oldArtPriceText=artPriceText;
      var wrappedArt=function(item){var key=dynamic(item);if(key)return state[key].unitPrice>0?money(state[key].unitPrice):'Preço a definir';return oldArtPriceText(item)};
      wrappedArt.__dynamicCommerce=true;artPriceText=wrappedArt;
    }
    if(typeof priceTextFor==='function'&&!priceTextFor.__dynamicCommerce){
      var oldPriceTextFor=priceTextFor;
      var wrappedPriceText=function(item){var key=dynamic(item);if(key)return state[key].unitPrice>0?money(state[key].unitPrice)+' cada':'Preço a definir';return oldPriceTextFor(item)};
      wrappedPriceText.__dynamicCommerce=true;priceTextFor=wrappedPriceText;
    }
    if(typeof productConfig==='function'&&!productConfig.__dynamicCommerce){
      var oldProductConfig=productConfig;
      var wrappedConfig=function(product){var key=dynamic(product);if(key){var p=state[key];return{label:p.label,type:'fixedRectangle',unitPrice:p.unitPrice,baseQty:p.minimum,basePrice:p.minimum*p.unitPrice,afterStep:p.step,initialQuantity:p.initial,checkoutEnabled:p.enabled,fixedWidth:100,fixedHeight:200,fixedSize:'1X2',sizeKey:'100x200'}}return oldProductConfig(product)};
      wrappedConfig.__dynamicCommerce=true;productConfig=wrappedConfig;
    }
    if(typeof price==='function'&&!price.__dynamicCommerce){
      var oldPrice=price;
      var wrappedPrice=function(product,qty,item){var key=dynamic(product)||dynamic(item);if(key)return Math.max(0,Number(qty||0))*Math.max(0,Number(state[key].unitPrice||0));return oldPrice(product,qty,item)};
      wrappedPrice.__dynamicCommerce=true;price=wrappedPrice;
    }
    if(typeof addItem==='function'&&!addItem.__dynamicCommerce){
      var oldAdd=addItem;
      var wrappedAdd=async function(id){
        var source=(typeof items!=='undefined'&&Array.isArray(items)?items:[]).find(function(i){return String(i.id)===String(id)})||((typeof cart!=='undefined'&&Array.isArray(cart))?cart.find(function(i){return String(i.id)===String(id)}):null)||(typeof prev!=='undefined'?prev:null);
        var key=dynamic(source);
        if(!key)return oldAdd(id);
        if(!state[key].enabled||!(state[key].unitPrice>0))await refresh();
        if(!state[key].enabled||!(state[key].unitPrice>0)){notify('Este produto está sem preço ou indisponível no momento.');return}
        return directAdd(id,key);
      };
      wrappedAdd.__dynamicCommerce=true;addItem=wrappedAdd;
    }
    if(typeof cartRule==='function'&&!cartRule.__dynamicCommerce){
      var oldRule=cartRule;
      var wrappedRule=function(){
        var result=oldRule();
        var msg=clean(result&&result.msg);
        var staleKey='';
        if(result&&result.ok===false&&/Painel Romano.*(sem preço|indisponível)/i.test(msg)&&state['painel-romano'].enabled)staleKey='painel-romano';
        if(result&&result.ok===false&&/Painel Retangular.*(sem preço|indisponível)/i.test(msg)&&state['retangular-1x2'].enabled)staleKey='retangular-1x2';
        if(!staleKey)return result;
        if(typeof cart==='undefined'||!Array.isArray(cart))return result;
        var snapshot=cart.slice();
        try{
          var filtered=snapshot.filter(function(i){return dynamic(i)!==staleKey});
          cart.splice.apply(cart,[0,cart.length].concat(filtered));
          var base=oldRule();
          if(base&&base.ok===false)return base;
        }finally{cart.splice.apply(cart,[0,cart.length].concat(snapshot))}
        var p=state[staleKey];
        var invalid=snapshot.filter(function(i){return dynamic(i)===staleKey}).find(function(i){var q=Math.max(1,Number(i.qty||1));return q<p.minimum||(q-p.minimum)%p.step!==0});
        if(invalid)return{ok:false,msg:'Revise a quantidade de '+p.label+'.'};
        return{ok:true,msg:'Perfeito. Sua seleção está pronta para enviar.'};
      };
      wrappedRule.__dynamicCommerce=true;cartRule=wrappedRule;
    }
  }

  function boot(){
    hookFunctions();
    refresh();
    setInterval(function(){hookFunctions();refreshVisiblePrices()},700);
    setInterval(refresh,30000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,0)},{once:true});
  else setTimeout(boot,0);
})();
