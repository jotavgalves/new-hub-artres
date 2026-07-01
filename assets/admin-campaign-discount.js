(function(){
  var currentConfig = null;
  function $(id){ return document.getElementById(id); }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>'"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m];}); }
  function num(v){ return Number(String(v || '').replace(',', '.').replace(/[^0-9.]/g, '')) || 0; }
  async function api(url, opts){
    var r = await fetch(url, Object.assign({ credentials:'include', headers:{ 'Content-Type':'application/json' } }, opts || {}));
    var d = await r.json().catch(function(){ return {}; });
    if(!r.ok || d.ok === false) throw new Error(d.error || 'Erro');
    return d;
  }
  function toast(msg, type){
    var el = $('status');
    if(!el) return;
    el.textContent = msg;
    el.className = 'status ' + (type || 'ok');
    el.classList.remove('hidden');
  }
  async function loadConfig(){
    var d = await api('/api/admin/config');
    currentConfig = d.config || {};
    currentConfig.campaign = currentConfig.campaign || {};
    currentConfig.ui = currentConfig.ui || {};
    currentConfig.content = currentConfig.content || {};
    return currentConfig;
  }
  function setDiscountTexts(c, pct){
    c.content = c.content || {};
    c.content.promo = c.content.promo || {};
    c.content.cart = c.content.cart || {};
    c.content.whatsapp = c.content.whatsapp || {};
    c.content.promo.pill = '{desconto}% OFF POR AQUI';
    c.content.promo.title = 'Escolha suas artes com calma e já envie com desconto';
    c.content.promo.text = 'Montando sua seleção por aqui, o desconto de {desconto}% é aplicado automaticamente no orçamento. Você chega no WhatsApp com tudo organizado para a vendedora confirmar.';
    c.content.cart.savingsBadge = '{desconto}% OFF POR AQUI';
    c.content.cart.savingsTitle = 'Você economiza {valor}';
    c.content.cart.savingsText = 'O desconto já entra automaticamente no total antes de enviar para a vendedora. Quanto mais você escolhe por aqui, mais fácil fica finalizar seu pedido.';
    c.content.cart.sendButton = 'Enviar pedido com {desconto}% OFF';
    c.content.whatsapp.intro = 'Olá, gostaria de fazer esse pedido com {desconto}% de desconto:';
    c.content.whatsapp.totalLine = 'Total com desconto: {total}';
  }
  function setOrganizedTexts(c){
    c.content = c.content || {};
    c.content.promo = c.content.promo || {};
    c.content.cart = c.content.cart || {};
    c.content.whatsapp = c.content.whatsapp || {};
    c.content.promo.pill = 'PEDIDO ORGANIZADO';
    c.content.promo.title = 'Escolha suas artes com calma e envie tudo pronto';
    c.content.promo.text = 'Sua seleção chega no WhatsApp da vendedora com os códigos, quantidades e dados do cliente organizados para agilizar o atendimento.';
    c.content.cart.savingsBadge = 'SELEÇÃO ORGANIZADA';
    c.content.cart.savingsTitle = 'Seu pedido vai pronto para a vendedora';
    c.content.cart.savingsText = 'Ao finalizar, enviamos os códigos escolhidos, quantidades e seus dados de contato em uma solicitação organizada.';
    c.content.cart.sendButton = 'Enviar';
    c.content.whatsapp.intro = 'Olá, gostaria de enviar esta seleção de artes:';
    c.content.whatsapp.totalLine = 'Total: {total}';
  }
  async function saveConfig(c, msg){
    c.ui = c.ui || {};
    c.ui.cacheVersion = Number(c.ui.cacheVersion || 1) + 1;
    var d = await api('/api/admin/config', { method:'POST', body: JSON.stringify({ config:c }) });
    try { await api('/api/admin/cache', { method:'POST' }); } catch(e) {}
    currentConfig = d.config || c;
    toast(msg);
    renderCard();
  }
  async function activate(){
    try{
      var c = currentConfig || await loadConfig();
      var pct = num($('campaignQuickPercent') && $('campaignQuickPercent').value) || num(c.campaign.discountPercent) || num(c.ui.discountPercent) || 10;
      c.campaign = c.campaign || {};
      c.ui = c.ui || {};
      c.campaign.active = true;
      c.campaign.discountPercent = pct;
      c.ui.discountPercent = pct;
      setDiscountTexts(c, pct);
      await saveConfig(c, 'Campanha de desconto ativada e migrada para Campanhas.');
    }catch(e){ toast(e.message, 'err'); }
  }
  async function disable(){
    try{
      var c = currentConfig || await loadConfig();
      var pct = num($('campaignQuickPercent') && $('campaignQuickPercent').value) || num(c.campaign.discountPercent) || num(c.ui.discountPercent) || 10;
      c.campaign = c.campaign || {};
      c.ui = c.ui || {};
      c.campaign.active = false;
      c.campaign.discountPercent = pct;
      c.ui.discountPercent = 0;
      setOrganizedTexts(c);
      await saveConfig(c, 'Campanha desligada. O site fica no modo Enviar, sem desconto visual.');
    }catch(e){ toast(e.message, 'err'); }
  }
  function migrateValues(){
    if(!currentConfig) return;
    var pct = num(currentConfig.campaign && currentConfig.campaign.discountPercent) || num(currentConfig.ui && currentConfig.ui.discountPercent) || 10;
    var active = currentConfig.campaign && currentConfig.campaign.active !== false && num(currentConfig.ui && currentConfig.ui.discountPercent) > 0;
    var state = $('campaignQuickState');
    var percent = $('campaignQuickPercent');
    if(state) state.textContent = active ? 'Ativa' : 'Desligada';
    if(percent) percent.value = pct;
  }
  function hideLegacyFields(){
    var panel = $('campaignsPanel');
    if(!panel) return;
    panel.querySelectorAll('.field').forEach(function(field){
      var txt = (field.querySelector('label') && field.querySelector('label').textContent || '').trim();
      if(['Campanha ativa','Desconto da campanha (%)','Desconto aplicado no site (%)'].indexOf(txt) > -1){
        field.classList.add('campaignLegacyHidden');
      }
    });
  }
  function renderCard(){
    var panel = $('campaignsPanel');
    if(!panel) return;
    hideLegacyFields();
    var old = $('campaignDiscountMigratedCard');
    if(old) old.remove();
    var pct = currentConfig ? (num(currentConfig.campaign && currentConfig.campaign.discountPercent) || num(currentConfig.ui && currentConfig.ui.discountPercent) || 10) : 10;
    var active = currentConfig && currentConfig.campaign && currentConfig.campaign.active !== false && num(currentConfig.ui && currentConfig.ui.discountPercent) > 0;
    var card = document.createElement('div');
    card.id = 'campaignDiscountMigratedCard';
    card.className = 'card span-12 campaignQuickCard';
    card.innerHTML = '<div class="sectionHead"><div><h3>Campanha de desconto</h3><p>Controle rápido da promoção. O campo financeiro foi migrado para cá.</p></div><span class="pill" id="campaignQuickState">' + (active ? 'Ativa' : 'Desligada') + '</span></div><div class="grid"><div class="field span-4"><label>Percentual pronto para campanha</label><input id="campaignQuickPercent" value="' + esc(pct) + '"></div><div class="item span-8"><b>Modo atual</b><p class="hint">Desligado: botão “Enviar”, sem 0% OFF, sem economia R$ 0,00. Ativo: volta desconto, economia e total com desconto.</p></div></div><div class="actions" style="margin-top:14px"><button id="campaignQuickDisable" class="btn secondary" type="button">Usar modo Enviar</button><button id="campaignQuickActivate" class="btn green" type="button">Ativar campanha</button></div>';
    panel.prepend(card);
    $('campaignQuickDisable').onclick = disable;
    $('campaignQuickActivate').onclick = activate;
    migrateValues();
  }
  function injectStyle(){
    if($('campaignDiscountStyle')) return;
    var s = document.createElement('style');
    s.id = 'campaignDiscountStyle';
    s.textContent = '.campaignLegacyHidden{display:none!important}.campaignQuickCard{border-color:#ffd6e5!important;background:radial-gradient(circle at 96% 18%,rgba(239,85,133,.10),transparent 32%),#fff!important}.campaignQuickCard .pill{background:#fff1f6;color:#d9366b;border:1px solid #ffd6e5}';
    document.head.appendChild(s);
  }
  async function openCampaigns(){
    injectStyle();
    try{ await loadConfig(); }catch(e){}
    renderCard();
  }
  document.addEventListener('click', function(e){
    if(e.target && e.target.closest('[data-tab="campaignsView"]')) setTimeout(openCampaigns, 400);
  });
  setInterval(function(){ if($('campaignsPanel') && !$('campaignsView').classList.contains('hidden')) openCampaigns(); }, 1500);
})();
