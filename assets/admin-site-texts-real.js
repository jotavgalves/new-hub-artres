(function(){
  var cfg = null;
  var saving = false;
  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>'"]/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]; }); }
  async function api(url, opts){
    var r = await fetch(url, { credentials:'include', cache:'no-store', headers:{'Content-Type':'application/json'}, ...(opts || {}) });
    var d = await r.json().catch(function(){ return {}; });
    if (!r.ok || d.ok === false) throw new Error(d.error || 'Erro');
    return d;
  }
  function toast(msg, type){
    var s = $('status');
    if (!s) return;
    s.textContent = msg;
    s.className = 'status ' + (type || 'ok');
    s.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(function(){ if (s.textContent === msg) s.classList.add('hidden'); }, type === 'err' ? 6500 : 3500);
  }
  function defaults(){
    return {
      hero:{eyebrow:'Escolha suas artes',title:'Vamos montar sua festa?',subtitle:'Escolha o tema, veja os produtos disponíveis e selecione as artes que mais combinam com a sua comemoração. Escolhendo por aqui, seu pedido já sai organizado no atendimento pelo WhatsApp.'},
      promo:{pill:'Pedido organizado',title:'Escolha suas artes com calma',text:'Monte sua seleção por aqui e envie tudo organizado para a vendedora confirmar pelo WhatsApp.'},
      catalog:{initialTitle:'Escolha um tema',initialCaption:'Escolha o tema da sua festa. Depois você vê as peças disponíveis e adiciona só as artes que mais gostar.',searchPlaceholder:'Buscar por código, tema ou peça...',favoritesButton:'Ver favoritas',addFavoritesButton:'Adicionar favoritas',previewText:'Gostou dessa arte? Adicione ao pedido ou marque como favorita para comparar depois.',addButton:'Adicionar arte',favoriteButton:'Favoritar',closeButton:'Fechar'},
      cart:{title:'Seu orçamento',sellerTitle:'Escolha sua vendedora',sellerHint:'Selecione para quem você quer enviar sua seleção no WhatsApp.',sendButton:'Enviar pedido',openCartButton:'Ver carrinho',emptyCart:'Seu carrinho ainda está vazio.'},
      steps:[{title:'1. Escolha o tema',text:'Comece pelo universo da festa.'},{title:'2. Escolha o produto',text:'Veja só as opções disponíveis naquele tema.'},{title:'3. Selecione as artes',text:'Toque para ampliar, favoritar ou adicionar.'},{title:'4. Envie pronto',text:'A vendedora recebe tudo organizado.'}]
    };
  }
  function mergeContent(raw){
    var d = defaults(); raw = raw || {};
    ['hero','promo','catalog','cart'].forEach(function(group){ Object.keys(d[group]).forEach(function(k){ if (raw[group] && String(raw[group][k] || '').trim()) d[group][k] = raw[group][k]; }); });
    if (Array.isArray(raw.steps)) d.steps = d.steps.map(function(s,i){ return { title:(raw.steps[i] && raw.steps[i].title) || s.title, text:(raw.steps[i] && raw.steps[i].text) || s.text }; });
    return d;
  }
  function field(id,label,value,textarea,hint){ return '<div class="field span-12"><label>'+esc(label)+'</label>'+(textarea?'<textarea id="'+id+'">'+esc(value)+'</textarea>':'<input id="'+id+'" value="'+esc(value)+'">')+(hint?'<p class="hint">'+hint+'</p>':'')+'</div>'; }
  function readPanel(){
    cfg.content = cfg.content || {};
    cfg.content.hero = { eyebrow:val('txt_hero_eyebrow'), title:val('txt_hero_title'), subtitle:val('txt_hero_subtitle') };
    cfg.content.promo = { pill:val('txt_promo_pill'), title:val('txt_promo_title'), text:val('txt_promo_text') };
    cfg.content.catalog = { initialTitle:val('txt_catalog_initialTitle'), initialCaption:val('txt_catalog_initialCaption'), searchPlaceholder:val('txt_catalog_searchPlaceholder'), favoritesButton:val('txt_catalog_favoritesButton'), addFavoritesButton:val('txt_catalog_addFavoritesButton'), previewText:val('txt_catalog_previewText'), addButton:val('txt_catalog_addButton'), favoriteButton:val('txt_catalog_favoriteButton'), closeButton:val('txt_catalog_closeButton') };
    cfg.content.cart = { title:val('txt_cart_title'), sellerTitle:val('txt_cart_sellerTitle'), sellerHint:val('txt_cart_sellerHint'), sendButton:val('txt_cart_sendButton'), openCartButton:val('txt_cart_openCartButton'), emptyCart:val('txt_cart_emptyCart') };
    cfg.content.steps = [0,1,2,3].map(function(i){ return { title:val('txt_step_title_'+i), text:val('txt_step_text_'+i) }; });
  }
  function val(id){ return ($(id) || {}).value || ''; }
  async function save(){
    if (saving) return;
    saving = true;
    try { readPanel(); await api('/api/admin/config',{method:'POST',body:JSON.stringify({config:cfg})}); toast('Textos reais do site salvos.'); render(true); }
    catch(e){ toast(e.message || 'Erro ao salvar textos.', 'err'); }
    finally{ saving = false; }
  }
  function preview(c){
    return '<div class="previewHero"><div class="left"><span class="previewEyebrow">'+esc(c.hero.eyebrow)+'</span><h4>'+esc(c.hero.title)+'</h4><p>'+esc(c.hero.subtitle)+'</p></div><div class="right"><div class="previewSteps">'+c.steps.map(function(s){ return '<div class="previewStep"><b>'+esc(s.title)+'</b><span>'+esc(s.text)+'</span></div>'; }).join('')+'</div><div class="previewPromo"><small>'+esc(c.promo.pill)+'</small><b>'+esc(c.promo.title)+'</b><p>'+esc(c.promo.text)+'</p></div></div></div>';
  }
  async function render(force){
    var p = $('textsPanel');
    if (!p) return;
    if (p.dataset.realOwner === 'siteTexts' && !force) return;
    var d = await api('/api/admin/config?ts=' + Date.now()).catch(function(){ return null; });
    if (!d) return;
    cfg = d.config || {};
    var c = mergeContent(cfg.content || {});
    p.dataset.realOwner = 'siteTexts';
    p.innerHTML = '<div class="card span-12"><div class="sectionHead"><div><h3>Textos reais do site</h3><p>Esses campos agora alimentam o site por /api/public-content e são aplicados no catálogo público.</p></div><button id="saveRealSiteTexts" class="btn green" type="button">Salvar textos do site</button></div></div>'
    + '<div class="card span-12"><div class="sectionHead"><div><h3>Hero e chamada inicial</h3><p>Primeiro bloco visível do site.</p></div></div><div class="grid">'+field('txt_hero_eyebrow','Selo',c.hero.eyebrow,false)+field('txt_hero_title','Título',c.hero.title,false)+field('txt_hero_subtitle','Subtítulo',c.hero.subtitle,true)+'</div></div>'
    + '<div class="card span-12"><div class="sectionHead"><div><h3>Passo a passo</h3><p>Quatro cards do topo.</p></div></div><div class="grid">'+c.steps.map(function(s,i){return '<div class="item span-6">'+field('txt_step_title_'+i,'Passo '+(i+1)+' - título',s.title,false)+field('txt_step_text_'+i,'Passo '+(i+1)+' - texto',s.text,true)+'</div>';}).join('')+'</div></div>'
    + '<div class="card span-12"><div class="sectionHead"><div><h3>Banner/chamada lateral</h3><p>Bloco colorido ao lado do passo a passo.</p></div></div><div class="grid">'+field('txt_promo_pill','Selo',c.promo.pill,false)+field('txt_promo_title','Título',c.promo.title,false)+field('txt_promo_text','Texto',c.promo.text,true)+'</div></div>'
    + '<div class="card span-12"><div class="sectionHead"><div><h3>Catálogo</h3><p>Textos da área de temas, busca, favoritos e modal da arte.</p></div></div><div class="grid">'+field('txt_catalog_initialTitle','Título inicial',c.catalog.initialTitle,false)+field('txt_catalog_initialCaption','Legenda inicial',c.catalog.initialCaption,true)+field('txt_catalog_searchPlaceholder','Placeholder da busca',c.catalog.searchPlaceholder,false)+field('txt_catalog_favoritesButton','Botão favoritas',c.catalog.favoritesButton,false)+field('txt_catalog_addFavoritesButton','Botão adicionar favoritas',c.catalog.addFavoritesButton,false)+field('txt_catalog_previewText','Texto do preview da arte',c.catalog.previewText,true)+field('txt_catalog_addButton','Botão adicionar arte',c.catalog.addButton,false)+field('txt_catalog_favoriteButton','Botão favoritar',c.catalog.favoriteButton,false)+field('txt_catalog_closeButton','Botão fechar',c.catalog.closeButton,false)+'</div></div>'
    + '<div class="card span-12"><div class="sectionHead"><div><h3>Carrinho</h3><p>Textos principais do orçamento e envio.</p></div></div><div class="grid">'+field('txt_cart_title','Título do carrinho',c.cart.title,false)+field('txt_cart_sellerTitle','Título vendedora',c.cart.sellerTitle,false)+field('txt_cart_sellerHint','Ajuda vendedora',c.cart.sellerHint,true)+field('txt_cart_sendButton','Botão enviar',c.cart.sendButton,false)+field('txt_cart_openCartButton','Botão abrir carrinho',c.cart.openCartButton,false)+field('txt_cart_emptyCart','Carrinho vazio',c.cart.emptyCart,false)+'</div></div>'
    + '<div class="card span-12"><div class="sectionHead"><div><h3>Prévia</h3><p>Hero, passos e chamada lateral.</p></div></div><div id="realTextsPreview">'+preview(c)+'</div></div>';
    $('saveRealSiteTexts').onclick = save;
    p.querySelectorAll('input,textarea').forEach(function(el){ el.addEventListener('input', function(){ var current = mergeContent({hero:{eyebrow:val('txt_hero_eyebrow'),title:val('txt_hero_title'),subtitle:val('txt_hero_subtitle')},promo:{pill:val('txt_promo_pill'),title:val('txt_promo_title'),text:val('txt_promo_text')},steps:[0,1,2,3].map(function(i){return {title:val('txt_step_title_'+i),text:val('txt_step_text_'+i)}})}); var box=$('realTextsPreview'); if(box) box.innerHTML=preview(current); }); });
  }
  document.addEventListener('click', function(e){ var tab=e.target&&e.target.closest&&e.target.closest('[data-tab]'); if(tab&&tab.dataset.tab==='textsView') setTimeout(function(){render(true);},300); });
  new MutationObserver(function(){ if(document.body.dataset.adminTab==='textsView') render(false); }).observe(document.body,{childList:true,subtree:true});
  setTimeout(function(){ render(false); },1400);
})();
