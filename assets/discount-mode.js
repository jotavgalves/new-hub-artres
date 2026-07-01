(function(){
  if(window.__DISCOUNT_MODE_PATCH__) return;
  window.__DISCOUNT_MODE_PATCH__ = true;
  function addStyle(){
    if(document.getElementById('noDiscountStyle')) return;
    var s=document.createElement('style');
    s.id='noDiscountStyle';
    s.textContent='body:has(.promoPill) .discountCard strong{font-size:0!important}body:has(.promoPill) .discountCard strong:after{content:"Seu pedido vai pronto para a vendedora";font-size:22px!important;line-height:1.15!important}body:has(.promoPill) .discountCard small{font-size:0!important}body:has(.promoPill) .discountCard small:after{content:"Ao finalizar, enviamos os códigos escolhidos, quantidades e seus dados de contato em uma solicitação organizada.";font-size:13px!important;line-height:1.45!important}body:has(.promoPill) .totalBox .totalLine:nth-of-type(2){display:none!important}body:has(.promoPill) .totalBox .total span{font-size:0!important}body:has(.promoPill) .totalBox .total span:after{content:"Total";font-size:13px!important}body:has(.promoPill) .wa{font-size:0!important}body:has(.promoPill) .wa:after{content:"Enviar";font-size:15px!important}';
    document.head.appendChild(s);
  }
  addStyle();
  document.addEventListener('DOMContentLoaded',addStyle);
  window.addEventListener('load',addStyle);
})();
