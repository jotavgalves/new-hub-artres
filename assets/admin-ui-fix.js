(function(){
  function injectStyle(){
    if(document.getElementById('adminUiFixStyle'))return;
    var style=document.createElement('style');
    style.id='adminUiFixStyle';
    style.textContent='.topbar .actions{display:none!important}#reloadBtnBottom{display:none!important}#usersPanel{display:none!important}body[data-admin-tab="catalogView"] .saveBar,body[data-admin-tab="permissionsView"] .saveBar,body[data-admin-tab="toolsView"] .saveBar,body[data-admin-tab="ordersView"] .saveBar,body[data-admin-tab="clientesView"] .saveBar{display:none!important}body[data-admin-tab="catalogView"] .main,body[data-admin-tab="permissionsView"] .main,body[data-admin-tab="toolsView"] .main,body[data-admin-tab="ordersView"] .main,body[data-admin-tab="clientesView"] .main{padding-bottom:36px!important}#catalogPanel .card:first-child .sectionHead,#usersPanel .card:first-child .sectionHead{align-items:center}#saveCatalogControl,#saveUsers{min-width:220px}.saveBar #saveHint{font-weight:800;color:#6f6872}';
    document.head.appendChild(style);
  }
  function loadScript(id,src){
    if(document.getElementById(id))return;
    var script=document.createElement('script');
    script.id=id;
    script.src=src;
    script.defer=true;
    document.body.appendChild(script);
  }
  function setTab(tab){
    document.body.dataset.adminTab=tab||'overviewView';
    if(tab!=='ordersView')delete document.body.dataset.ordersSubtab;
  }
  function bindTabs(){
    document.querySelectorAll('[data-tab]').forEach(function(btn){
      btn.addEventListener('click',function(){setTab(btn.dataset.tab)});
      if(btn.classList.contains('active'))setTab(btn.dataset.tab);
    });
    if(!document.body.dataset.adminTab)setTab('overviewView');
  }
  injectStyle();
  loadScript('adminPedidosSidebarScript','/assets/pedidos-sidebar.js?v=2');
  loadScript('adminOrdersUnifiedScript','/assets/admin-orders-unified.js?v=2');
  loadScript('adminClientesScript','/assets/clientes.js?v=1');
  loadScript('adminCampaignDiscountScript','/assets/admin-campaign-discount.js?v=1');
  loadScript('adminProductionScript','/assets/admin-production.js?v=1');
  loadScript('adminWhatsappRealScript','/assets/admin-whatsapp-real.js?v=1');
  loadScript('adminUsersRealScript','/assets/admin-users-real.js?v=2');
  bindTabs();
  new MutationObserver(bindTabs).observe(document.body,{childList:true,subtree:true});
})();
