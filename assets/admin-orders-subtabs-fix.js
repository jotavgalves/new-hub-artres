(function(){
  function hasClientes(){return !!document.getElementById('clientesLista')}
  function openClientes(){
    document.body.dataset.ordersSubtab='clientes';
    if(typeof window.openClientesAdmin==='function') window.openClientesAdmin();
  }
  function forceClientes(){
    openClientes();
    setTimeout(openClientes,80);
    setTimeout(openClientes,260);
    setTimeout(openClientes,600);
  }
  document.addEventListener('click',function(e){
    var cli=e.target&&e.target.closest&&e.target.closest('#subClientes');
    if(cli){e.preventDefault();e.stopPropagation();forceClientes();return false;}
    var sol=e.target&&e.target.closest&&e.target.closest('#subSolicitacoes');
    if(sol){document.body.dataset.ordersSubtab='solicitacoes';}
  },true);
  setInterval(function(){
    if(document.body.dataset.ordersSubtab==='clientes'&&!hasClientes()) forceClientes();
  },700);
})();