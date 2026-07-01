(function(){
  document.addEventListener('click',function(){
    if(window.__ARMAZEM_CUSTOMER_CHECKOUT__)return;
  },true);
  if(!document.getElementById('discountModeScript')){
    var s=document.createElement('script');
    s.id='discountModeScript';
    s.src='/assets/discount-mode.js?v=1';
    s.defer=true;
    document.head.appendChild(s);
  }
})();
