(function(){
  if(window.__ARMAZEM_ACCESS_MANAGER_ACTIVE__)return;
  window.__ARMAZEM_ACCESS_MANAGER_ACTIVE__=true;
  window.__ARMAZEM_ACCESS_MANAGER_VERSION__='3';

  var users=[],sellers=[],loading=false,saving=false,editingId='',lastCreated=null;
  function $(id){return document.getElementById(id)}
  function esc(v){return String(v==null?'':v).replace(/[&<>'"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]})}
  function slug(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
  async function api(url,opts){var r=await fetch(url,{credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json'},...(opts||{})});var d=await r.json().catch(function(){return {}});if(!r.ok||d.ok===false)throw new Error(d.error||'Erro');return d}
  function toast(msg,type){var s=$('status');if(!s)return;s.textContent=msg;s.className='status '+(type||'ok');s.classList.remove('hidden');clearTimeout(toast.t);toast.t=setTimeout(function(){if(s.textContent===msg)s.classList.add('hidden')},type==='err'?6500:3500)}
  function active(){return document.body.dataset.adminTab==='permissionsView'||!$('permissionsView')?.classList.contains('hidden')}
  function sellerId(s){return slug(s&&s.id||s&&s.label)}
  function sellerById(id){id=slug(id);return sellers.find(function(s){return sellerId(s)===id})||null}
  function generatedPassword(){var a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',out='';for(var i=0;i<8;i++)out+=a[Math.floor(Math.random()*a.length)];return out}
  function injectStyle(){if($('accessManagerStyle'))return;var st=document.createElement('style');st.id='accessManagerStyle';st.textContent='#permissionsPanel{width:100%;min-width:0}#accessManagerRoot{grid-column:1/-1;width:100%;min-width:0;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px}.accessStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.accessStat{border:1px solid #f0e2e6;background:#fff;border-radius:22px;padding:16px;min-width:0}.accessStat span{display:block;color:#8d8590;font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:.06em}.accessStat b{display:block;margin-top:6px;font:900 26px/1 Montserrat,Arial}.accessCard{border:1px solid #f0e2e6;border-radius:24px;background:#fff;padding:16px;margin-top:12px}.accessCard.off{opacity:.65}.accessTop{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.accessTop h4{margin:0;font:900 20px/1.05 Montserrat,Arial}.accessMeta{margin:8px 0 0;color:#6f6872;font-weight:800;line-height:1.45}.accessActions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.accessResult{margin-top:14px;border:1px solid #d7f3df;background:#f2fff6;border-radius:20px;padding:14px}.accessResult pre{white-space:pre-wrap;margin:10px 0 0;font-weight:900}.accessDanger{margin-top:10px;border-top:1px solid #f0e2e6;padding-top:10px}.accessSubtle{color:#8d8590;font-size:12px;font-weight:800}.accessFormTitle{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}@media(max-width:760px){#accessManagerRoot{display:block}.accessStats{grid-template-columns:1fr 1fr}.accessTop{display:grid}.accessActions{justify-content:stretch}.accessActions .btn{width:100%}}';document.head.appendChild(st)}
  function ownPlaceholder(){injectStyle();var p=$('permissionsPanel');if(!p||p.dataset.accessOwner==='1')return;p.dataset.accessOwner='1';p.innerHTML='<div class="card span-12"><div class="sectionHead"><div><h3>Acessos da equipe</h3><p>Carregando gerenciador real de acessos...</p></div></div><p class="hint">Esta aba é controlada somente pelo gerenciador de acessos. Usuários são salvos no Supabase.</p></div>'}

  async function load(){
    if(loading)return;
    ownPlaceholder();
    loading=true;
    try{var d=await api('/api/admin/users?ts='+Date.now());users=d.users||[];sellers=d.sellers||[];render()}
    catch(e){toast(e.message||'Erro ao carregar acessos.','err');renderError(e.message||'Erro ao carregar acessos.')}
    finally{loading=false}
  }

  function renderError(message){var p=$('permissionsPanel');if(!p)return;p.dataset.accessOwner='1';p.innerHTML='<div class="card span-12"><h3>Acessos da equipe</h3><p class="hint">'+esc(message)+'</p><button id="accessTryAgain" class="btn secondary" type="button">Tentar novamente</button></div>';var b=$('accessTryAgain');if(b)b.onclick=load}
  function sellerOptions(current){return sellers.map(function(s){var id=sellerId(s);return '<option value="'+esc(id)+'" '+(id===current?'selected':'')+'>'+esc(s.label||id)+'</option>'}).join('')}
  function summary(){var activeUsers=users.filter(function(u){return u.active!==false}).length,inactive=users.length-activeUsers,linked={};users.forEach(function(u){if(u.active!==false&&u.sellerId)linked[slug(u.sellerId)]=1});var without=sellers.filter(function(s){return s.active!==false&&!linked[sellerId(s)]}).length;return {active:activeUsers,inactive:inactive,sellers:sellers.length,without:without}}

  function render(){
    if(!active())return;
    injectStyle();
    var p=$('permissionsPanel');if(!p)return;
    p.dataset.accessOwner='1';
    p.innerHTML='<div id="accessManagerRoot" class="grid span-12">'+statsHtml()+formHtml()+createdHtml()+listHtml()+'</div>';
    bind();
  }

  function statsHtml(){var s=summary();return '<div class="card span-12"><div class="sectionHead"><div><h3>Acessos da equipe</h3><p>Crie e gerencie logins individuais das vendedoras. Fonte principal: Supabase.</p></div><button id="accessReload" class="btn secondary" type="button">Atualizar</button></div><div class="accessStats"><div class="accessStat"><span>Ativos</span><b>'+s.active+'</b></div><div class="accessStat"><span>Inativos</span><b>'+s.inactive+'</b></div><div class="accessStat"><span>Vendedoras</span><b>'+s.sellers+'</b></div><div class="accessStat"><span>Sem acesso</span><b>'+s.without+'</b></div></div></div>'}
  function formHtml(){var u=editingId?users.find(function(x){return x.id===editingId}):null,currentSeller=u?u.sellerId:'',title=u?'Editando acesso':'Criar novo acesso',btn=u?'Salvar alterações':'Criar acesso';return '<div class="card span-12"><div class="accessFormTitle"><div><h3>'+title+'</h3><p class="hint">Vendedora é quem aparece no carrinho. Acesso é o login que entra no painel.</p></div>'+(u?'<button id="accessCancelEdit" class="btn secondary" type="button">Cancelar edição</button>':'')+'</div><div class="grid"><div class="field span-3"><label>Vendedora vinculada</label><select id="accessSeller"><option value="">Selecione</option>'+sellerOptions(currentSeller)+'</select></div><div class="field span-3"><label>Nome no acesso</label><input id="accessName" value="'+esc(u&&u.name||'')+'" placeholder="Ana"></div><div class="field span-3"><label>Usuário/login</label><input id="accessUsername" value="'+esc(u&&u.username||'')+'" placeholder="ana"></div><div class="field span-3"><label>Status</label><select id="accessActive"><option value="true" '+(!u||u.active!==false?'selected':'')+'>Ativo</option><option value="false" '+(u&&u.active===false?'selected':'')+'>Inativo</option></select></div><div class="field span-6"><label>'+(u?'Nova senha':'Senha inicial')+'</label><input id="accessPassword" type="text" value="" placeholder="'+(u?'deixe em branco para manter':'mín. 4 caracteres')+'"></div><div class="field span-3"><label>Gerar senha</label><button id="accessGenerate" class="btn secondary" type="button">Gerar</button></div><div class="field span-3"><label>Salvar</label><button id="accessSave" class="btn green" type="button">'+btn+'</button></div></div><p class="accessSubtle">Ao criar, a senha é salva com PBKDF2-SHA256. Ela não fica visível depois, então copie antes de entregar à vendedora.</p></div>'}
  function createdHtml(){if(!lastCreated)return '';return '<div class="card span-12"><div class="accessResult"><b>Acesso pronto para enviar</b><pre id="accessCreatedText">'+esc(createdText(lastCreated))+'</pre><div class="actions"><button id="accessCopyCreated" class="btn secondary" type="button">Copiar instruções</button></div></div></div>'}
  function listHtml(){return '<div class="card span-12"><div class="sectionHead"><div><h3>Acessos criados</h3><p>Editar altera nome, usuário, vendedora e status. Troca de senha é explícita pelo campo de senha.</p></div></div><div id="accessList">'+(users.length?users.map(userCard).join(''):'<p class="hint">Nenhum acesso criado ainda.</p>')+'</div></div>'}
  function userCard(u){var seller=sellerById(u.sellerId),active=u.active!==false;return '<article class="accessCard '+(active?'':'off')+'"><div class="accessTop"><div><h4>'+esc(u.name||u.username)+'</h4><p class="accessMeta">Usuário: <b>'+esc(u.username)+'</b><br>Vendedora vinculada: <b>'+esc(seller&&seller.label||u.sellerId||'—')+'</b><br>Status: <b>'+(active?'Ativo':'Inativo')+'</b></p></div><div class="accessActions"><button class="btn secondary" type="button" data-edit-access="'+esc(u.id)+'">Editar</button><button class="btn secondary" type="button" data-toggle-access="'+esc(u.id)+'">'+(active?'Desativar':'Ativar')+'</button></div></div><div class="accessDanger"><button class="btn danger" type="button" data-delete-access="'+esc(u.id)+'">Excluir definitivamente</button></div></article>'}

  function bind(){
    var r=$('accessReload');if(r)r.onclick=load;
    var cancel=$('accessCancelEdit');if(cancel)cancel.onclick=function(){editingId='';lastCreated=null;render()};
    var seller=$('accessSeller');if(seller)seller.onchange=function(){var s=sellerById(seller.value);if(!s)return;if(!$('accessName').value)$('accessName').value=s.label||'';if(!$('accessUsername').value)$('accessUsername').value=slug(s.id||s.label)};
    var gen=$('accessGenerate');if(gen)gen.onclick=function(){var p=$('accessPassword');if(p)p.value=generatedPassword()};
    var save=$('accessSave');if(save)save.onclick=saveAccess;
    var copy=$('accessCopyCreated');if(copy)copy.onclick=function(){copyText(createdText(lastCreated))};
    Array.from(document.querySelectorAll('[data-edit-access]')).forEach(function(b){b.onclick=function(){editingId=b.dataset.editAccess;lastCreated=null;render();window.scrollTo({top:0,behavior:'smooth'})}});
    Array.from(document.querySelectorAll('[data-toggle-access]')).forEach(function(b){b.onclick=function(){toggleAccess(b.dataset.toggleAccess)}});
    Array.from(document.querySelectorAll('[data-delete-access]')).forEach(function(b){b.onclick=function(){deleteAccess(b.dataset.deleteAccess)}});
  }

  async function saveAccess(){
    if(saving)return;
    var sellerId=slug($('accessSeller')&&$('accessSeller').value), name=($('accessName')&&$('accessName').value||'').trim(), username=slug($('accessUsername')&&$('accessUsername').value||name), password=$('accessPassword')&&$('accessPassword').value||'', activeValue=($('accessActive')&&$('accessActive').value)!=='false';
    if(!sellerId||!name||!username)return toast('Preencha vendedora, nome e usuário.','err');
    if(!editingId&&!password)return toast('Informe uma senha inicial ou clique em Gerar.','err');
    saving=true;
    try{var d=await api('/api/admin/users',{method:'POST',body:JSON.stringify({id:editingId||username,name:name,username:username,sellerId:sellerId,password:password,active:activeValue})});users=d.users||[];lastCreated=password?{username:username,password:password,name:name}:null;editingId='';toast('Acesso salvo no Supabase.','ok');render()}
    catch(e){toast(e.message||'Erro ao salvar acesso.','err')}
    finally{saving=false}
  }
  async function toggleAccess(id){var u=users.find(function(x){return x.id===id});if(!u)return;try{var d=await api('/api/admin/users',{method:'POST',body:JSON.stringify({id:u.id,name:u.name,username:u.username,sellerId:u.sellerId,password:'',active:u.active===false})});users=d.users||[];toast(u.active===false?'Acesso ativado.':'Acesso desativado.','ok');render()}catch(e){toast(e.message||'Erro ao alterar status.','err')}}
  async function deleteAccess(id){if(!confirm('Excluir definitivamente este acesso?'))return;try{var d=await api('/api/admin/users',{method:'DELETE',body:JSON.stringify({id:id})});users=d.users||[];if(editingId===id)editingId='';toast('Acesso excluído.','ok');render()}catch(e){toast(e.message||'Erro ao excluir acesso.','err')}}
  function createdText(x){if(!x)return '';return 'Link: '+location.origin+'/adm\nUsuario: '+x.username+'\nSenha: '+x.password}
  function copyText(text){navigator.clipboard&&navigator.clipboard.writeText(text).then(function(){toast('Instruções copiadas.','ok')}).catch(function(){toast('Não consegui copiar.','err')})}

  ownPlaceholder();
  document.addEventListener('click',function(e){var tab=e.target&&e.target.closest&&e.target.closest('[data-tab]');if(tab&&tab.dataset.tab==='permissionsView'){ownPlaceholder();setTimeout(load,0)}},true);
  if(active())setTimeout(load,0);
})();
