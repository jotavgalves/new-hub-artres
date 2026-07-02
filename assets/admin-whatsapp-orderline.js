(function(){
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
  function replaceHelenaText(){
    document.querySelectorAll('#catalogPanel .blockInfo small,#catalogPanel .historyItem small').forEach(function(el){
      if ((el.textContent || '').indexOf('Helena') > -1) el.textContent = el.textContent.replace(/Helena\/Admin|Helena Admin|Helena/g, 'Armazem');
    });
  }
  async function saveOrderLine(value){
    if (saving) return;
    saving = true;
    try {
      var d = await api('/api/admin/config?ts=' + Date.now());
      var config = d.config || {};
      config.content = config.content || {};
      config.content.whatsapp = config.content.whatsapp || {};
      config.content.whatsapp.orderLine = value || 'Pedido: {pedido}';
      await api('/api/admin/config', { method:'POST', body:JSON.stringify({ config:config }) });
      toast('Linha do pedido salva no WhatsApp e modal.');
    } catch(e) {
      toast(e.message || 'Erro ao salvar linha do pedido.', 'err');
    } finally { saving = false; }
  }
  function injectOrderLineField(){
    var panel = $('whatsappPanel');
    if (!panel || $('whatsappOrderLineNative')) return;
    var firstCard = panel.querySelector('.card');
    if (!firstCard) return;
    api('/api/admin/config?ts=' + Date.now()).then(function(d){
      var cfg = d.config || {};
      var value = (((cfg.content || {}).whatsapp || {}).orderLine) || 'Pedido: {pedido}';
      var box = document.createElement('div');
      box.id = 'whatsappOrderLineNative';
      box.className = 'field span-12';
      box.innerHTML = '<label>Linha do número do pedido</label><input id="whatsappOrderLineInput" value="' + esc(value) + '"><p class="hint">Use o token <b>{pedido}</b>. Exemplo: Pedido: {pedido}</p><button id="saveWhatsappOrderLine" class="btn green" type="button" style="margin-top:10px">Salvar linha do pedido</button>';
      var grid = firstCard.querySelector('.grid') || firstCard;
      var sellerInput = grid.querySelector('[data-field="content.whatsapp.sellerLine"]');
      var sellerField = sellerInput && sellerInput.closest('.field');
      if (sellerField && sellerField.parentNode) sellerField.parentNode.insertBefore(box, sellerField);
      else grid.appendChild(box);
      $('saveWhatsappOrderLine').onclick = function(){ saveOrderLine(($('whatsappOrderLineInput') || {}).value || 'Pedido: {pedido}'); };
      var preview = $('waPreview');
      if (preview && preview.textContent.indexOf('PED2600003A') === -1) {
        var line = String(value || 'Pedido: {pedido}').replace(/\{pedido\}/g, 'PED2600003A');
        preview.textContent = preview.textContent.replace(/\nVendedora:/, '\n' + line + '\nVendedora:');
      }
    }).catch(function(){});
  }
  document.addEventListener('click', function(e){
    var tab = e.target && e.target.closest && e.target.closest('[data-tab]');
    if (tab && tab.dataset.tab === 'whatsappView') setTimeout(injectOrderLineField, 450);
  });
  new MutationObserver(function(){ replaceHelenaText(); if (document.body.dataset.adminTab === 'whatsappView') injectOrderLineField(); }).observe(document.body, { childList:true, subtree:true });
  setTimeout(function(){ replaceHelenaText(); injectOrderLineField(); }, 1300);
})();
