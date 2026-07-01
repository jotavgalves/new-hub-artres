(function(){
  window.__ARMAZEM_CUSTOMER_CHECKOUT__ = true;
  var state = { href: '#', saving: false };

  function byId(id){ return document.getElementById(id); }
  function safe(fn, fallback){ try { return fn(); } catch(e) { return fallback; } }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>'"]/g, function(m){ return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]; }); }
  function digits(v){ return String(v || '').replace(/\D/g, ''); }
  function getCart(){ return safe(function(){ return Array.isArray(cart) ? cart : []; }, []); }
  function getSeller(){ return safe(function(){ return selectedSeller && SELLERS[selectedSeller] ? { id:selectedSeller, label:SELLERS[selectedSeller].label, phone:SELLERS[selectedSeller].phone } : null; }, null); }
  function getTotals(){ return safe(function(){ return { gross:gross(), discount:discount(), net:net(), qty:cartQty() }; }, {}); }
  function getQty(){ return safe(function(){ return cartQty(); }, getCart().reduce(function(s,i){ return s + (Number(i.qty)||0); }, 0)); }
  function getRule(){ return safe(function(){ return typeof cartRule === 'function' ? cartRule() : { ok:false }; }, { ok:false }); }

  function ensureStyles(){
    if (byId('customerCheckoutStyles')) return;
    var s = document.createElement('style');
    s.id = 'customerCheckoutStyles';
    s.textContent = '.customerCheckoutBg{position:fixed;inset:0;background:rgba(34,33,36,.52);z-index:10050;display:none;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(8px)}.customerCheckoutBg.show{display:flex}.customerCheckoutModal{width:min(760px,100%);max-height:90vh;overflow:auto;background:#fffdfc;border-radius:28px;box-shadow:0 28px 80px rgba(34,33,36,.28);border:1px solid #fff}.customerCheckoutHead{padding:22px 24px 14px;border-bottom:1px solid #eee4e4;background:linear-gradient(135deg,#fff,#fff8fb);display:flex;justify-content:space-between;gap:14px}.customerCheckoutHead h3{margin:0 0 7px;font-family:Montserrat,Arial,sans-serif;font-size:24px;color:#222124}.customerCheckoutHead p{margin:0;color:#6c6670;font-size:13px;line-height:1.45}.customerCheckoutClose{border:1px solid #eee0e4;background:#fff;border-radius:999px;width:40px;height:40px;cursor:pointer;font-weight:900;color:#d9366b}.customerCheckoutBody{padding:20px 24px;display:grid;gap:16px}.customerCheckoutGrid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.customerCheckoutField{display:grid;gap:7px}.customerCheckoutField.full{grid-column:1/-1}.customerCheckoutField label{font-size:12px;font-weight:900;color:#625a62;text-transform:uppercase;letter-spacing:.04em}.customerCheckoutField input,.customerCheckoutField textarea{border:1px solid #eee0e4;border-radius:16px;min-height:46px;padding:10px 12px;font:inherit;background:#fff}.customerCheckoutField textarea{min-height:82px;resize:vertical}.customerCheckoutSummary{border:1px solid #eee2e4;border-radius:18px;background:#fff;padding:13px}.customerCheckoutSummary b{display:block;font-family:Montserrat;margin-bottom:6px}.customerCheckoutSummary p{margin:0;color:#6f6872;font-weight:800;font-size:13px}.customerCheckoutError{display:none;background:#fff1f1;color:#a52222;border-radius:14px;padding:10px 12px;font-weight:900}.customerCheckoutError.show{display:block}.customerCheckoutFoot{padding:16px 24px;border-top:1px solid #eee4e4;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.customerCheckoutBtn{border:0;border-radius:999px;min-height:46px;padding:0 18px;font-weight:900;cursor:pointer}.customerCheckoutBack{background:#fff;border:1px solid #eee0e4;color:#625a62}.customerCheckoutSend{background:#25d366;color:#fff;box-shadow:0 12px 24px rgba(37,211,102,.22)}@media(max-width:560px){.customerCheckoutBg{padding:10px}.customerCheckoutModal{border-radius:23px}.customerCheckoutHead{padding:18px 16px 12px}.customerCheckoutBody{padding:16px}.customerCheckoutGrid{grid-template-columns:1fr}.customerCheckoutFoot{padding:14px 16px}.customerCheckoutBtn{width:100%}}';
    document.head.appendChild(s);
  }

  function ensureModal(){
    ensureStyles();
    if (byId('customerCheckoutBg')) return;
    var root = document.createElement('div');
    root.innerHTML = '<div class="customerCheckoutBg" id="customerCheckoutBg" aria-hidden="true"><section class="customerCheckoutModal" role="dialog" aria-modal="true"><header class="customerCheckoutHead"><div><h3>Antes de enviar, informe seus dados</h3><p>Assim a vendedora recebe seu pedido já identificado e organizado.</p></div><button class="customerCheckoutClose" id="customerCheckoutClose" type="button">×</button></header><div class="customerCheckoutBody"><div class="customerCheckoutGrid"><div class="customerCheckoutField"><label>Nome do cliente *</label><input id="customerName" autocomplete="name" placeholder="Seu nome"></div><div class="customerCheckoutField"><label>WhatsApp *</label><input id="customerPhone" inputmode="tel" autocomplete="tel" placeholder="(81) 99999-9999"></div><div class="customerCheckoutField"><label>Data da festa</label><input id="customerPartyDate" placeholder="Ex.: 20/08"></div><div class="customerCheckoutField"><label>Observação</label><input id="customerNotes" placeholder="Ex.: nome da criança, idade..."></div></div><div class="customerCheckoutError" id="customerCheckoutError"></div><div class="customerCheckoutSummary" id="customerCheckoutSummary"></div></div><footer class="customerCheckoutFoot"><button class="customerCheckoutBtn customerCheckoutBack" id="customerCheckoutBack" type="button">Voltar</button><button class="customerCheckoutBtn customerCheckoutSend" id="customerCheckoutSend" type="button">Continuar para WhatsApp</button></footer></section></div>';
    document.body.appendChild(root);
    byId('customerCheckoutClose').onclick = closeModal;
    byId('customerCheckoutBack').onclick = closeModal;
    byId('customerCheckoutSend').onclick = submit;
    byId('customerCheckoutBg').addEventListener('click', function(e){ if(e.target === byId('customerCheckoutBg')) closeModal(); });
  }

  function openModal(href){
    ensureModal();
    state.href = href || '#';
    var cached = safe(function(){ return JSON.parse(localStorage.getItem('armazemCustomer') || '{}'); }, {});
    byId('customerName').value = cached.name || '';
    byId('customerPhone').value = cached.phone || '';
    byId('customerPartyDate').value = cached.partyDate || '';
    byId('customerNotes').value = cached.notes || '';
    var items = getCart().slice(0, 12).map(function(i){ return '#' + esc(i.code || '') + ' (' + (Number(i.qty)||1) + 'x)'; }).join(' · ');
    byId('customerCheckoutSummary').innerHTML = '<b>Resumo do pedido</b><p>' + getQty() + ' item(ns) selecionado(s)</p><p>' + items + '</p>';
    showError('');
    byId('customerCheckoutBg').classList.add('show');
    byId('customerCheckoutBg').setAttribute('aria-hidden', 'false');
  }

  function closeModal(){ var el = byId('customerCheckoutBg'); if(el){ el.classList.remove('show'); el.setAttribute('aria-hidden','true'); } }
  function showError(msg){ var el = byId('customerCheckoutError'); if(!el) return; el.textContent = msg || ''; el.classList.toggle('show', !!msg); }

  async function saveOrder(customer){
    var payload = {
      seller: getSeller(),
      customer: customer,
      partyDate: customer.partyDate,
      notes: customer.notes,
      totals: getTotals(),
      qty: getQty(),
      items: getCart().map(function(i){ return { code:i.code, theme:i.theme, product:i.product, productName:i.productName, qty:i.qty, image:i.image || i.thumbnail || '' }; }),
      userAgent: navigator.userAgent
    };
    await fetch('/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), keepalive:true });
  }

  async function submit(){
    if (state.saving) return;
    var customer = {
      name: byId('customerName').value.trim(),
      phone: digits(byId('customerPhone').value),
      whatsapp: digits(byId('customerPhone').value),
      partyDate: byId('customerPartyDate').value.trim(),
      notes: byId('customerNotes').value.trim()
    };
    if (!customer.name) return showError('Informe o nome do cliente.');
    if (customer.phone.length < 10) return showError('Informe um WhatsApp válido.');
    state.saving = true;
    var btn = byId('customerCheckoutSend');
    var old = btn.textContent;
    btn.textContent = 'Salvando...';
    btn.disabled = true;
    try {
      localStorage.setItem('armazemCustomer', JSON.stringify(customer));
      await saveOrder(customer);
      closeModal();
      window.open(state.href, '_blank', 'noopener');
    } catch(e) {
      showError('Não consegui salvar o pedido agora. Tente novamente.');
    } finally {
      state.saving = false;
      btn.textContent = old;
      btn.disabled = false;
    }
  }

  document.addEventListener('click', function(e){
    var link = e.target && e.target.closest ? e.target.closest('a.wa') : null;
    if (!link) return;
    if (link.classList.contains('disabled') || link.getAttribute('href') === '#') return;
    var rule = getRule();
    if (!rule.ok) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openModal(link.getAttribute('href'));
  }, true);
})();
