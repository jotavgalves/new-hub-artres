(function(){
  if(window.__ARMAZEM_DRIVE_SEARCH_DISABLED__) return;
  window.__ARMAZEM_DRIVE_SEARCH_DISABLED__ = true;

  function removeLegacyBox(){
    var box = document.getElementById('catalogDriveSearchBox');
    if(box && box.parentNode) box.parentNode.removeChild(box);
  }

  removeLegacyBox();
  document.addEventListener('DOMContentLoaded', removeLegacyBox);
  window.addEventListener('load', removeLegacyBox);
})();
