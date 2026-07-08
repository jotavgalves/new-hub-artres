(function(){
  function injectStyle(){
    if(document.getElementById('adminUiFixStyle'))return;
    var style=document.createElement('style');
    style.id='adminUiFixStyle';
    style.textContent='.topbar .actions{display:none!important}#reloadBtnBottom{display:none!important}body[data-admin-tab="catalogView"] .saveBar,body[data-admin-tab="permissionsView"] .saveBar,body[data-admin-tab="toolsView"] .saveBar,body[data-admin-tab="ordersView"] .saveBar,body[data-admin-tab="clientesView"] .saveBar{display:none!important}body[data-admin-tab="catalogView"] .main,body[data-admin-tab="permissionsView"] .main,body[data-admin-tab="toolsView"] .main,body[data-admin-tab="ordersView"] .main,body[data-admin-tab="clientesView"] .main{padding-bottom:36px!important}#catalogPanel .card:first-child .sectionHead,#usersPanel .card:first-child .sectionHead{align-items:center}#saveCatalogControl,#saveUsers{min-width:220px}.saveBar #saveHint{font-weight:800;color:#6f6872}';
    document.head.appendChild(style);
  }
  function scriptPath(src){
    try{return new URL(src,location.origin).pathname}catch(e){return String(src||'').split('?')[0]}
  }
  function hasScript(src){
    var wanted=scriptPath(src);
    return Array.from(document.scripts).some(function(script){
      var current=script.getAttribute('src')||'';
      return current&&scriptPath(current)===wanted;
    });
  }
  function loadScript(id,src){
    if(document.getElementById(id)||hasScript(src))return;
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
      if(btn.dataset.boundUiFix==='1')return;
      btn.dataset.boundUiFix='1';
      btn.addEventListener('click',function(){setTab(btn.dataset.tab)});
      if(btn.classList.contains('active'))setTab(btn.dataset.tab);
    });
    if(!document.body.dataset.adminTab)setTab('overviewView');
  }
  async function loadRoleSpecific(){
    try{
      var r=await fetch('/api/admin/config?ts='+Date.now(),{credentials:'include',cache:'no-store'});
      var d=await r.json().catch(function(){return {}});
      var role=d.sessionUser&&d.sessionUser.role;
      if(role==='vendedora'){
        document.body.dataset.userRole='vendedora';
        loadScript('adminVendorPanelScript','/assets/admin-vendor-panel.js?v=6');
        return;
      }
    }catch(e){}
    document.body.dataset.userRole='admin';
    loadScript('adminPedidosSidebarScript','/assets/pedidos-sidebar.js?v=4');
    loadScript('adminOrdersUnifiedScript','/assets/admin-orders-unified.js?v=4');
    loadScript('adminCampaignDiscountScript','/assets/admin-campaign-discount.js?v=1');
    loadScript('adminProductionScript','/assets/admin-production.js?v=1');
    loadScript('adminWhatsappRealScript','/assets/admin-whatsapp-real.js?v=1');
  }
  injectStyle();
  bindTabs();
  loadRoleSpecific();
  new MutationObserver(bindTabs).observe(document.body,{childList:true,subtree:true});
})();
