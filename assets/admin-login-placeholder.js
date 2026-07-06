(function(){
  function apply(){
    var input = document.getElementById('username');
    if (input) input.setAttribute('placeholder', 'Digite seu usuário');
  }
  apply();
  setInterval(apply, 800);
})();
