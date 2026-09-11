(function(){
  if(window.__ARMAZEM_PRODUCT_SELECTOR_POLISH__==='1')return;
  window.__ARMAZEM_PRODUCT_SELECTOR_POLISH__='1';

  var PRODUCTS=[
    {selector:'[data-workspace="bolinhas"]',key:'50x50',label:'Bolinhas 50x50',icon:'50'},
    {selector:'[data-workspace="painel-150"]',key:'painel-150',label:'Painel 150',icon:'150'},
    {selector:'#productionV2RomanTab',key:'painel-romano',label:'Painel Romano',icon:'1×2'},
    {selector:'#productionV2RetangularTab',key:'retangular-1x2',label:'Painel Retangular',icon:'1×2'}
  ];
  var prices={};
  var loading=false;
  var observerScheduled=false;

  function money(value){
    return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }

  function injectStyle(){
    if(document.getElementById('productSelectorPolishStyle'))return;
    var style=document.createElement('style');
    style.id='productSelectorPolishStyle';
    style.textContent=`
      .productionV2Nav{
        grid-template-columns:minmax(150px,.48fr) minmax(0,1.52fr)!important;
        gap:14px!important;
      }
      .productionV2Tabs{
        display:grid!important;
        grid-template-columns:repeat(4,minmax(0,1fr))!important;
        gap:8px!important;
        overflow:visible!important;
      }
      .productionV2Tab{
        min-width:0!important;
        min-height:66px!important;
        padding:9px 10px!important;
        gap:9px!important;
        align-items:center!important;
      }
      .productionV2Tab span{
        display:grid!important;
        grid-template-rows:auto auto!important;
        gap:4px!important;
        min-width:0!important;
        width:100%!important;
      }
      .productionV2Tab b{
        display:block!important;
        overflow:visible!important;
        text-overflow:clip!important;
        white-space:normal!important;
        overflow-wrap:normal!important;
        word-break:normal!important;
        color:inherit!important;
        font-size:11.5px!important;
        font-weight:950!important;
        line-height:1.12!important;
      }
      .productionV2TabPrice{
        display:block!important;
        margin:0!important;
        color:#6d656c!important;
        font-family:Montserrat,Arial,sans-serif!important;
        font-size:10.5px!important;
        font-weight:900!important;
        line-height:1.1!important;
        white-space:nowrap!important;
      }
      .productionV2Tab.active .productionV2TabPrice{color:#c82f60!important}
      .productionV2Tab[data-price-state="missing"] .productionV2TabPrice{color:#958b92!important;font-weight:800!important}
      .productionV2Tab[data-price-state="disabled"] .productionV2TabPrice{color:#9a8289!important}
      @media(max-width:1100px){
        .productionV2Nav{grid-template-columns:1fr!important;align-items:stretch!important}
        .productionV2Nav>div:first-child{padding:1px 4px 2px!important}
      }
      @media(max-width:760px){
        .productionV2Tabs{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        .productionV2Tab{min-height:64px!important;padding:9px 11px!important}
        .productionV2Tab b{font-size:11.5px!important}
      }
      @media(max-width:390px){
        .productionV2Tabs{gap:6px!important;padding:4px!important}
        .productionV2Tab{min-height:62px!important;padding:8px!important;gap:7px!important}
        .productionV2Tab i{flex-basis:30px!important;width:30px!important;height:30px!important;font-size:9px!important}
        .productionV2Tab b{font-size:10.5px!important}
        .productionV2TabPrice{font-size:9.5px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function productConfig(key){
    var p=prices[key];
    return p&&typeof p==='object'?p:null;
  }

  function buttonFor(item){
    var nodes=document.querySelectorAll(item.selector);
    if(!nodes||!nodes.length)return [];
    return Array.prototype.slice.call(nodes).filter(function(node){
      return !!node.closest('#productionV2Nav');
    });
  }

  function renderButton(button,item){
    var icon=button.querySelector('i');
    if(icon)icon.textContent=item.icon;
    var span=button.querySelector('span');
    if(!span){span=document.createElement('span');button.appendChild(span)}
    var title=span.querySelector('b');
    if(!title){title=document.createElement('b');span.prepend(title)}
    title.textContent=item.label;

    var price=span.querySelector('.productionV2TabPrice');
    if(!price){price=document.createElement('small');price.className='productionV2TabPrice';span.appendChild(price)}

    var cfg=productConfig(item.key);
    var value=cfg?Number(cfg.unitPrice||0):0;
    var enabled=cfg?cfg.enabled!==false:false;
    if(value>0){
      price.textContent=money(value);
      button.dataset.priceState=enabled?'ready':'disabled';
      button.title=item.label+' · '+money(value)+(enabled?'':' · indisponível');
    }else{
      price.textContent='Preço a definir';
      button.dataset.priceState='missing';
      button.title=item.label+' · preço a definir';
    }
  }

  function render(){
    injectStyle();
    PRODUCTS.forEach(function(item){buttonFor(item).forEach(function(button){renderButton(button,item)})});
  }

  async function refreshPrices(){
    if(loading)return;
    loading=true;
    try{
      var response=await fetch('/api/commercial-config?_selector='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json','Cache-Control':'no-store'}});
      var data=await response.json().catch(function(){return{}});
      if(response.ok&&data&&data.ok===true&&data.config&&data.config.products){
        prices=data.config.products;
      }
    }catch(_){}
    finally{loading=false;render()}
  }

  function scheduleRender(){
    if(observerScheduled)return;
    observerScheduled=true;
    requestAnimationFrame(function(){observerScheduled=false;render()});
  }

  injectStyle();
  render();
  refreshPrices();
  new MutationObserver(scheduleRender).observe(document.body,{childList:true,subtree:true});
  setInterval(refreshPrices,30000);
})();
