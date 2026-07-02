(function(){
  var content = null;
  function $(id){ return document.getElementById(id); }
  function txt(el, value){ if (el && value) el.textContent = value; }
  function html(el, value){ if (el && value) el.innerHTML = value; }
  function safe(fn){ try { fn(); } catch(e) {} }
  function applyTexts(){
    if (!content) return;
    var h = content.hero || {}, p = content.promo || {}, c = content.catalog || {}, cart = content.cart || {};
    safe(function(){ txt(document.querySelector('.brand .eyebrow'), h.eyebrow); });
    safe(function(){ txt(document.querySelector('.brand h1'), h.title); });
    safe(function(){ txt(document.querySelector('.brand .subtitle'), h.subtitle); });
    safe(function(){
      var boxes = document.querySelectorAll('.flow .stepBox');
      (content.steps || []).forEach(function(step, i){
        if (!boxes[i]) return;
        txt(boxes[i].querySelector('b'), step.title);
        txt(boxes[i].querySelector('span'), step.text);
      });
    });
    safe(function(){ txt(document.querySelector('.promo .promoPill'), p.pill); });
    safe(function(){ txt(document.querySelector('.promo h3'), p.title); });
    safe(function(){ txt(document.querySelector('.promo p:not(.promoPill)'), p.text); });
    safe(function(){ if ($('viewTitle') && $('viewTitle').textContent.trim()==='Escolha um tema') txt($('viewTitle'), c.initialTitle); });
    safe(function(){ if ($('viewCaption') && /Escolha o tema da sua festa/i.test($('viewCaption').textContent)) txt($('viewCaption'), c.initialCaption); });
    safe(function(){ if ($('search')) $('search').placeholder = c.searchPlaceholder || $('search').placeholder; });
    safe(function(){ txt($('favToggle'), c.favoritesButton); });
    safe(function(){ txt($('addFavs'), c.addFavoritesButton); });
    safe(function(){ txt($('prevText'), c.previewText); });
    safe(function(){ txt($('prevSelect'), c.addButton); });
    safe(function(){ txt($('prevFav'), c.favoriteButton); });
    safe(function(){ txt($('prevClose'), c.closeButton); });
    safe(function(){ txt($('openCart'), cart.openCartButton); });
    patchCart(cart);
  }
  function patchCart(cart){
    safe(function(){ document.querySelectorAll('.cartTitle h2,.cart h2').forEach(function(el){ if (/orçamento|carrinho/i.test(el.textContent)) txt(el, cart.title); }); });
    safe(function(){ document.querySelectorAll('.seller label').forEach(function(el){ if (/vendedora/i.test(el.textContent)) txt(el, cart.sellerTitle); }); });
    safe(function(){ document.querySelectorAll('.sellerHint').forEach(function(el){ txt(el, cart.sellerHint); }); });
    safe(function(){ document.querySelectorAll('button,a').forEach(function(el){
      var t = (el.textContent || '').trim();
      if (/enviar pedido/i.test(t)) txt(el, cart.sendButton);
      if (/ver carrinho/i.test(t)) txt(el, cart.openCartButton);
    }); });
    safe(function(){ document.querySelectorAll('p,span,div').forEach(function(el){
      if ((el.textContent || '').trim() === 'Seu carrinho ainda está vazio.') txt(el, cart.emptyCart);
    }); });
  }
  fetch('/api/public-content?ts=' + Date.now(), { cache:'no-store' })
    .then(function(r){ return r.json(); })
    .then(function(d){ content = d.content || null; applyTexts(); })
    .catch(function(){});
  new MutationObserver(function(){ applyTexts(); }).observe(document.body, { childList:true, subtree:true });
})();
