export const ADMIN_COMMERCIAL_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Armazem | Configuração comercial</title>
  <link rel="stylesheet" href="/admin/commercial/app.css">
  <script src="/admin/commercial/app.js" defer></script>
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">ARMAZEM · AMBIENTE DE TESTE</p>
      <h1>Configuração comercial</h1>
      <p>Preços e regras usados pelo catálogo e pelo checkout.</p>
    </div>
    <div class="actions"><span>STAGING</span><a href="/admin">Pedidos</a></div>
  </header>
  <main class="shell">
    <section class="notice">
      <strong>Configuração versionada</strong>
      <p>Cada salvamento cria uma nova versão. Pedidos antigos mantêm os valores originais; pedidos novos usam a versão ativa.</p>
    </section>
    <section class="access">
      <form id="access-form" autocomplete="off">
        <label for="token">Chave de acesso do staging</label>
        <div class="access-row">
          <input id="token" type="password" minlength="32" maxlength="512" required autocomplete="off" spellcheck="false">
          <button type="submit">Carregar configuração</button>
          <button id="disconnect" type="button" class="secondary" disabled>Desconectar</button>
        </div>
      </form>
    </section>
    <div id="status" class="status" role="status" aria-live="polite">Informe a chave para carregar a configuração.</div>
    <form id="config-form" hidden>
      <div class="version-row">
        <div><span>Versão ativa</span><strong id="version">0</strong></div>
        <div><span>Atualizada em</span><strong id="updated-at">Ainda não informado</strong></div>
        <label>Desconto geral (%)<input id="discount" type="number" min="0" max="100" step="0.01" required></label>
      </div>
      <div id="products" class="products"></div>
      <div class="save-row">
        <p>O servidor continuará recalculando todos os pedidos. Valores enviados pelo navegador são ignorados.</p>
        <button id="save" type="submit">Publicar nova versão</button>
      </div>
    </form>
    <section id="history-card" class="history" hidden>
      <h2>Histórico recente</h2>
      <ol id="history"></ol>
    </section>
  </main>
</body>
</html>`;

export const ADMIN_COMMERCIAL_CSS = `
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#090b10;color:#f4f6fb;--panel:#11151d;--panel2:#171c26;--line:#293140;--muted:#9ca7b8;--accent:#22d3ee;--safe:#86efac;--danger:#fca5a5}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% -10%,#16313b 0,transparent 32rem),#090b10}button,input{font:inherit}button{cursor:pointer;min-height:44px;padding:0 1rem;border:1px solid #0e7490;border-radius:10px;background:#0891b2;color:#fff;font-weight:800}button.secondary,.actions a{border:1px solid var(--line);background:#171c26;color:#dce5f2}.topbar{display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:2rem clamp(1.25rem,4vw,4rem);border-bottom:1px solid var(--line);background:rgba(9,11,16,.82)}h1,h2,p{margin-top:0}h1{margin-bottom:.35rem;font-size:clamp(1.7rem,3vw,2.5rem);letter-spacing:-.04em}.topbar p{margin-bottom:0;color:var(--muted)}.eyebrow{margin-bottom:.45rem!important;color:var(--accent)!important;font-size:.72rem;font-weight:800;letter-spacing:.16em}.actions{display:flex;align-items:center;gap:.65rem}.actions span,.actions a{padding:.5rem .75rem;border-radius:999px;font-size:.72rem;font-weight:850;text-decoration:none}.actions span{border:1px solid #155e75;background:#083344;color:#a5f3fc}.shell{width:min(1100px,calc(100% - 2rem));margin:2rem auto 4rem}.notice,.access,#config-form,.history{margin-bottom:1rem;padding:1.3rem;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,rgba(23,28,38,.96),rgba(14,18,25,.96));box-shadow:0 20px 70px rgba(0,0,0,.22)}.notice p{margin:.4rem 0 0;color:var(--muted);line-height:1.5}.access label{display:block;margin-bottom:.55rem;font-size:.82rem;font-weight:700}.access-row{display:grid;grid-template-columns:minmax(250px,1fr) auto auto;gap:.65rem}input{width:100%;min-height:44px;padding:0 .8rem;border:1px solid var(--line);border-radius:10px;background:#0b0f16;color:#eef2f7;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(34,211,238,.14)}.status{min-height:48px;display:flex;align-items:center;padding:.85rem 1rem;margin-bottom:1rem;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}.status[data-tone=error]{border-style:solid;border-color:#7f1d1d;background:rgba(69,10,10,.42);color:#fecaca}.status[data-tone=success]{border-style:solid;border-color:#14532d;background:rgba(5,46,22,.42);color:#bbf7d0}.version-row{display:grid;grid-template-columns:1fr 2fr minmax(180px,.8fr);gap:1rem;margin-bottom:1rem}.version-row>div,.version-row>label{padding:1rem;border:1px solid var(--line);border-radius:14px;background:#0d1118}.version-row span,.version-row label{color:var(--muted);font-size:.78rem;font-weight:700}.version-row strong{display:block;margin-top:.35rem}.version-row label input{margin-top:.5rem}.products{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.product-card{padding:1.2rem;border:1px solid var(--line);border-radius:16px;background:#0d1118}.product-head{display:flex;align-items:center;justify-content:space-between;gap:1rem}.product-head h2{margin-bottom:0}.enabled{display:flex;align-items:center;gap:.5rem;color:var(--muted);font-size:.8rem}.enabled input{width:auto;min-height:auto}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin-top:1rem}.fields label{color:var(--muted);font-size:.78rem;font-weight:700}.fields input{margin-top:.4rem}.scope{margin:.8rem 0 0;color:var(--muted);font-size:.78rem}.save-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1.2rem;padding-top:1.2rem;border-top:1px solid var(--line)}.save-row p{max-width:650px;margin:0;color:var(--muted);font-size:.82rem;line-height:1.5}.history ol{margin:0;padding-left:1.2rem;color:var(--muted)}.history li{padding:.35rem 0}@media(max-width:760px){.topbar,.save-row{align-items:flex-start;flex-direction:column}.access-row,.version-row,.products,.fields{grid-template-columns:1fr}.shell{width:min(100% - 1rem,1100px)}}`;

