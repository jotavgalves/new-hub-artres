(function(){
  if(window.__ARMAZEM_PRODUCTION_V2_COMPAT__)return;
  window.__ARMAZEM_PRODUCTION_V2_COMPAT__='2';

  var DEFAULT_PRODUCT='bolinhas';
  var bootstrapped=false;
  var scheduled=false;

  function injectProductStyle(){
    if(document.getElementById('productionV2UxFixStyle'))return;
    var style=document.createElement('style');
    style.id='productionV2UxFixStyle';
    style.textContent=`
      .productionV2Chooser{display:none!important}
      .productionV2Nav{
        display:grid!important;
        grid-template-columns:minmax(150px,.62fr) minmax(300px,1.38fr)!important;
        gap:14px!important;
        align-items:center!important;
        margin:0 0 18px!important;
        padding:13px!important;
        border:1px solid #eadfe3!important;
        border-radius:22px!important;
        background:linear-gradient(135deg,#fff,#fffafd)!important;
        box-shadow:0 12px 32px rgba(34,33,36,.055)!important;
      }
      .productionV2Nav>div:first-child{display:grid!important;gap:2px!important;padding-left:4px!important}
      .productionV2Nav>div:first-child span{
        color:#9b8f97!important;
        font-size:9px!important;
        font-weight:950!important;
        letter-spacing:.11em!important;
      }
      .productionV2Nav>div:first-child strong{
        color:#282429!important;
        font-family:Montserrat,Arial,sans-serif!important;
        font-size:14px!important;
        letter-spacing:-.025em!important;
      }
      .productionV2Tabs{
        display:grid!important;
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        gap:9px!important;
        padding:4px!important;
        border:1px solid #f0e6e9!important;
        border-radius:18px!important;
        background:#f8f5f6!important;
      }
      .productionV2Tab{
        position:relative!important;
        min-height:54px!important;
        padding:8px 12px!important;
        border:1px solid transparent!important;
        border-radius:14px!important;
        background:transparent!important;
        color:#5f575e!important;
        box-shadow:none!important;
        transition:background .16s ease,border-color .16s ease,box-shadow .16s ease,transform .16s ease!important;
      }
      .productionV2Tab:hover{background:#fff!important;border-color:#eadfe3!important}
      .productionV2Tab:active{transform:scale(.985)!important}
      .productionV2Tab i{
        display:grid!important;
        place-items:center!important;
        flex:0 0 36px!important;
        width:36px!important;
        height:36px!important;
        border-radius:12px!important;
        background:#fff!important;
        border:1px solid #eadfe3!important;
        color:#756c73!important;
        font-family:Montserrat,Arial,sans-serif!important;
        font-size:11px!important;
        font-weight:950!important;
        font-style:normal!important;
      }
      .productionV2Tab span{min-width:0!important;display:block!important}
      .productionV2Tab b{
        display:block!important;
        overflow:hidden!important;
        color:inherit!important;
        font-family:Montserrat,Arial,sans-serif!important;
        font-size:12px!important;
        font-weight:950!important;
        line-height:1.15!important;
        text-overflow:ellipsis!important;
        white-space:nowrap!important;
      }
      .productionV2Tab.active{
        border-color:#f3a5bd!important;
        background:#fff!important;
        color:#c82f60!important;
        box-shadow:0 8px 20px rgba(239,85,133,.12)!important;
      }
      .productionV2Tab.active i{
        border-color:#ffd0df!important;
        background:#fff1f6!important;
        color:#d9366b!important;
      }
      .productionV2Tab.active::after{
        content:'✓';
        position:absolute;
        top:7px;
        right:8px;
        display:grid;
        place-items:center;
        width:17px;
        height:17px;
        border-radius:999px;
        background:#ef5585;
        color:#fff;
        font-size:10px;
        font-weight:950;
      }
      .productionV2Nav>small{display:none!important}
      @media(max-width:760px){
        .productionV2Nav{grid-template-columns:1fr!important;padding:11px!important}
        .productionV2Nav>div:first-child{padding:1px 4px 3px!important}
        .productionV2Tabs{gap:7px!important}
        .productionV2Tab{min-height:51px!important;padding:7px 9px!important}
        .productionV2Tab i{flex-basis:32px!important;width:32px!important;height:32px!important;font-size:10px!important}
        .productionV2Tab b{font-size:11px!important}
      }
      @media(max-width:420px){
        .productionV2Tab{gap:7px!important;padding-right:7px!important}
        .productionV2Tab.active::after{display:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function removeBlockingChooser(){
    var chooser=document.getElementById('productionV2Chooser');
    if(chooser)chooser.remove();
  }

  function setIcon(selector,label){
    document.querySelectorAll(selector).forEach(function(icon){
      if(icon.dataset.productionV2UxIcon===label)return;
      icon.textContent=label;
      icon.setAttribute('aria-hidden','true');
      icon.dataset.productionV2UxIcon=label;
    });
  }

  function improveProductButtons(){
    setIcon('[data-workspace="bolinhas"] i','50');
    setIcon('[data-workspace="painel-150"] i','150');
  }

  function activateDefaultProduct(){
    if(bootstrapped)return;
    var nav=document.getElementById('productionV2Nav');
    if(!nav)return;
    var active=nav.querySelector('[data-workspace].active');
    if(active){bootstrapped=true;return;}
    var fallback=nav.querySelector('[data-workspace="'+DEFAULT_PRODUCT+'"]');
    if(!fallback)return;
    bootstrapped=true;
    fallback.click();
  }

  function neutralizeLegacyCheckout(){
    if(!window.__ARMAZEM_PRODUCTION_V2__)return;
    document.querySelectorAll('a.wa').forEach(function(link){
      var href=link.getAttribute('href')||'';
      if(href&&href!=='#')link.dataset.legacyWhatsappHref=href;
      if(href!=='#')link.setAttribute('href','#');
      if(link.dataset.productionV2Neutralized!=='1')link.dataset.productionV2Neutralized='1';
    });
  }

  function run(){
    scheduled=false;
    injectProductStyle();
    removeBlockingChooser();
    improveProductButtons();
    activateDefaultProduct();
    neutralizeLegacyCheckout();
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(run);
  }

  run();
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href','class']});
})();
