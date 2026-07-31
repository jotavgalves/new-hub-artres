export const ADMIN_COMMERCIAL_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Armazem | Produtos e preços</title>
  <link rel="stylesheet" href="/admin/commercial/app.css">
  <script src="/admin/commercial/app.js" defer></script>
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">ARMAZEM · ADMINISTRAÇÃO V2 · STAGING</p>
      <h1>Produtos, preços e quantidades</h1>
      <p>Gerencie Bolinhas e Painel 150 cm de forma independente.</p>
    </div>
    <nav class="actions" aria-label="Navegação administrativa">
      <span>STAGING</span>
      <a href="/admin">Pedidos</a>
    </nav>
  </header>

  <main class="shell">
    <section class="notice">
      <div class="notice-icon" aria-hidden="true">✓</div>
      <div>
        <strong>Catálogos separados e protegidos</strong>
        <p>Preço, mínimo, incremento, quantidade inicial e disponibilidade podem ser alterados. A raiz do Drive de cada produto é somente leitura e não pode ser trocada por engano.</p>
      </div>
    </section>

    <section class="access">
      <form id="access-form" autocomplete="off">
        <label for="token">Chave de acesso do staging</label>
        <div class="access-row">
          <input id="token" type="password" minlength="32" maxlength="512" required autocomplete="off" spellcheck="false">
          <button type="submit">Carregar produtos</button>
          <button id="disconnect" type="button" class="secondary" disabled>Desconectar</button>
        </div>
      </form>
    </section>

    <div id="status" class="status" role="status" aria-live="polite">Informe a chave para carregar a configuração.</div>

    <form id="config-form" hidden novalidate>
      <section class="version-row" aria-label="Informações da versão comercial">
        <div><span>Versão ativa</span><strong id="version">0</strong></div>
        <div><span>Atualizada em</span><strong id="updated-at">Ainda não informado</strong></div>
        <label>Desconto geral (%)<input id="discount" type="number" min="0" max="100" step="0.01" required></label>
      </section>

      <section class="product-section" aria-labelledby="products-title">
        <div class="section-heading">
          <div>
            <p class="section-kicker">CONFIGURAÇÃO POR PRODUTO</p>
            <h2 id="products-title">Regras comerciais independentes</h2>
          </div>
          <p>O checkout sempre recalcula os valores usando esta versão.</p>
        </div>
        <div id="products" class="products"></div>
      </section>

      <div class="save-row">
        <p>Cada publicação cria uma nova versão. Pedidos antigos mantêm os valores originais; somente pedidos novos recebem as alterações.</p>
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
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#090b10;color:#f4f6fb;--panel:#11151d;--panel2:#171c26;--line:#293140;--muted:#9ca7b8;--accent:#22d3ee;--safe:#86efac;--danger:#fca5a5;--warning:#fde68a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% -10%,#16313b 0,transparent 32rem),#090b10}button,input{font:inherit}button{cursor:pointer;min-height:44px;padding:0 1rem;border:1px solid #0e7490;border-radius:10px;background:#0891b2;color:#fff;font-weight:800}button:disabled{cursor:not-allowed;opacity:.45}button.secondary,.actions a{border:1px solid var(--line);background:#171c26;color:#dce5f2}.topbar{display:flex;align-items:center;justify-content:space-between;gap:2rem;padding:2rem clamp(1.25rem,4vw,4rem);border-bottom:1px solid var(--line);background:rgba(9,11,16,.82)}h1,h2,h3,p{margin-top:0}h1{margin-bottom:.35rem;font-size:clamp(1.7rem,3vw,2.5rem);letter-spacing:-.04em}.topbar p{margin-bottom:0;color:var(--muted)}.eyebrow,.section-kicker{margin-bottom:.45rem!important;color:var(--accent)!important;font-size:.72rem;font-weight:800;letter-spacing:.16em}.actions{display:flex;align-items:center;gap:.65rem}.actions span,.actions a{padding:.5rem .75rem;border-radius:999px;font-size:.72rem;font-weight:850;text-decoration:none}.actions span{border:1px solid #155e75;background:#083344;color:#a5f3fc}.shell{width:min(1180px,calc(100% - 2rem));margin:2rem auto 4rem}.notice,.access,#config-form,.history{margin-bottom:1rem;padding:1.3rem;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,rgba(23,28,38,.96),rgba(14,18,25,.96));box-shadow:0 20px 70px rgba(0,0,0,.22)}.notice{display:flex;gap:1rem}.notice-icon{display:grid;place-items:center;flex:0 0 2.2rem;height:2.2rem;border-radius:50%;background:#14532d;color:#bbf7d0;font-weight:900}.notice p{margin:.4rem 0 0;color:var(--muted);line-height:1.5}.access label{display:block;margin-bottom:.55rem;font-size:.82rem;font-weight:700}.access-row{display:grid;grid-template-columns:minmax(250px,1fr) auto auto;gap:.65rem}input{width:100%;min-height:44px;padding:0 .8rem;border:1px solid var(--line);border-radius:10px;background:#0b0f16;color:#eef2f7;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(34,211,238,.14)}input[readonly]{color:#9fb0c5;background:#0a0d12}.status{min-height:48px;display:flex;align-items:center;padding:.85rem 1rem;margin-bottom:1rem;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}.status[data-tone=error]{border-style:solid;border-color:#7f1d1d;background:rgba(69,10,10,.42);color:#fecaca}.status[data-tone=success]{border-style:solid;border-color:#14532d;background:rgba(5,46,22,.42);color:#bbf7d0}.version-row{display:grid;grid-template-columns:1fr 2fr minmax(180px,.8fr);gap:1rem;margin-bottom:1.2rem}.version-row>div,.version-row>label{padding:1rem;border:1px solid var(--line);border-radius:14px;background:#0d1118}.version-row span,.version-row label{color:var(--muted);font-size:.78rem;font-weight:700}.version-row strong{display:block;margin-top:.35rem}.version-row label input{margin-top:.5rem}.product-section{padding-top:.3rem}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:1rem}.section-heading h2{margin-bottom:0}.section-heading>p{max-width:420px;margin-bottom:0;color:var(--muted);font-size:.82rem;text-align:right}.products{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.product-card{position:relative;overflow:hidden;padding:1.25rem;border:1px solid var(--line);border-radius:18px;background:#0d1118}.product-card[data-product="painel-150"]{border-color:#155e75}.product-card[data-invalid=true]{border-color:#991b1b}.product-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.product-title{display:flex;gap:.75rem;align-items:center}.product-icon{display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:12px;background:#172033;color:#a5f3fc;font-size:1.3rem}.product-head h3{margin-bottom:.2rem}.product-key{margin:0;color:var(--muted);font-size:.72rem}.enabled{display:flex;align-items:center;gap:.5rem;color:var(--muted);font-size:.8rem}.enabled input{width:auto;min-height:auto}.origin{margin-top:1rem;padding:.9rem;border:1px solid #1f3a46;border-radius:13px;background:#09151b}.origin-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.55rem}.origin-head strong{font-size:.82rem}.locked{padding:.25rem .45rem;border:1px solid #166534;border-radius:999px;background:#052e16;color:#bbf7d0;font-size:.65rem;font-weight:850}.origin code{display:block;overflow-wrap:anywhere;color:#a5f3fc;font-size:.72rem}.origin p{margin:.5rem 0 0;color:var(--muted);font-size:.72rem}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin-top:1rem}.fields label{color:var(--muted);font-size:.78rem;font-weight:700}.fields input{margin-top:.4rem}.scope{margin:.8rem 0 0;color:var(--muted);font-size:.78rem}.preview{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin-top:1rem}.preview div{padding:.8rem;border:1px solid var(--line);border-radius:12px;background:#111722}.preview span{display:block;color:var(--muted);font-size:.68rem}.preview strong{display:block;margin-top:.25rem;font-size:.9rem}.validation{min-height:1.2rem;margin:.7rem 0 0;color:var(--danger);font-size:.74rem;font-weight:700}.save-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1.2rem;padding-top:1.2rem;border-top:1px solid var(--line)}.save-row p{max-width:700px;margin:0;color:var(--muted);font-size:.82rem;line-height:1.5}.history ol{margin:0;padding-left:1.2rem;color:var(--muted)}.history li{padding:.35rem 0}@media(max-width:820px){.topbar,.save-row,.section-heading{align-items:flex-start;flex-direction:column}.section-heading>p{text-align:left}.access-row,.version-row,.products,.fields{grid-template-columns:1fr}.shell{width:min(100% - 1rem,1180px)}}`;

