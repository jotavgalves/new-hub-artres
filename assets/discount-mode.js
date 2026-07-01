(function(){
  if(window.__DISCOUNT_MODE_PATCH__) return;
  window.__DISCOUNT_MODE_PATCH__ = true;

  function inactive(){
    if(window.__NO_DISCOUNT_MODE__ === true) return true;
    var text = document.body ? (document.body.textContent || '') : '';
    return text.indexOf('PEDIDO ORGANIZADO') > -1 || text.indexOf('SELEÇÃO ORGANIZADA') > -1;
  }
  function cardHtml(){
    return '<small>SELEÇÃO ORGANIZADA</small><b>Seu pedido vai pronto para a vendedora</b><p>Ao finalizar, enviamos os códigos escolhidos, quantidades e seus dados de contato em uma solicitação organizada.</p>';
  }
  function looksLikeSavings(el){
    var t = el && el.textContent || '';
    return t.indexOf('Você economiza') > -1 || t.indexOf('O desconto já entra') > -1 || t.indexOf('economiza R$ 0,00') > -1 || t.indexOf('0% OFF') > -1;
  }
  function climb(el){
    var node = el;
    while(node && node.parentElement){
      var p = node.parentElement;
      var t = p.textContent || '';
      if(!looksLikeSavings(p)) break;
      if(t.length > 700) break;
      node = p;
    }
    return node;
  }
  function patch(){
    if(!inactive()) return;
    document.querySelectorAll('button,a').forEach(function(btn){
      var t = (btn.textContent || '').trim();
      if(/Enviar pedido|OFF|desconto/i.test(t) && /Enviar|pedido|OFF/i.test(t)) btn.textContent = 'Enviar';
    });
    var done = new Set();
    document.querySelectorAll('div,section,article,aside').forEach(function(el){
      if(done.has(el) || !looksLikeSavings(el)) return;
      var card = climb(el);
      if(!card || done.has(card)) return;
      done.add(card);
      card.innerHTML = cardHtml();
      card.setAttribute('data-no-discount-card','1');
    });
  }
  var timer = null;
  function schedule(){
    clearTimeout(timer);
    timer = setTimeout(patch, 80);
  }
  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', schedule);
  document.addEventListener('click', function(){ setTimeout(patch, 120); }, true);
  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  schedule();
})();
