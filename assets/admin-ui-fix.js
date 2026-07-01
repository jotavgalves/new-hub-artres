(function(){
  function injectStyle(){
    if (document.getElementById('adminUiFixStyle')) return;
    var style = document.createElement('style');
    style.id = 'adminUiFixStyle';
    style.textContent = `
      .topbar .actions{display:none!important}
      #reloadBtnBottom{display:none!important}
      body[data-admin-tab="catalogView"] .saveBar,
      body[data-admin-tab="permissionsView"] .saveBar,
      body[data-admin-tab="toolsView"] .saveBar,
      body[data-admin-tab="ordersView"] .saveBar{display:none!important}
      body[data-admin-tab="catalogView"] .main,
      body[data-admin-tab="permissionsView"] .main,
      body[data-admin-tab="toolsView"] .main,
      body[data-admin-tab="ordersView"] .main{padding-bottom:36px!important}
      #catalogPanel .card:first-child .sectionHead,
      #usersPanel .card:first-child .sectionHead{align-items:center}
      #saveCatalogControl,#saveUsers{min-width:220px}
      .saveBar #saveHint{font-weight:800;color:#6f6872}
    `;
    document.head.appendChild(style);
  }
  function setTab(tab){
    document.body.dataset.adminTab = tab || 'overviewView';
  }
  function bindTabs(){
    document.querySelectorAll('[data-tab]').forEach(function(btn){
      btn.addEventListener('click', function(){ setTab(btn.dataset.tab); });
      if (btn.classList.contains('active')) setTab(btn.dataset.tab);
    });
    if (!document.body.dataset.adminTab) setTab('overviewView');
  }
  injectStyle();
  bindTabs();
  new MutationObserver(bindTabs).observe(document.body,{childList:true,subtree:true});
})();
