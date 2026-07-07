(function(){
  // Esse arquivo só deve atuar quando carregado pelo admin-ui-fix para usuários admin.
  if(document.body.dataset.userRole === 'vendedora') return;
  function hasClientes(){ return !!document.getElementById('clientesLista'); }
  function openClientes(){
    if(document.body.dataset.userRole === 'vendedora') return;
    document.body.dataset.ordersSubtab = 'clientes';
    if(typeof window.openClientesAdmin === 'function') window.openClientesAdmin();
  }
  function forceClientes(){
    openClientes();
    setTimeout(openClientes,80);
    setTimeout(openClientes,260);
    setTimeout(openClientes,600);
  }
  document.addEventListener('click',function(e){
    if(document.body.dataset.userRole === 'vendedora') return;
    var cli=e.target&&e.target.closest&&e.target.closest('#subClientes');
    if(cli){e.preventDefault();e.stopPropagation();forceClientes();return;}
    var sol=e.target&&e.target.closest&&e.target.closest('#subSolicitacoes');
    if(sol){document.body.dataset.ordersSubtab='solicitacoes';}
  },true);
  setInterval(function(){
    if(document.body.dataset.userRole === 'vendedora') return;
    if(document.body.dataset.ordersSubtab==='clientes'&&!hasClientes()) forceClientes();
  },700);
})();