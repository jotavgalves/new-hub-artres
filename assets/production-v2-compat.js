(function(){
  if(window.__ARMAZEM_PRODUCTION_V2_COMPAT__)return;
  window.__ARMAZEM_PRODUCTION_V2_COMPAT__='1';

  function neutralizeLegacyCheckout(){
    if(!window.__ARMAZEM_PRODUCTION_V2__)return;
    document.querySelectorAll('a.wa').forEach(function(link){
      if(link.dataset.productionV2Neutralized==='1')return;
      var href=link.getAttribute('href')||'';
      if(href&&href!=='#')link.dataset.legacyWhatsappHref=href;
      link.setAttribute('href','#');
      link.dataset.productionV2Neutralized='1';
    });
  }

  neutralizeLegacyCheckout();
  new MutationObserver(function(){
    document.querySelectorAll('a.wa').forEach(function(link){
      var href=link.getAttribute('href')||'';
      if(href&&href!=='#')link.dataset.legacyWhatsappHref=href;
      link.setAttribute('href','#');
      link.dataset.productionV2Neutralized='1';
    });
  }).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
})();
