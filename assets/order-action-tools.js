(function(){
  if (window.ArmazemOrderTools) return;

  function digits(v){return String(v||'').replace(/\D/g,'')}
  function items(o){return Array.isArray(o&&o.items)?o.items:[]}
  function orderNo(o){return o&&(o.orderNumber||o.orderCode||o.displayId||o.id)||''}
  function customer(o){return o&&o.customer||{}}
  function firstName(v){var s=String(v||'').trim();return s?s.split(/\s+/)[0]:'tudo bem'}
  function code(i){return String(i&&(i.code||i.codigo||i.id)||'').replace(/^#/,'').trim()}
  function theme(i){return String(i&&i.theme||'').trim()}
  function product(i){return String(i&&(i.productName||i.product_name||i.product||'Artes')||'Artes').trim()}
  function qty(i){return Math.max(1,Number(i&&(i.qty||i.quantity||1))||1)}

  function groups(o){
    var map={};
    items(o).forEach(function(i){
      var k=product(i)+'||'+theme(i);
      if(!map[k])map[k]={product:product(i),theme:theme(i),items:[]};
      map[k].items.push(i);
    });
    return Object.keys(map).map(function(k){return map[k]});
  }
  function themes(o){var seen={};items(o).forEach(function(i){var t=theme(i);if(t)seen[t]=1});return Object.keys(seen).join(', ')}
  function summary(o){
    return groups(o).map(function(g){
      var lines=[g.product];
      if(g.theme)lines.push('Tema: '+g.theme);
      g.items.forEach(function(i){lines.push('• Arte #'+code(i)+(qty(i)>1?' ('+qty(i)+' un.)':''))});
      return lines.join('\n');
    }).join('\n\n');
  }
  function confirmMessage(o){
    var c=customer(o), lines=['Oi, '+firstName(c.name)+'! Confirmei seu pedido.','','Pedido: '+orderNo(o)];
    var t=themes(o), s=summary(o);
    if(t)lines.push('', 'Tema(s): '+t);
    if(s)lines.push('', s);
    lines.push('', 'Qualquer ajuste me avisa por aqui.');
    return lines.join('\n');
  }
  function confirmHref(o){
    var c=customer(o), ph=digits(c.whatsapp||c.phone||'');
    if(ph&&ph.indexOf('55')!==0)ph='55'+ph;
    return ph?'https://wa.me/'+ph+'?text='+encodeURIComponent(confirmMessage(o)):'#';
  }
  function openPdf(o){
    if(!window.ArmazemOrderPdf||!window.ArmazemOrderPdf.download){
      alert('Gerador de PDF ainda não carregou. Tente novamente.');
      return false;
    }
    return window.ArmazemOrderPdf.download(o);
  }

  window.ArmazemOrderTools={confirmMessage:confirmMessage,confirmHref:confirmHref,openPdf:openPdf};
})();
