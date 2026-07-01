(function(){
  var state={open:false,zoomIndex:-1,waHref:"#",config:null};
  var fallbackModal={title:"Confira suas artes antes de enviar",subtitle:"Dê uma última olhada nas imagens escolhidas. Toque em qualquer arte para ampliar.",countText:"Você selecionou {quantidade} arte(s).",backButton:"Voltar e ajustar",confirmButton:"Confirmar e enviar",previousButton:"Anterior",nextButton:"Próxima",closeButton:"Fechar"};

  function byId(id){return document.getElementById(id)}
  function esc(v){return String(v==null?"":v).replace(/[&<>'"]/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[m]})}
  function getCart(){try{return Array.isArray(cart)?cart:[]}catch(e){return []}}
  function getRule(){try{return typeof cartRule==="function"?cartRule():{ok:false,msg:"Revise seu carrinho antes de enviar."}}catch(e){return {ok:false,msg:"Revise seu carrinho antes de enviar."}}}
  function getWaUrl(){try{return typeof waUrl==="function"?waUrl():"#"}catch(e){return "#"}}
  function getQty(){try{return typeof cartQty==="function"?cartQty():getCart().reduce(function(s,i){return s+(Number(i.qty)||0)},0)}catch(e){return 0}}
  function modalText(){return state.config&&state.config.content&&state.config.content.modal?state.config.content.modal:fallbackModal}
  function fmt(text,map){return String(text||"").replace(/\{(quantidade)\}/g,function(_,key){return map[key]||""})}

  fetch("/api/config",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(d){if(d&&d.config)state.config=d.config}).catch(function(){});

  function ensureStyles(){
    if(byId("confirmArtsStyles"))return;
    var css=""+
    ".confirmArtsBg{position:fixed;inset:0;background:rgba(34,33,36,.48);z-index:9998;display:none;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(7px)}"+
    ".confirmArtsBg.show{display:flex}"+
    ".confirmArtsModal{width:min(980px,100%);max-height:min(88vh,860px);background:#fffdfc;border:1px solid rgba(255,255,255,.8);border-radius:30px;box-shadow:0 28px 80px rgba(34,33,36,.26);overflow:hidden;display:grid;grid-template-rows:auto 1fr auto}"+
    ".confirmArtsHead{padding:22px 24px 16px;border-bottom:1px solid #eee4e4;display:flex;justify-content:space-between;gap:16px;align-items:flex-start;background:linear-gradient(135deg,#fff,#fff8fb)}"+
    ".confirmArtsHead h3{margin:0 0 7px;font-family:Montserrat,Arial,sans-serif;font-size:24px;line-height:1.05;letter-spacing:-.04em;color:#222124}"+
    ".confirmArtsHead p{margin:0;color:#6c6670;font-size:13px;line-height:1.45}"+
    ".confirmArtsClose{border:1px solid #eee0e4;background:#fff;border-radius:999px;width:40px;height:40px;cursor:pointer;font-weight:900;color:#d9366b}"+
    ".confirmArtsBody{overflow:auto;padding:20px 24px;background:#fffdfc}"+
    ".confirmArtsCount{display:inline-flex;margin-bottom:14px;border-radius:999px;padding:8px 12px;background:#fff1f6;color:#d9366b;border:1px solid #ffd6e5;font-size:12px;font-weight:900}"+
    ".confirmArtsGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(142px,1fr));gap:13px}"+
    ".confirmArtCard{border:1px solid #eee2e4;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 12px 25px rgba(34,33,36,.06)}"+
    ".confirmArtImgWrap{position:relative;aspect-ratio:1/1;background:linear-gradient(135deg,#fff2f7,#eefdff);cursor:zoom-in;overflow:hidden}"+
    ".confirmArtImgWrap img{width:100%;height:100%;object-fit:cover;display:block}"+
    ".confirmArtCode{position:absolute;top:9px;left:9px;border-radius:999px;background:rgba(255,255,255,.94);padding:6px 9px;font-size:12px;font-weight:900;color:#222124}"+
    ".confirmArtQty{position:absolute;right:8px;bottom:8px;border-radius:999px;background:#fff1f6;color:#d9366b;border:1px solid #ffd6e5;padding:6px 9px;font-size:11px;font-weight:900}"+
    ".confirmArtInfo{padding:10px 11px;display:grid;gap:4px}"+
    ".confirmArtInfo b{font-family:Montserrat,Arial,sans-serif;font-size:13px;color:#222124}"+
    ".confirmArtInfo span{font-size:11px;color:#7d767d;line-height:1.25}"+
    ".confirmArtsFoot{padding:16px 24px;border-top:1px solid #eee4e4;background:#fff;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}"+
    ".confirmBackBtn,.confirmSendBtn{border:0;border-radius:999px;min-height:46px;padding:0 18px;font-weight:900;cursor:pointer}"+
    ".confirmBackBtn{background:#fff;border:1px solid #eee0e4;color:#625a62}"+
    ".confirmSendBtn{background:#25d366;color:#fff;box-shadow:0 12px 24px rgba(37,211,102,.22)}"+
    ".confirmZoomBg{position:fixed;inset:0;background:rgba(20,18,22,.86);z-index:10000;display:none;align-items:center;justify-content:center;padding:18px}"+
    ".confirmZoomBg.show{display:flex}"+
    ".confirmZoomBox{width:min(760px,100%);display:grid;gap:12px;color:#fff}"+
    ".confirmZoomImage{max-height:76vh;border-radius:22px;overflow:hidden;background:#fff;display:grid;place-items:center}"+
    ".confirmZoomImage img{max-width:100%;max-height:76vh;object-fit:contain;display:block}"+
    ".confirmZoomInfo{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}"+
    ".confirmZoomInfo b{font-family:Montserrat,Arial,sans-serif;font-size:17px}"+
    ".confirmZoomControls{display:flex;gap:8px}"+
    ".confirmZoomControls button{border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;min-height:40px;padding:0 13px;font-weight:900;cursor:pointer}"+
    "@media(max-width:560px){.confirmArtsBg{padding:10px}.confirmArtsModal{border-radius:24px;max-height:92vh}.confirmArtsHead{padding:18px 16px 13px}.confirmArtsHead h3{font-size:21px}.confirmArtsBody{padding:16px}.confirmArtsGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.confirmArtsFoot{padding:14px 16px}.confirmBackBtn,.confirmSendBtn{width:100%}}";
    var style=document.createElement("style");
    style.id="confirmArtsStyles";
    style.textContent=css;
    document.head.appendChild(style);
  }

  function ensureModal(){
    ensureStyles();
    var t=modalText();
    if(byId("confirmArtsBg")){applyTexts();return;}
    var root=document.createElement("div");
    root.innerHTML='<div class="confirmArtsBg" id="confirmArtsBg" aria-hidden="true"><section class="confirmArtsModal" role="dialog" aria-modal="true" aria-labelledby="confirmArtsTitle"><header class="confirmArtsHead"><div><h3 id="confirmArtsTitle"></h3><p id="confirmArtsSubtitle"></p></div><button class="confirmArtsClose" id="confirmArtsClose" type="button">×</button></header><div class="confirmArtsBody"><span class="confirmArtsCount" id="confirmArtsCount"></span><div class="confirmArtsGrid" id="confirmArtsGrid"></div></div><footer class="confirmArtsFoot"><button class="confirmBackBtn" id="confirmBackBtn" type="button"></button><button class="confirmSendBtn" id="confirmSendBtn" type="button"></button></footer></section></div><div class="confirmZoomBg" id="confirmZoomBg" aria-hidden="true"><div class="confirmZoomBox"><div class="confirmZoomImage"><img id="confirmZoomImg" src="" alt="Arte ampliada"></div><div class="confirmZoomInfo"><b id="confirmZoomTitle">Código</b><div class="confirmZoomControls"><button type="button" id="confirmZoomPrev"></button><button type="button" id="confirmZoomNext"></button><button type="button" id="confirmZoomClose"></button></div></div></div></div>';
    document.body.appendChild(root);
    byId("confirmArtsClose").onclick=closeModal;
    byId("confirmBackBtn").onclick=closeModal;
    byId("confirmSendBtn").onclick=function(){var href=state.waHref||getWaUrl();closeModal();window.open(href,"_blank","noopener");};
    byId("confirmArtsBg").addEventListener("click",function(e){if(e.target===byId("confirmArtsBg"))closeModal();});
    byId("confirmZoomBg").addEventListener("click",function(e){if(e.target===byId("confirmZoomBg"))closeZoom();});
    byId("confirmZoomClose").onclick=closeZoom;
    byId("confirmZoomPrev").onclick=function(){moveZoom(-1)};
    byId("confirmZoomNext").onclick=function(){moveZoom(1)};
    document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeZoom();closeModal()} if(byId("confirmZoomBg")&&byId("confirmZoomBg").classList.contains("show")){if(e.key==="ArrowLeft")moveZoom(-1);if(e.key==="ArrowRight")moveZoom(1);}});
    applyTexts();
  }

  function applyTexts(){var t=modalText();byId("confirmArtsTitle").textContent=t.title||fallbackModal.title;byId("confirmArtsSubtitle").textContent=t.subtitle||fallbackModal.subtitle;byId("confirmBackBtn").textContent=t.backButton||fallbackModal.backButton;byId("confirmSendBtn").textContent=t.confirmButton||fallbackModal.confirmButton;byId("confirmZoomPrev").textContent=t.previousButton||fallbackModal.previousButton;byId("confirmZoomNext").textContent=t.nextButton||fallbackModal.nextButton;byId("confirmZoomClose").textContent=t.closeButton||fallbackModal.closeButton;}

  function renderModal(){
    var list=getCart();
    var t=modalText();
    byId("confirmArtsCount").textContent=fmt(t.countText||fallbackModal.countText,{quantidade:getQty()});
    var html=list.map(function(i,idx){
      var qty=Number(i.qty)||1;
      return '<article class="confirmArtCard"><div class="confirmArtImgWrap" data-confirm-zoom="'+idx+'"><img src="'+esc(i.image||"")+'" alt="Arte código '+esc(i.code||"")+'"><span class="confirmArtCode">#'+esc(i.code||"")+'</span>'+(qty>1?'<span class="confirmArtQty">'+qty+' un.</span>':'')+'</div><div class="confirmArtInfo"><b>Código #'+esc(i.code||"")+'</b><span>'+esc(i.theme||"")+'</span></div></article>';
    }).join("");
    byId("confirmArtsGrid").innerHTML=html||'<div class="empty"><b>Nenhuma arte no carrinho.</b></div>';
    Array.prototype.forEach.call(document.querySelectorAll("[data-confirm-zoom]"),function(el){el.onclick=function(){openZoom(Number(el.getAttribute("data-confirm-zoom"))||0)}});
  }

  function openModal(href){ensureModal();state.waHref=href||getWaUrl();renderModal();byId("confirmArtsBg").classList.add("show");byId("confirmArtsBg").setAttribute("aria-hidden","false");}
  function closeModal(){var el=byId("confirmArtsBg");if(el){el.classList.remove("show");el.setAttribute("aria-hidden","true");}}
  function openZoom(index){var list=getCart();if(!list.length)return;state.zoomIndex=Math.max(0,Math.min(index,list.length-1));renderZoom();byId("confirmZoomBg").classList.add("show");byId("confirmZoomBg").setAttribute("aria-hidden","false");}
  function closeZoom(){var el=byId("confirmZoomBg");if(el){el.classList.remove("show");el.setAttribute("aria-hidden","true");}}
  function moveZoom(delta){var list=getCart();if(!list.length)return;state.zoomIndex=(state.zoomIndex+delta+list.length)%list.length;renderZoom();}
  function renderZoom(){var item=getCart()[state.zoomIndex];if(!item)return;byId("confirmZoomImg").src=item.image||"";byId("confirmZoomTitle").textContent="Código #"+(item.code||"")+(item.qty>1?" · "+item.qty+" un.":"");}

  document.addEventListener("click",function(e){
    var link=e.target&&e.target.closest?e.target.closest("a.wa"):null;
    if(!link)return;
    if(link.classList.contains("disabled")||link.getAttribute("href")==="#")return;
    var rule=getRule();
    if(!rule.ok)return;
    e.preventDefault();
    openModal(link.getAttribute("href")||getWaUrl());
  },true);
})();
