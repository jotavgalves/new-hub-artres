(function(){
  if(window.__ARMAZEM_PRODUCT_SELECTOR_POLISH__==='2')return;
  window.__ARMAZEM_PRODUCT_SELECTOR_POLISH__='2';

  var PRODUCTS=[
    {selector:'[data-workspace="bolinhas"]',key:'50x50',label:'Bolinhas 50x50',icon:'50'},
    {selector:'[data-workspace="painel-150"]',key:'painel-150',label:'Painel 150',icon:'150'},
    {selector:'#productionV2RomanTab',key:'painel-romano',label:'Painel Romano',icon:'1×2'},
    {selector:'#productionV2RetangularTab',key:'retangular-1x2',label:'Painel Retangular',icon:'1×2'}
  ];
  var prices={
    'painel-romano':{unitPrice:78,enabled:true},
    'retangular-1x2':{unitPrice:78,enabled:true}
  };
  var loading=false;

  function money(value){return Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
  function setText(node,value){if(node&&node.textContent!==value)node.textContent=value}

  function injectStyle(){
    if(document.getElementById('productSelectorPolishStyle'))return;
    var style=document.createElement('style');
    style.id='productSelectorPolishStyle';
    style.textContent=`
      .productionV2Nav{grid-template-columns:minmax(150px,.48fr) minmax(0,1.52fr)!important;gap:14px!important}
      .productionV2Tabs{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:8px!important;overflow:visible!important}
      .productionV2Tab{min-width:0!important;min-height:66px!important;padding:9px 10px!important;gap:9px!important;align-items:center!important}
      .productionV2Tab span{display:grid!important;grid-template-rows:auto auto!important;gap:4px!important;min-width:0!important;width:100%!important}
      .productionV2Tab b{display:block!important;overflow:visible!important;text-overflow:clip!important;white-space:normal!important;word-break:normal!important;color:inherit!important;font-size:11.5px!important;font-weight:950!important;line-height:1.12!important}
      .productionV2TabPrice{display:block!important;margin:0!important;color:#6d656c!important;font-family:Montserrat,Arial,sans-serif!important;font-size:10.5px!important;font-weight:900!important;line-height:1.1!important;white-space:nowrap!important}
      .productionV2Tab.active .productionV2TabPrice{color:#c82f60!important}
      @media(max-width:1100px){.productionV2Nav{grid-template-columns:1fr!important;align-items:stretch!important}}
      @media(max-width:760px){.productionV2Tabs{grid-template-columns:repeat(2,minmax(0,1fr))!important}.productionV2Tab{min-height:64px!important}}
    `;
    document.head.appendChild(style);
  }

  function renderButton(button,item){
    if(!button)return;
    var icon=button.querySelector('i');setText(icon,item.icon);
    var span=button.querySelector('span');if(!span){span=document.createElement('span');button.appendChild(span)}
    var title=span.querySelector('b');if(!title){title=document.createElement('b');span.prepend(title)}setText(title,item.label);
    var price=span.querySelector('.productionV2TabPrice');if(!price){price=document.createElement('small');price.className='productionV2TabPrice';span.appendChild(price)}
    var cfg=prices[item.key]||null;var value=cfg?Number(cfg.unitPrice||0):0;var enabled=cfg?cfg.enabled!==false:false;
    var text=value>0?money(value):'Preço a definir';setText(price,text);
    var state=value>0?(enabled?'ready':'disabled'):'missing';if(button.dataset.priceState!==state)button.dataset.priceState=state;
    var titleText=item.label+' · '+text+(value>0&&!enabled?' · indisponível':'');if(button.title!==titleText)button.title=titleText;
  }

  function render(){
    injectStyle();
    PRODUCTS.forEach(function(item){document.querySelectorAll(item.selector).forEach(function(button){if(button.closest('#productionV2Nav'))renderButton(button,item)})});
  }

  async function refreshPrices(){
    if(loading)return;loading=true;
    try{
      var response=await fetch('/api/commercial-config?_selector='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{Accept:'application/json','Cache-Control':'no-store'}});
      var data=await response.json().catch(function(){return{}});
      if(response.ok&&data&&data.ok===true&&data.config&&data.config.products)prices=data.config.products;
    }catch(_){}finally{loading=false;render()}
  }

  injectStyle();render();refreshPrices();
  [150,500,1200].forEach(function(ms){setTimeout(render,ms)});
})();
