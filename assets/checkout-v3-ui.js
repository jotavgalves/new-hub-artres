(function(){
  'use strict';
  if(window.__ARMAZEM_CHECKOUT_V3_UI__)return;
  window.__ARMAZEM_CHECKOUT_V3_UI__='2026-08-04.1';

  var preview=null;
  var scheduled=false;
  var CTA_TEXT='Enviar para a vendedora';
  var CTA_LABEL='Enviar pedido para a vendedora';
  var CTA_NOTE='Se o aplicativo não abrir, toque novamente em “Enviar para a vendedora”. O pedido não será registrado outra vez.';

  installStyle();
  applyEnhancements();
  document.addEventListener('click',handleReviewClick,true);
  document.addEventListener('keydown',handleReviewKeydown,true);
  document.addEventListener('keydown',handlePreviewEscape,true);
  new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});

  function installStyle(){
    if(document.getElementById('checkoutV3UiStyle'))return;
    var style=document.createElement('style');
    style.id='checkoutV3UiStyle';
    style.textContent=`
      .checkoutV3Item[data-checkout-v3-clickable="1"]{cursor:zoom-in;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease,background .16s ease}
      .checkoutV3Item[data-checkout-v3-clickable="1"]:hover{transform:translateY(-1px);border-color:#f3a5bd;background:#fff;box-shadow:0 12px 28px rgba(217,54,107,.10)}
      .checkoutV3Item[data-checkout-v3-clickable="1"]:focus-visible{outline:0;border-color:#ef5585;box-shadow:0 0 0 4px rgba(239,85,133,.17)}
      .checkoutV3Item[data-checkout-v3-clickable="1"]::after{content:'Ver arte';position:absolute;right:12px;bottom:8px;color:#c92d62;font-size:9px;font-weight:950;letter-spacing:.06em;text-transform:uppercase;opacity:0;transition:opacity .16s ease}
      .checkoutV3Item[data-checkout-v3-clickable="1"]{position:relative;padding-bottom:22px}
      .checkoutV3Item[data-checkout-v3-clickable="1"]:hover::after,.checkoutV3Item[data-checkout-v3-clickable="1"]:focus-visible::after{opacity:1}
      .checkoutV3ArtPreview{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:18px;background:rgba(18,16,19,.84);backdrop-filter:blur(12px)}
      .checkoutV3ArtPreviewCard{position:relative;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(250px,.65fr);width:min(100%,980px);max-height:92vh;overflow:hidden;border:1px solid rgba(255,255,255,.55);border-radius:28px;background:#fff;box-shadow:0 34px 120px rgba(0,0,0,.48);animation:checkoutV3ArtPreviewIn .16s ease-out}
      .checkoutV3ArtPreviewImageWrap{display:grid;place-items:center;min-height:420px;padding:20px;background:linear-gradient(145deg,#fff1f6,#eefbff)}
      .checkoutV3ArtPreviewImage{display:block;width:100%;height:100%;max-height:82vh;object-fit:contain;border-radius:18px;background:#fff}
      .checkoutV3ArtPreviewInfo{display:grid;align-content:center;gap:10px;padding:34px 28px}.checkoutV3ArtPreviewInfo b{font-family:Montserrat,Arial,sans-serif;font-size:25px;line-height:1.12;letter-spacing:-.04em}.checkoutV3ArtPreviewInfo span,.checkoutV3ArtPreviewInfo small{color:#716a71;font-size:13px;line-height:1.6}.checkoutV3ArtPreviewHint{margin-top:8px!important;color:#a0385e!important;font-size:11px!important;font-weight:850}
      .checkoutV3ArtPreviewClose{position:absolute;top:14px;right:14px;z-index:2;display:grid;place-items:center;width:44px;height:44px;border:1px solid #eadfe3;border-radius:999px;background:rgba(255,255,255,.94);color:#5d565c;font-size:22px;cursor:pointer;box-shadow:0 9px 24px rgba(0,0,0,.12)}
      @keyframes checkoutV3ArtPreviewIn{from{opacity:0;transform:translateY(8px) scale(.985)}}
      @media(max-width:760px){.checkoutV3Item[data-checkout-v3-clickable="1"]::after{opacity:1}.checkoutV3ArtPreview{padding:0;align-items:end}.checkoutV3ArtPreviewCard{grid-template-columns:1fr;width:100%;max-height:94vh;border-radius:26px 26px 0 0;overflow:auto}.checkoutV3ArtPreviewImageWrap{min-height:52vh;padding:14px}.checkoutV3ArtPreviewImage{max-height:60vh}.checkoutV3ArtPreviewInfo{padding:22px 20px calc(24px + env(safe-area-inset-bottom))}.checkoutV3ArtPreviewInfo b{font-size:21px}}
    `;
    document.head.appendChild(style);
  }

  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(function(){scheduled=false;applyEnhancements();});
  }

  function applyEnhancements(){
    document.querySelectorAll('.checkoutV3OpenWa').forEach(function(link){
      if(link.textContent!==CTA_TEXT)link.textContent=CTA_TEXT;
      if(link.getAttribute('aria-label')!==CTA_LABEL)link.setAttribute('aria-label',CTA_LABEL);
      var success=link.closest('.checkoutV3Success');
      var note=success&&success.querySelector('.checkoutV3Note');
      if(note&&note.textContent!==CTA_NOTE)note.textContent=CTA_NOTE;
    });

    document.querySelectorAll('.checkoutV3Item').forEach(function(item){
      if(item.dataset.checkoutV3Clickable==='1')return;
      item.dataset.checkoutV3Clickable='1';
      item.setAttribute('role','button');
      item.setAttribute('tabindex','0');
      var title=item.querySelector('.checkoutV3Info b');
      item.setAttribute('aria-label','Visualizar '+String(title&&title.textContent||'arte selecionada').trim());
    });
  }

  function handleReviewClick(event){
    var item=event.target&&event.target.closest?event.target.closest('.checkoutV3Item[data-checkout-v3-clickable="1"]'):null;
    if(!item||event.target.closest('button,a,input,select,textarea,label'))return;
    event.preventDefault();
    event.stopPropagation();
    openPreview(item);
  }

  function handleReviewKeydown(event){
    var item=event.target&&event.target.closest?event.target.closest('.checkoutV3Item[data-checkout-v3-clickable="1"]'):null;
    if(!item||(event.key!=='Enter'&&event.key!==' '))return;
    event.preventDefault();
    event.stopPropagation();
    openPreview(item);
  }

  function openPreview(item){
    closePreview();
    var source=item.querySelector('.checkoutV3Thumb');
    var title=item.querySelector('.checkoutV3Info b');
    var meta=item.querySelector('.checkoutV3Info span');
    var extra=item.querySelector('.checkoutV3Info small');
    var root=document.createElement('div');
    root.className='checkoutV3ArtPreview';
    root.setAttribute('role','dialog');
    root.setAttribute('aria-modal','true');
    root.setAttribute('aria-label',String(title&&title.textContent||'Visualização da arte').trim());

    var card=document.createElement('section');
    card.className='checkoutV3ArtPreviewCard';
    var close=document.createElement('button');
    close.type='button';
    close.className='checkoutV3ArtPreviewClose';
    close.setAttribute('aria-label','Fechar visualização da arte');
    close.textContent='×';

    var imageWrap=document.createElement('div');
    imageWrap.className='checkoutV3ArtPreviewImageWrap';
    var image=document.createElement('img');
    image.className='checkoutV3ArtPreviewImage';
    image.src=source&&source.src||'';
    image.alt=source&&source.alt||String(title&&title.textContent||'Arte selecionada');
    imageWrap.appendChild(image);

    var info=document.createElement('div');
    info.className='checkoutV3ArtPreviewInfo';
    appendText(info,'b',title&&title.textContent||'Arte selecionada');
    appendText(info,'span',meta&&meta.textContent||'');
    if(extra&&extra.textContent)appendText(info,'small',extra.textContent);
    appendText(info,'small','Toque fora da imagem ou no × para voltar à conferência.','checkoutV3ArtPreviewHint');

    card.appendChild(close);
    card.appendChild(imageWrap);
    card.appendChild(info);
    root.appendChild(card);
    document.body.appendChild(root);
    preview=root;
    close.onclick=closePreview;
    root.onclick=function(event){if(event.target===root)closePreview();};
    setTimeout(function(){close.focus();},0);
  }

  function appendText(parent,tag,text,className){
    var node=document.createElement(tag);
    if(className)node.className=className;
    node.textContent=String(text||'').trim();
    parent.appendChild(node);
  }

  function handlePreviewEscape(event){
    if(event.key==='Escape'&&preview){event.preventDefault();closePreview();}
  }

  function closePreview(){
    if(preview)preview.remove();
    preview=null;
  }
})();
