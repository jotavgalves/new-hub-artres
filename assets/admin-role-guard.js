(function(){
  var user=null,applied=false;
  function qs(sel){return document.querySelector(sel)}
  function qsa(sel){return Array.from(document.querySelectorAll(sel))}
  async function loadUser(){
    try{var r=await fetch('/api/admin/config?ts='+Date.now(),{credentials:'include',cache:'no-store'});var d=await r.json().catch(function(){return {}});user=d.sessionUser||null;apply();}catch(e){}
  }
  function apply(){
    if(!user||user.role!=='vendedora'||applied===true)return;
    applied=true;
    document.body.dataset.userRole='vendedora';
    qsa('.nav [data-tab]').forEach(function(btn){
      var ok=btn.dataset.tab==='ordersView';
      btn.style.display=ok?'':'none';
      btn.classList.toggle('active',ok);
    });
    qsa('[data-view]').forEach(function(v){v.classList.toggle('hidden',v.id!=='ordersView')});
    var title=document.getElementById('adminTitle'); if(title) title.textContent='Painel da vendedora';
    var sub=document.getElementById('adminSubtitle'); if(sub) sub.textContent='Acesse suas solicitações e clientes vinculados.';
    var save=document.querySelector('.saveBar'); if(save) save.style.display='none';
    document.body.dataset.adminTab='ordersView';
    setTimeout(function(){var b=qs('[data-tab="ordersView"]'); if(b) b.click();},200);
  }
  document.addEventListener('click',function(e){
    if(!user||user.role!=='vendedora')return;
    var tab=e.target&&e.target.closest&&e.target.closest('[data-tab]');
    if(tab&&tab.dataset.tab!=='ordersView'){e.preventDefault();e.stopPropagation();}
  },true);
  setInterval(apply,800);
  loadUser();
})();