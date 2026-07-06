(function(){
  function $(id){return document.getElementById(id)}
  function fixOnce(){
    var login=$('loginView');
    if(login){login.classList.add('loginPage');login.classList.remove('loginWrap')}
    var form=$('loginForm');
    if(!form)return;
    if(!$('username')){
      var password=$('password');
      var box=document.createElement('div');
      box.className='field';
      box.innerHTML='<label>Usuário</label><input id="username" name="username" autocomplete="username" placeholder="Digite seu usuário">';
      if(password&&password.closest('.field'))form.insertBefore(box,password.closest('.field'));
      else form.insertBefore(box,form.firstChild);
    }
    var u=$('username'),p=$('password');
    if(u){u.removeAttribute('readonly');u.removeAttribute('disabled');u.placeholder='Digite seu usuário'}
    if(p){p.removeAttribute('readonly');p.removeAttribute('disabled');p.placeholder='Digite sua senha'}
    var title=$('loginTitle');if(title)title.textContent='Painel administrativo';
    var sub=$('loginSubtitle');if(sub)sub.textContent='Entre com seu usuário e senha.';
    form.onsubmit=submit;
  }
  function show(msg){var s=$('loginStatus');if(!s)return;s.textContent=msg;s.className='status err';s.classList.remove('hidden')}
  async function submit(e){
    e.preventDefault();
    var username=(($('username')&&$('username').value)||'admin').trim()||'admin';
    var password=(($('password')&&$('password').value)||'').trim();
    try{
      var r=await fetch('/api/admin/login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username,password:password})});
      var d=await r.json().catch(function(){return {}});
      if(!r.ok||d.ok===false)throw new Error(d.error||'Usuário ou senha inválidos.');
      location.reload();
    }catch(err){show(err.message||'Usuário ou senha inválidos.')}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fixOnce);else fixOnce();
  setTimeout(fixOnce,300);
  setTimeout(fixOnce,1200);
})();