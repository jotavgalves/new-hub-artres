(function(){
  if (window.ArmazemOrderTools) return;
  var LOGO_URL = 'https://acompanhe-armazem.pages.dev/assets/logo.svg';

  function esc(v){return String(v==null?'':v).replace(/[&<>'"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]})}
  function digits(v){return String(v||'').replace(/\D/g,'')}
  function items(o){return Array.isArray(o&&o.items)?o.items:[]}
  function orderNo(o){return o&&(o.orderNumber||o.orderCode||o.displayId||o.id)||''}
  function customer(o){return o&&o.customer||{}}
  function seller(o){return o&&o.seller||{}}
  function firstName(v){var s=String(v||'').trim();return s?s.split(/\s+/)[0]:'tudo bem'}
  function code(i){return String(i&&(i.code||i.codigo||i.id)||'').replace(/^#/,'').trim()}
  function theme(i){return String(i&&i.theme||'').trim()}
  function product(i){return String(i&&(i.productName||i.product_name||i.product||'Artes')||'Artes').trim()}
  function qty(i){return Math.max(1,Number(i&&(i.qty||i.quantity||1))||1)}
  function img(i){return String(i&&(i.image||i.thumbnail||i.thumb||i.url||i.imageUrl||i.image_url)||'').trim()}
  function abs(u){try{return u?new URL(u,location.origin).toString():''}catch(e){return u||''}}
  function date(v){try{return new Date(v||Date.now()).toLocaleString('pt-BR')}catch(e){return String(v||'')}}

  function groups(o){
    var map={};
    items(o).forEach(function(i){var k=product(i)+'||'+theme(i);if(!map[k])map[k]={product:product(i),theme:theme(i),items:[]};map[k].items.push(i)});
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
  function artCard(i){
    var im=abs(img(i));
    return '<article class="art"><div class="pic">'+(im?'<img src="'+esc(im)+'" alt="Arte #'+esc(code(i))+'">':'<b>#'+esc(code(i)||'—')+'</b>')+'</div><div class="meta"><strong>#'+esc(code(i)||'—')+'</strong><span>'+esc(qty(i))+' un.</span></div></article>';
  }
  function groupHtml(g){
    return '<section class="grp"><header><div><h2>'+esc(g.product)+'</h2>'+(g.theme?'<p>Tema: <b>'+esc(g.theme)+'</b></p>':'')+'</div><small>'+esc(g.items.length)+' arte(s)</small></header><div class="grid">'+g.items.map(artCard).join('')+'</div></section>';
  }
  function pdfHtml(o){
    var c=customer(o), s=seller(o), gs=groups(o), no=orderNo(o);
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pedido '+esc(no)+'</title><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet"><style>@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#fffaf6;color:#222124;font-family:Inter,Arial}.bar{position:sticky;top:0;display:flex;gap:8px;justify-content:center;padding:10px;background:#fffaf6}.bar button{border:0;border-radius:999px;padding:12px 18px;font-weight:900}.bar .main{background:#d9366b;color:white}.sheet{max-width:920px;margin:auto;padding:28px;background:white}.top{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #f0e2e6;padding-bottom:18px}.logo{width:240px;max-width:55%}.pill{display:inline-flex;background:#fff1f6;color:#d9366b;border-radius:999px;padding:8px 12px;font:900 11px Montserrat;text-transform:uppercase;letter-spacing:.08em}.ord{text-align:right}.ord h1{font:900 30px Montserrat;margin:10px 0 0}.info{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}.info div{border:1px solid #f0e2e6;border-radius:18px;padding:13px}.info small{display:block;color:#8d8590;font-weight:900;font-size:10px;text-transform:uppercase}.info b{display:block;margin-top:5px;font-size:13px}.hero{background:linear-gradient(135deg,#ef5585,#d9366b);color:#fff;border-radius:22px;padding:18px;margin:0 0 18px}.hero h2{font:900 23px Montserrat;margin:0 0 6px}.hero p{margin:0;font-weight:700}.grp{break-inside:avoid;border:1px solid #f0e2e6;border-radius:24px;padding:16px;margin:16px 0}.grp header{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #f5e8ec;padding-bottom:12px;margin-bottom:14px}.grp h2{font:900 22px Montserrat;margin:0}.grp p{margin:5px 0 0;color:#6f6872}.grp small{background:#f2fbff;border-radius:999px;padding:8px 10px;font-weight:900}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.art{border:1px solid #f0e2e6;border-radius:20px;overflow:hidden}.pic{height:155px;background:linear-gradient(135deg,#fff8fb,#f2fbff);display:grid;place-items:center}.pic img{width:100%;height:100%;object-fit:cover}.pic b{font:900 30px Montserrat;color:#d9366b}.meta{display:flex;justify-content:space-between;padding:11px 12px}.meta strong{font:900 17px Montserrat}.meta span{font-size:11px;color:#6f6872;font-weight:900}.foot{text-align:center;color:#8d8590;font-size:11px;font-weight:800;border-top:1px solid #f0e2e6;margin-top:18px;padding-top:14px}@media(max-width:760px){.sheet{padding:18px}.top{display:grid}.ord{text-align:left}.info{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr 1fr}}@media print{.bar{display:none}.sheet{padding:0;max-width:none}.pic{height:145px}}</style></head><body><div class="bar"><button class="main" onclick="print()">Salvar como PDF</button><button onclick="close()">Fechar</button></div><main class="sheet"><header class="top"><img class="logo" src="'+esc(LOGO_URL)+'" alt="Armazém"><div class="ord"><span class="pill">Resumo visual do pedido</span><h1>'+esc(no)+'</h1><p>'+esc(date(o&&o.createdAt))+'</p></div></header><section class="info"><div><small>Cliente</small><b>'+esc(c.name||'Não informado')+'</b></div><div><small>WhatsApp</small><b>'+esc(c.whatsapp||c.phone||'Não informado')+'</b></div><div><small>Vendedora</small><b>'+esc(s.label||s.name||s.id||'Não informado')+'</b></div><div><small>Quantidade</small><b>'+esc(o&&o.qty||items(o).length||0)+' item(ns)</b></div></section><section class="hero"><h2>Artes escolhidas</h2><p>Resumo visual para conferência do pedido.</p></section>'+(gs.length?gs.map(groupHtml).join(''):'<p>Nenhuma arte encontrada.</p>')+'<footer class="foot">Armazém Festas e Eventos · Pedido gerado pelo Hub de Artes</footer></main></body></html>';
  }
  function openPdf(o){var w;try{w=open('','_blank')}catch(e){}if(!w){alert('Permita pop-ups para abrir o PDF.');return false}w.document.open();w.document.write(pdfHtml(o));w.document.close();return true}

  window.ArmazemOrderTools={confirmMessage:confirmMessage,confirmHref:confirmHref,openPdf:openPdf,pdfHtml:pdfHtml};
})();
