(function(){
  function $(id){return document.getElementById(id)}
  function ensureLayout(){
    var login=$('loginView');
    if(login){ login.classList.add('loginPage'); login.classList.remove('loginWrap'); }
    var form=$('loginForm');
    if(form && !$('username')){
      var password=$('password');
      var field=document.createElement('div');
      field.className='field';
      field.innerHTML='<label>Usuário</label><input id="username" autocomplete="username" placeholder="Digite seu usuário">';
      if(password && password.closest('.field')) form.insertBefore(field,password.closest('.field'));
    }
    if($('username')) $('username').placeholder='Digite seu usuário';
    if($('password')) $('password').placeholder='Digite sua senha';
    if($('loginTitle')) $('loginTitle').textContent='Painel administrativo';
    if($('loginSubtitle')) $('loginSubtitle').textContent='Entre com seu usuário e senha.';
  }
  function status(msg,type){
    var s=$('loginStatus'); if(!s) return;
    s.textContent=msg; s.className='status '+(type||'err'); s.classList.remove('hidden');
  }
  async function submit(e){
    e.preventDefault();
    var username=($('username')&&$('username').value||'admin').trim()||'admin';
    var password=($('password')&&$('password').value||'').trim();
    try{
      var r=await fetch('/api/admin/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username,password:password})});
      var d=await r.json().catch(function(){return {}});
      if(!r.ok||d.ok===false) throw new Error(d.error||'Usuário ou senha inválidos.');
      location.reload();
    }catch(err){ status(err.message||'Usuário ou senha inválidos.','err'); }
  }
  function bind(){
    ensureLayout();
    var form=$('loginForm');
    if(form && form.dataset.loginFix!=='1'){
      form.dataset.loginFix='1';
      form.onsubmit=submit;
    }
  }
  bind();
  new MutationObserver(bind).observe(document.documentElement,{childList:true,subtree:true});
})();