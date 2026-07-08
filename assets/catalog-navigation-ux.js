(function(){
  if(window.__ARMAZEM_CATALOG_NAV_UX__) return;
  window.__ARMAZEM_CATALOG_NAV_UX__ = true;

  function byId(id){ return document.getElementById(id); }
  function clean(value){
    return String(value || '')
      .replace(/[←‹❮›]/g, '')
      .replace(/^Voltar para\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function norm(value){
    return clean(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
  function pretty(label){
    var text = clean(label);
    if(/^bolinhas?$/i.test(text)) return 'Bolinhas 50x50';
    if(/^50x50$/i.test(text)) return 'Bolinhas 50x50';
    return text;
  }
  function visiblePills(){
    var b = byId('breadcrumbs') || document.querySelector('.breadcrumbs');
    if(!b) return [];
    return Array.prototype.slice.call(b.querySelectorAll('button,.pathPill,.crumb,.backBtn'))
      .filter(function(el){ return !el.hidden && el.style.display !== 'none'; });
  }
  function viewTitle(){
    return clean((byId('viewTitle') || {}).textContent || '');
  }
  function searchValue(){
    return clean((byId('search') || {}).value || '');
  }
  function isSearchView(){
    var title = norm(viewTitle());
    return title.indexOf('resultado da busca') !== -1 || title.indexOf('resultado') !== -1 && searchValue();
  }
  function simplifyBreadcrumbs(){
    var pills = visiblePills();
    var seen = [];
    pills.forEach(function(el){
      var raw = clean(el.textContent);
      var key = norm(raw);
      var label = pretty(raw);
      if(!key){ el.style.display = 'none'; return; }
      if(key === 'produtos'){
        el.style.display = 'none';
        return;
      }
      if(seen.indexOf(key) !== -1){
        el.style.display = 'none';
        return;
      }
      seen.push(key);
      el.style.display = '';
      if(clean(el.textContent) !== label) el.textContent = label;
      el.title = label;
    });
  }
  function currentLabels(){
    return visiblePills()
      .filter(function(el){ return el.style.display !== 'none'; })
      .map(function(el){ return pretty(el.textContent); })
      .filter(Boolean);
  }
  function backLabel(labels){
    if(isSearchView()) return '← Voltar para temas';
    if(labels.length <= 1) return '';
    var last = norm(labels[labels.length - 1]);
    if(last.indexOf('bolinha') !== -1 || last.indexOf('sacolinha') !== -1 || last.indexOf('cilind') !== -1 || last.indexOf('romano') !== -1 || last.indexOf('painel') !== -1){
      return '← Voltar para escolher outro produto';
    }
    return '← Voltar para temas';
  }
  function ensureGuide(){
    var top = document.querySelector('.topControls');
    if(!top || !top.parentNode) return null;
    var guide = byId('catalogNavGuide');
    if(!guide){
      guide = document.createElement('div');
      guide.id = 'catalogNavGuide';
      guide.className = 'catalogNavGuide';
      guide.innerHTML = '<button type="button" id="catalogSmartBack" class="catalogSmartBack"></button><div class="catalogWhere"><span>Você está vendo</span><b id="catalogWhereText"></b></div>';
      top.parentNode.insertBefore(guide, top);
      var btn = guide.querySelector('#catalogSmartBack');
      btn.addEventListener('click', function(){
        if(isSearchView()){
          var search = byId('search');
          if(search) search.value = '';
          var tema = visiblePills().filter(function(el){ return el.style.display !== 'none'; })[0];
          if(tema) tema.click();
          else if(typeof window.loadThemes === 'function') window.loadThemes();
          return;
        }
        if(typeof window.smartBack === 'function'){
          window.smartBack();
          return;
        }
        var pills = visiblePills().filter(function(el){ return el.style.display !== 'none'; });
        if(pills.length > 1) pills[pills.length - 2].click();
      });
    }
    return guide;
  }
  function apply(){
    simplifyBreadcrumbs();
    var labels = currentLabels();
    var guide = ensureGuide();
    if(!guide) return;
    var btn = guide.querySelector('#catalogSmartBack');
    var where = guide.querySelector('#catalogWhereText');
    var label = backLabel(labels);
    if(!label){
      guide.style.display = 'none';
      return;
    }
    guide.style.display = '';
    btn.textContent = label;
    if(isSearchView()){
      where.textContent = searchValue() ? 'Resultado para ' + searchValue() : 'Resultado da busca';
      return;
    }
    where.textContent = labels.filter(function(x){ return norm(x) !== 'temas'; }).join(' · ');
  }
  function installStyle(){
    if(byId('catalogNavUxStyle')) return;
    var style = document.createElement('style');
    style.id = 'catalogNavUxStyle';
    style.textContent = '.catalogNavGuide{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:13px;margin-bottom:2px}.catalogSmartBack{border:1px solid #ffd6e5;background:#fff1f6;color:#d9366b;min-height:40px;padding:0 16px;border-radius:999px;font-family:Montserrat,Arial,sans-serif;font-size:12px;font-weight:900;cursor:pointer;box-shadow:0 8px 18px rgba(239,85,133,.08)}.catalogWhere{display:flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border:1px solid #eee3e2;background:#fff;border-radius:999px;color:#6c6670;font-size:12px}.catalogWhere span{font-weight:700;color:#8b838a}.catalogWhere b{font-family:Montserrat,Arial,sans-serif;color:#2f2c32;font-size:12.5px}@media(max-width:560px){.catalogNavGuide{align-items:stretch;gap:8px}.catalogSmartBack{width:100%;min-height:42px}.catalogWhere{width:100%;justify-content:center;flex-wrap:wrap;border-radius:18px;padding:9px 12px;text-align:center}.catalogWhere span{width:100%;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}.catalogWhere b{font-size:12px}}';
    document.head.appendChild(style);
  }
  function schedule(){
    clearTimeout(schedule.t);
    schedule.t = setTimeout(function(){ installStyle(); apply(); }, 40);
  }

  document.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('load', schedule);
  document.addEventListener('click', function(){ setTimeout(schedule, 80); }, true);
  document.addEventListener('input', function(){ setTimeout(schedule, 120); }, true);
  new MutationObserver(schedule).observe(document.documentElement, { childList:true, subtree:true });
  schedule();
})();