export const ADMIN_COMMERCIAL_JS = `
(() => {
  'use strict';

  const PRODUCT_META = Object.freeze({
    '50x50': Object.freeze({
      label: 'Bolinhas 50x50',
      icon: '●',
      rootDriveId: '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae',
      rootLabel: 'Drive exclusivo de Bolinhas',
      scopeText: 'A quantidade mínima vale para o total de Bolinhas no carrinho.'
    }),
    'painel-150': Object.freeze({
      label: 'Painel redondo 150 cm',
      icon: '◯',
      rootDriveId: '18x1qthD2RXAxRi2u-d7U3wpJLfpINU7-',
      rootLabel: 'Drive exclusivo de Painel 150 cm',
      scopeText: 'A quantidade mínima e o incremento são aplicados a cada arte de Painel 150 cm.'
    })
  });
  const PRODUCT_KEYS = Object.freeze(Object.keys(PRODUCT_META));
  const state = { token:'', loading:false, config:null };
  const form = document.getElementById('access-form');
  const configForm = document.getElementById('config-form');
  const tokenInput = document.getElementById('token');
  const disconnectButton = document.getElementById('disconnect');
  const saveButton = document.getElementById('save');
  const statusNode = document.getElementById('status');
  const productsNode = document.getElementById('products');
  const historyCard = document.getElementById('history-card');
  const historyNode = document.getElementById('history');
  const versionNode = document.getElementById('version');
  const updatedNode = document.getElementById('updated-at');
  const discountInput = document.getElementById('discount');
  const dateTime = new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Recife'});
  const money = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const candidate = String(tokenInput.value||'').trim();
    if(candidate.length<32){setStatus('A chave precisa ter pelo menos 32 caracteres.','error');return;}
    state.token=candidate;
    await loadConfig();
  });
  configForm.addEventListener('submit', saveConfig);
  configForm.addEventListener('input', () => refreshValidation());
  disconnectButton.addEventListener('click', disconnect);

  async function loadConfig(successText='Configuração carregada. O token permanece apenas na memória desta aba.'){
    if(!state.token||state.loading)return;
    setBusy(true);setStatus('Carregando produtos e regras comerciais...','neutral');
    try{
      const result=await request('/internal/v2/admin/commercial-config?history=10');
      state.config=result.config;
      render(result.config,result.history||[]);
      disconnectButton.disabled=false;tokenInput.value='';configForm.hidden=false;historyCard.hidden=false;
      setStatus(successText,'success');
    }catch(error){setStatus(message(error),'error');if(error.status===401)disconnect();}
    finally{setBusy(false);refreshValidation();}
  }

  async function saveConfig(event){
    event.preventDefault();
    if(!state.config||state.loading)return;
    const validation=validateForm();
    if(!validation.ok){renderValidation(validation);setStatus('Corrija as regras destacadas antes de publicar.','error');return;}
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
    }finally{if(state.loading)setBusy(false);refreshValidation();}
  }

  function render(config,history){
    versionNode.textContent=String(config.version||0);
    updatedNode.textContent=config.updatedAt?dateTime.format(new Date(config.updatedAt)):'Versão inicial';
    discountInput.value=String(config.effectiveDiscountPercent||0);
    productsNode.innerHTML=PRODUCT_KEYS.map(key=>productCard(key,config.products[key])).join('');
    historyNode.innerHTML=history.length?history.map(item=>'<li>Versão '+escapeHtml(item.version)+' · '+escapeHtml(item.actor||'sistema')+' · '+escapeHtml(formatDate(item.createdAt))+'</li>').join(''):'<li>Nenhuma alteração adicional.</li>';
    refreshValidation();
  }

  function productCard(key,product){
    const meta=PRODUCT_META[key];
    const scope=product.quantity.scope==='item'?'por item':'total do produto no carrinho';
    return '<article class="product-card" data-product="'+escapeHtml(key)+'">'+
      '<div class="product-head"><div class="product-title"><span class="product-icon" aria-hidden="true">'+escapeHtml(meta.icon)+'</span><div><h3>'+escapeHtml(product.label||meta.label)+'</h3><p class="product-key">Produto: '+escapeHtml(key)+'</p></div></div>'+
      '<label class="enabled"><input id="'+fieldId(key,'enabled')+'" type="checkbox" '+(product.enabled?'checked':'')+'> Disponível</label></div>'+
      '<div class="origin"><div class="origin-head"><strong>'+escapeHtml(meta.rootLabel)+'</strong><span class="locked">ORIGEM PROTEGIDA</span></div><code>'+escapeHtml(meta.rootDriveId)+'</code><p>Somente artes descendentes desta raiz podem aparecer neste módulo.</p></div>'+
      '<div class="fields">'+field(key,'unitPrice','Preço unitário (R$)',product.unitPrice,'0.01')+field(key,'minimum','Quantidade mínima',product.quantity.minimum,'1')+field(key,'step','Incremento de quantidade',product.quantity.step,'1')+field(key,'initialQuantity','Quantidade inicial sugerida',product.quantity.initial,'1')+'</div>'+
      '<p class="scope">Regra aplicada '+escapeHtml(scope)+'. '+escapeHtml(meta.scopeText)+'</p>'+
      '<div class="preview"><div><span>Preço por unidade</span><strong id="'+fieldId(key,'pricePreview')+'">—</strong></div><div><span>Pedido na quantidade inicial</span><strong id="'+fieldId(key,'initialPreview')+'">—</strong></div></div>'+
      '<p class="validation" id="'+fieldId(key,'validation')+'" aria-live="polite"></p></article>';
  }

  function field(key,name,label,value,step){return '<label>'+escapeHtml(label)+'<input id="'+fieldId(key,name)+'" type="number" min="'+(name==='unitPrice'?'0':'1')+'" max="1000000" step="'+step+'" value="'+escapeHtml(value)+'" required></label>';}
  function fieldId(key,name){return 'product-'+key.replace(/[^a-z0-9]/gi,'-')+'-'+name;}

  function refreshValidation(){
    if(!state.config||configForm.hidden)return;
    const validation=validateForm();
    renderValidation(validation);
    saveButton.disabled=state.loading||!validation.ok;
    for(const key of PRODUCT_KEYS)renderPreview(key);
  }

  function validateForm(){
    const errors={};
    const discount=number(discountInput.value);
    if(!Number.isFinite(discount)||discount<0||discount>100)errors.discount='O desconto deve ficar entre 0% e 100%.';
    for(const key of PRODUCT_KEYS){
      const price=number(value(key,'unitPrice'));
      const minimum=integer(value(key,'minimum'));
      const step=integer(value(key,'step'));
      const initial=integer(value(key,'initialQuantity'));
      const productErrors=[];
      if(!Number.isFinite(price)||price<0)productErrors.push('Informe um preço válido.');
      if(!Number.isInteger(minimum)||minimum<1)productErrors.push('A quantidade mínima deve ser maior que zero.');
      if(!Number.isInteger(step)||step<1)productErrors.push('O incremento deve ser maior que zero.');
      if(!Number.isInteger(initial)||initial<1)productErrors.push('A quantidade inicial deve ser maior que zero.');
      if(Number.isInteger(initial)&&Number.isInteger(minimum)&&initial<minimum)productErrors.push('A quantidade inicial não pode ser menor que a mínima.');
      if(Number.isInteger(initial)&&Number.isInteger(minimum)&&Number.isInteger(step)&&step>0&&initial>=minimum&&(initial-minimum)%step!==0)productErrors.push('A quantidade inicial precisa respeitar o incremento a partir da mínima.');
      if(productErrors.length)errors[key]=productErrors.join(' ');
    }
    return {ok:Object.keys(errors).length===0,errors};
  }

  function renderValidation(validation){
    for(const key of PRODUCT_KEYS){
      const card=productsNode.querySelector('[data-product="'+key+'"]');
      const text=validation.errors[key]||'';
      if(card)card.dataset.invalid=text?'true':'false';
      const node=document.getElementById(fieldId(key,'validation'));
      if(node)node.textContent=text;
    }
  }

  function renderPreview(key){
    const price=number(value(key,'unitPrice'));
    const initial=integer(value(key,'initialQuantity'));
    const discount=number(discountInput.value);
    const validPrice=Number.isFinite(price)&&price>=0;
    const validInitial=Number.isInteger(initial)&&initial>0;
    const unit=validPrice?price:0;
    const total=validInitial?unit*initial:0;
    const discounted=total*(1-Math.min(Math.max(Number.isFinite(discount)?discount:0,0),100)/100);
    setText(fieldId(key,'pricePreview'),validPrice?money.format(unit):'—');
    setText(fieldId(key,'initialPreview'),validPrice&&validInitial?money.format(discounted):'—');
  }

  function value(key,name){return document.getElementById(fieldId(key,name))?.value;}
  function setText(id,text){const node=document.getElementById(id);if(node)node.textContent=text;}

  async function request(path,init={}){
    const headers=new Headers(init.headers||{});headers.set('X-Staging-Token',state.token);headers.set('Accept','application/json');
    const response=await fetch(path,{...init,headers,cache:'no-store',credentials:'same-origin'});
    let payload={};try{payload=await response.json();}catch(_){payload={};}
    if(!response.ok||payload.ok!==true){const error=new Error(payload.error||'ADMIN_COMMERCIAL_REQUEST_FAILED');error.code=payload.error||'ADMIN_COMMERCIAL_REQUEST_FAILED';error.status=response.status;error.currentVersion=payload.currentVersion;throw error;}
    return payload;
  }
  function disconnect(){state.token='';state.config=null;tokenInput.value='';disconnectButton.disabled=true;configForm.hidden=true;historyCard.hidden=true;productsNode.innerHTML='';setStatus('Desconectado. A chave foi removida da memória da aba.','neutral');}
  function setBusy(value){state.loading=value;form.querySelectorAll('button,input').forEach(node=>node.disabled=value);configForm.querySelectorAll('button,input').forEach(node=>node.disabled=value);disconnectButton.disabled=value||!state.token;if(!value&&state.config)refreshValidation();}
  function setStatus(text,tone){statusNode.textContent=text;statusNode.dataset.tone=tone==='neutral'?'':tone;}
  function message(error){if(error.status===401)return'Chave inválida ou expirada.';if(error.code==='COMMERCIAL_CONFIG_INVALID')return'Existem valores comerciais inválidos. Confira preço, mínimo, incremento e quantidade inicial.';return'Não foi possível concluir a operação. Código: '+String(error.code||'ADMIN_COMMERCIAL_REQUEST_FAILED');}
  function number(value){return Number(String(value??'').replace(',','.'));}
  function integer(value){const text=String(value??'').trim();if(!/^[0-9]+$/.test(text))return NaN;return Number.parseInt(text,10);}
  function formatDate(value){try{return dateTime.format(new Date(value));}catch(_){return String(value||'');}}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);}
})();`;
