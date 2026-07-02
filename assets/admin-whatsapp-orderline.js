(function(){
  var saving = false;
  var cfg = null;
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
  function realWhatsapp(w){
    w = w || {};
    var intro = String(w.intro || '').trim();
    var totalLine = String(w.totalLine || '').trim();
    return {
      intro: !intro || /desconto/i.test(intro) ? 'Oi, {vendedora}! Separei minhas artes por aqui e quero finalizar minha seleção.' : intro,
      orderLine: w.orderLine || 'Pedido: {pedido}',
      sellerLine: w.sellerLine && !/vendedora/i.test(w.sellerLine) ? w.sellerLine : 'Minha seleção:',
      itemLine: w.itemLine && !/tema/i.test(w.itemLine) ? w.itemLine : '• Arte #{codigo}{quantidadeTexto}',
      totalLine: !totalLine || /total com desconto/i.test(totalLine) ? 'Observação: há medida personalizada nesta seleção.' : totalLine,
      footer: w.footer && !/catálogo online/i.test(w.footer) ? w.footer : 'Pode conferir para mim e me ajudar a finalizar?'
    };
  }
  function replaceHelenaText(){
    document.querySelectorAll('#catalogPanel .blockInfo small,#catalogPanel .historyItem small').forEach(function(el){
      if ((el.textContent || '').indexOf('Helena') > -1) el.textContent = el.textContent.replace(/Helena\/Admin|Helena Admin|Helena/g, 'Armazem');
    });
  }
  function field(id, label, value, textarea, hint){
    return '<div class="field span-12"><label>' + esc(label) + '</label>' + (textarea ? '<textarea id="' + id + '">' + esc(value) + '</textarea>' : '<input id="' + id + '" value="' + esc(value) + '">') + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
  }
  function apply(text, map){
    return String(text || '').replace(/\{([^}]+)\}/g, function(all, key){ return map[key] == null ? all : map[key]; });
  }
  function previewMessage(w){
    var map = { vendedora:'Ana', pedido:'PED2600003A', codigo:'1767', quantidadeTexto:'', quantidade:1 };
    var lines = [
      apply(w.intro, map),
      '',
      apply(w.orderLine, map),
      '',
      apply(w.sellerLine, map),
      '',
      'Bolinhas',
      'Tema(s): TORAJÓ',
      apply(w.itemLine, map),
      '• Arte #1542',
      '',
      apply(w.footer, map)
    ];
    return lines.filter(function(line, i){ return line || lines[i-1]; }).join('\n');
  }
  async function loadConfig(){
    var d = await api('/api/admin/config?ts=' + Date.now());
    cfg = d.config || {};
    cfg.content = cfg.content || {};
    cfg.content.whatsapp = realWhatsapp(cfg.content.whatsapp || {});
    cfg.content.modal = cfg.content.modal || {};
    return cfg;
  }
  function readPanel(){
    cfg.content = cfg.content || {};
    cfg.content.whatsapp = cfg.content.whatsapp || {};
    cfg.content.modal = cfg.content.modal || {};
    ['intro','orderLine','sellerLine','itemLine','totalLine','footer'].forEach(function(k){ cfg.content.whatsapp[k] = ($('wa_' + k) || {}).value || ''; });
    ['title','subtitle','countText','backButton','confirmButton','previousButton','nextButton','closeButton'].forEach(function(k){ var el = $('modal_' + k); if (el) cfg.content.modal[k] = el.value || ''; });
  }
  async function savePanel(){
    if (saving) return;
    saving = true;
    try {
      readPanel();
      await api('/api/admin/config', { method:'POST', body:JSON.stringify({ config:cfg }) });
      toast('WhatsApp e modal salvos como fonte real do site.');
      renderWhatsappPanel(true);
    } catch(e) { toast(e.message || 'Erro ao salvar WhatsApp e modal.', 'err'); }
    finally { saving = false; }
  }
  async function renderWhatsappPanel(force){
    var panel = $('whatsappPanel');
    if (!panel) return;
    if (panel.dataset.realOwner === 'whatsapp' && !force) return;
    var config = await loadConfig().catch(function(){ return null; });
    if (!config) return;
    var w = config.content.whatsapp;
    var m = config.content.modal || {};
    panel.dataset.realOwner = 'whatsapp';
    panel.innerHTML = '<div class="card span-12"><div class="sectionHead"><div><h3>Mensagem real do WhatsApp</h3><p>Esses campos controlam a mensagem final enviada para a vendedora depois que o pedido é salvo.</p></div><button id="saveRealWhatsapp" class="btn green" type="button">Salvar WhatsApp e modal</button></div><div class="grid">'
      + field('wa_intro','Introdução',w.intro,true,'Tokens: <b>{vendedora}</b>')
      + field('wa_orderLine','Linha do pedido',w.orderLine,false,'Token obrigatório: <b>{pedido}</b>')
      + field('wa_sellerLine','Título da seleção',w.sellerLine,false,'Exemplo: Minha seleção:')
      + field('wa_itemLine','Linha de arte',w.itemLine,true,'Tokens: <b>{codigo}</b>, <b>{quantidadeTexto}</b>, <b>{quantidade}</b>')
      + field('wa_totalLine','Aviso de medida personalizada',w.totalLine,true,'Aparece somente se houver item personalizado.')
      + field('wa_footer','Fechamento',w.footer,true,'Última frase da mensagem.')
      + '</div></div><div class="card span-12"><div class="sectionHead"><div><h3>Prévia real</h3><p>Exemplo do que abre no WhatsApp.</p></div></div><pre id="realWaPreview" class="jsonBox"></pre></div><div class="card span-12"><div class="sectionHead"><div><h3>Modal de confirmação</h3><p>Campos reais do modal antes de abrir o WhatsApp.</p></div></div><div class="grid">'
      + field('modal_title','Título do modal',m.title || 'Confira suas artes antes de enviar',false)
      + field('modal_subtitle','Subtítulo do modal',m.subtitle || '',true)
      + field('modal_countText','Contador',m.countText || 'Você selecionou {quantidade} arte(s).',false)
      + field('modal_backButton','Botão voltar',m.backButton || 'Voltar e ajustar',false)
      + field('modal_confirmButton','Botão confirmar',m.confirmButton || 'Confirmar e enviar',false)
      + field('modal_previousButton','Anterior',m.previousButton || 'Anterior',false)
      + field('modal_nextButton','Próxima',m.nextButton || 'Próxima',false)
      + field('modal_closeButton','Fechar',m.closeButton || 'Fechar',false)
      + '</div></div>';
    $('saveRealWhatsapp').onclick = savePanel;
    panel.querySelectorAll('input,textarea').forEach(function(el){ el.addEventListener('input', function(){ var w = { intro:($('wa_intro')||{}).value, orderLine:($('wa_orderLine')||{}).value, sellerLine:($('wa_sellerLine')||{}).value, itemLine:($('wa_itemLine')||{}).value, totalLine:($('wa_totalLine')||{}).value, footer:($('wa_footer')||{}).value }; var p = $('realWaPreview'); if (p) p.textContent = previewMessage(w); }); });
    var p = $('realWaPreview'); if (p) p.textContent = previewMessage(w);
  }
  function renderTextsAudit(){
    var p = $('textsPanel');
    if (!p || p.dataset.realOwner === 'audit') return;
    p.dataset.realOwner = 'audit';
    p.innerHTML = '<div class="card span-12"><div class="sectionHead"><div><h3>Textos do site — auditoria</h3><p>Esta aba tinha campos antigos que não controlavam 100% do site atual. Para evitar maquiagem, os campos legados foram travados aqui.</p></div></div><div class="item"><b>Fonte real confirmada agora</b><p class="hint">WhatsApp e modal foram migrados para campos reais na aba WhatsApp e modal.</p></div><div class="item"><b>Campos ainda em migração</b><p class="hint">Hero, catálogo, carrinho, campanhas e aparência ainda misturam config com trechos do index.html. Não vou fingir que esses campos controlam tudo até migrar cada trecho para uma fonte única.</p></div><div class="item"><b>Próxima etapa limpa</b><p class="hint">Migrar texto por texto do index.html para config pública, depois reativar esta aba apenas com campos realmente conectados.</p></div></div>';
  }
  document.addEventListener('click', function(e){
    var tab = e.target && e.target.closest && e.target.closest('[data-tab]');
    if (tab && tab.dataset.tab === 'whatsappView') setTimeout(function(){ renderWhatsappPanel(true); }, 250);
    if (tab && tab.dataset.tab === 'textsView') setTimeout(renderTextsAudit, 250);
  });
  new MutationObserver(function(){ replaceHelenaText(); if (document.body.dataset.adminTab === 'whatsappView') renderWhatsappPanel(false); if (document.body.dataset.adminTab === 'textsView') renderTextsAudit(); }).observe(document.body, { childList:true, subtree:true });
  setTimeout(function(){ replaceHelenaText(); renderWhatsappPanel(false); renderTextsAudit(); }, 1300);
})();
