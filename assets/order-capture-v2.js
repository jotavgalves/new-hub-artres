(function(){
  var lastKey="";
  function safe(fn,fallback){try{return fn()}catch(e){return fallback}}
  function checkoutOn(){return !!window.__ARMAZEM_CUSTOMER_CHECKOUT__||!!window.openCustomerCheckout}
  function getCart(){return safe(function(){return Array.isArray(cart)?cart:[]},[])}
  function getSeller(){return safe(function(){return selectedSeller&&SELLERS[selectedSeller]?{id:selectedSeller,label:SELLERS[selectedSeller].label,phone:SELLERS[selectedSeller].phone}:null},null)}
  function totals(){return safe(function(){return {gross:gross(),discount:discount(),net:net(),qty:cartQty()}},{})}
  function keyFor(){return JSON.stringify(getCart().map(function(i){return [i.code,i.qty,i.theme,i.product]}))+JSON.stringify(getSeller())}
  async function saveOrder(){
    if(checkoutOn())return;
    var key=keyFor();
    if(key===lastKey)return;
    lastKey=key;
    var payload={seller:getSeller(),totals:totals(),qty:safe(function(){return cartQty()},0),items:getCart().map(function(i){return {code:i.code,theme:i.theme,product:i.product,productName:i.productName,qty:i.qty,image:i.image||i.thumbnail||""}}),userAgent:navigator.userAgent};
    try{await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true});}catch(e){}
  }
  document.addEventListener('click',function(e){
    if(checkoutOn())return;
    var link=e.target&&e.target.closest?e.target.closest('a.wa'):null;
    if(!link)return;
    if(link.classList.contains('disabled')||link.getAttribute('href')==='#')return;
    var ok=safe(function(){return cartRule().ok},false);
    if(ok)saveOrder();
  },true);
})();