export const ADMIN_COMMERCIAL_JS = `
(() => {
  'use strict';
  const PRODUCT_KEYS = ['50x50','painel-150'];
  const state = { token:'', loading:false, config:null };
  const form = document.getElementById('access-form');
  const configForm = document.getElementById('config-form');
  const tokenInput = document.getElementById('token');
  const disconnectButton = document.getElementById('disconnect');
  const statusNode = document.getElementById('status');
  const productsNode = document.getElementById('products');
  const historyCard = document.getElementById('history-card');
  const historyNode = document.getElementById('history');
  const versionNode = document.getElementById('version');
  const updatedNode = document.getElementById('updated-at');
  const discountInput = document.getElementById('discount');
  const dateTime = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Recife'});

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const candidate = String(tokenInput.value||'').trim();
    if(candidate.length<32){setStatus('A chave precisa ter pelo menos 32 caracteres.','error');return;}
    state.token=candidate;
    await loadConfig();
  });
  configForm.addEventListener('submit', saveConfig);
  disconnectButton.addEventListener('click', disconnect);

  async function loadConfig(successText='Configuração carregada. O token permanece apenas na memória desta aba.'){
    if(!state.token||state.loading)return;
    setBusy(true);setStatus('Carregando configuração comercial...','neutral');
    try{
      const result=await request('/internal/v2/admin/commercial-config?history=10');
      state.config=result.config;
      render(result.config,result.history||[]);
      disconnectButton.disabled=false;tokenInput.value='';configForm.hidden=false;historyCard.hidden=false;
      setStatus(successText,'success');
    }catch(error){setStatus(message(error),'error');if(error.status===401)disconnect();}
    finally{setBusy(false);}
  }

  async function saveConfig(event){
    event.preventDefault();
    if(!state.config||state.loading)return;
    const config={
      effectiveDiscountPercent:number(discountInput.value),
      products:Object.fromEntries(PRODUCT_KEYS.map(key=>[key,{
        enabled:document.getElementById(fieldId(key,'enabled')).checked,
        unitPrice:number(document.getElementById(fieldId(key,'unitPrice')).value),
        minimum:integer(document.getElementById(fieldId(key,'minimum')).value),
        step:integer(document.getElementById(fieldId(key,'step')).value),
        initialQuantity:integer(document.getElementById(fieldId(key,'initialQuantity')).value)
      }]))
    };
    setBusy(true);setStatus('Validando e publicando nova versão...','neutral');
    try{
      const result=await request('/internal/v2/admin/commercial-config',{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({expectedVersion:state.config.version,config})
      });
      state.config=result.config;
      render(result.config,[]);
      setBusy(false);
      await loadConfig('Nova versão comercial publicada com sucesso.');
      return;
    }catch(error){
      if(error.code==='COMMERCIAL_CONFIG_VERSION_CONFLICT'){
        setBusy(false);
        await loadConfig('A configuração mudou em outra aba. A versão atual foi recarregada.');
        return;
      }
      setStatus(message(error),'error');
    }finally{if(state.loading)setBusy(false);}
  }

  function render(config,history){
    versionNode.textContent=String(config.version||0);
    updatedNode.textContent=config.updatedAt?dateTime.format(new Date(config.updatedAt)):'Versão inicial';
    discountInput.value=String(config.effectiveDiscountPercent||0);
    productsNode.innerHTML=PRODUCT_KEYS.map(key=>productCard(key,config.products[key])).join('');
    historyNode.innerHTML=history.length?history.map(item=>'<li>Versão '+escapeHtml(item.version)+' · '+escapeHtml(item.actor||'sistema')+' · '+escapeHtml(formatDate(item.createdAt))+'</li>').join(''):'<li>Nenhuma alteração adicional.</li>';
  }

  function productCard(key,product){
    const scope=product.quantity.scope==='item'?'por item':'total do produto no carrinho';
    return '<section class="product-card"><div class="product-head"><h2>'+escapeHtml(product.label)+'</h2><label class="enabled"><input id="'+fieldId(key,'enabled')+'" type="checkbox" '+(product.enabled?'checked':'')+'> Disponível</label></div><div class="fields">'+field(key,'unitPrice','Preço unitário (R$)',product.unitPrice,'0.01')+field(key,'minimum','Quantidade mínima',product.quantity.minimum,'1')+field(key,'step','Incremento',product.quantity.step,'1')+field(key,'initialQuantity','Quantidade inicial',product.quantity.initial,'1')+'</div><p class="scope">Regra aplicada ao '+escapeHtml(scope)+'.</p></section>';
  }
  function field(key,name,label,value,step){return '<label>'+escapeHtml(label)+'<input id="'+fieldId(key,name)+'" type="number" min="'+(name==='unitPrice'?'0':'1')+'" max="1000000" step="'+step+'" value="'+escapeHtml(value)+'" required></label>';}
  function fieldId(key,name){return 'product-'+key.replace(/[^a-z0-9]/gi,'-')+'-'+name;}

  async function request(path,init={}){
    const headers=new Headers(init.headers||{});headers.set('X-Staging-Token',state.token);headers.set('Accept','application/json');
    const response=await fetch(path,{...init,headers,cache:'no-store',credentials:'same-origin'});
    let payload={};try{payload=await response.json();}catch(_){payload={};}
    if(!response.ok||payload.ok!==true){const error=new Error(payload.error||'ADMIN_COMMERCIAL_REQUEST_FAILED');error.code=payload.error||'ADMIN_COMMERCIAL_REQUEST_FAILED';error.status=response.status;error.currentVersion=payload.currentVersion;throw error;}
    return payload;
  }
  function disconnect(){state.token='';state.config=null;tokenInput.value='';disconnectButton.disabled=true;configForm.hidden=true;historyCard.hidden=true;productsNode.innerHTML='';setStatus('Desconectado. A chave foi removida da memória da aba.','neutral');}
  function setBusy(value){state.loading=value;form.querySelectorAll('button,input').forEach(node=>node.disabled=value);configForm.querySelectorAll('button,input').forEach(node=>node.disabled=value);disconnectButton.disabled=value||!state.token;}
  function setStatus(text,tone){statusNode.textContent=text;statusNode.dataset.tone=tone==='neutral'?'':tone;}
  function message(error){if(error.status===401)return'Chave inválida ou expirada.';if(error.code==='COMMERCIAL_CONFIG_INVALID')return'Existem valores comerciais inválidos. Confira preço, mínimo, incremento e quantidade inicial.';return'Não foi possível concluir a operação. Código: '+String(error.code||'ADMIN_COMMERCIAL_REQUEST_FAILED');}
  function number(value){return Number(String(value||'').replace(',','.'));}
  function integer(value){return Number.parseInt(value,10);}
  function formatDate(value){try{return dateTime.format(new Date(value));}catch(_){return String(value||'');}}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
})();`;
