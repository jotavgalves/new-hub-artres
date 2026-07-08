(function(){
  if(window.ArmazemOrderPdf&&window.ArmazemOrderPdf.version==='4')return;
  var LOGO='https://acompanhe-armazem.pages.dev/assets/logo.svg';
  function s(v){return String(v==null?'':v).trim()}
  function asc(v){return s(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'')}
  function arr(o){return Array.isArray(o&&o.items)?o.items:[]}
  function ono(o){return s(o&&(o.orderNumber||o.orderCode||o.displayId||o.id))}
  function cust(o){return o&&o.customer||{}}
  function sell(o){return o&&o.seller||{}}
  function code(i){return s(i&&(i.code||i.codigo||i.id||i.artCode||i.art_code)).replace(/^#/,'')}
  function prod(i){return s(i&&(i.productName||i.product_name||i.product||i.category||'Artes'))||'Produto'}
  function theme(i){return s(i&&(i.theme||i.themeName||i.theme_name||i.tema))}
  function qty(i){return Math.max(1,Number(i&&(i.qty||i.quantity||1))||1)}
  function imgUrl(i){var r=i&&i.raw||{};return s(i&&(i.image||i.thumbnail||i.thumb||i.url||i.imageUrl||i.image_url||i.preview||i.previewUrl)||r.image||r.thumbnail||r.thumb||r.url||r.imageUrl||r.image_url||'')}
  function proxy(u){if(!u)return '';try{return '/api/admin/image-proxy?url='+encodeURIComponent(new URL(u,location.origin).toString())}catch(e){return ''}}
  function name(o){return (ono(o)||'pedido').replace(/[^a-z0-9_-]+/gi,'-').replace(/-+/g,'-')+'-armazem.pdf'}
  function cut(v,n){v=asc(v);return v.length>n?v.slice(0,n-1)+'...':v}
  function date(v){try{return new Date(v||Date.now()).toLocaleDateString('pt-BR')}catch(e){return ''}}
  function b64bin(b64){var b=atob(b64),r='';for(var i=0;i<b.length;i++)r+=String.fromCharCode(b.charCodeAt(i)&255);return r}
  function dataBin(data){var p=data.indexOf(',');return p>=0?b64bin(data.slice(p+1)):''}
  function pdfEsc(v){return asc(v).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)')}
  function status(t){var e=document.getElementById('pdfStatus');if(!e){e=document.createElement('div');e.id='pdfStatus';e.style.cssText='position:fixed;z-index:99999;left:50%;bottom:22px;transform:translateX(-50%);background:#222124;color:#fff;border-radius:999px;padding:12px 18px;font:900 13px Arial;box-shadow:0 16px 32px #0004';document.body.appendChild(e)}e.textContent=t;e.style.display='block'}
  function hide(){var e=document.getElementById('pdfStatus');if(e)e.style.display='none'}
  function wait(ms){return new Promise(function(_,rej){setTimeout(function(){rej(Error('timeout'))},ms)})}
  function loadImg(url){return new Promise(function(res,rej){var im=new Image();im.crossOrigin='anonymous';im.onload=function(){res(im)};im.onerror=rej;im.src=url})}
  async function thumb(url,w,h,q){
    if(!url)return null;
    try{
      var im=await Promise.race([loadImg(proxy(url)||url),wait(9000)]);
      var c=document.createElement('canvas'),x=c.getContext('2d');c.width=w;c.height=h;x.fillStyle='#fff';x.fillRect(0,0,w,h);
      var iw=im.naturalWidth||im.width,ih=im.naturalHeight||im.height,sc=Math.min(w/iw,h/ih),dw=iw*sc,dh=ih*sc;
      x.drawImage(im,(w-dw)/2,(h-dh)/2,dw,dh);
      return {w:w,h:h,bin:dataBin(c.toDataURL('image/jpeg',q||.88))};
    }catch(e){return null}
  }
  async function eachLimit(list,limit,fn){var out=Array(list.length),n=0;async function run(){while(n<list.length){var i=n++;out[i]=await fn(list[i],i)}}var a=[];for(var i=0;i<Math.min(limit,list.length);i++)a.push(run());await Promise.all(a);return out}
  function rgb(r,g,b){return (r/255).toFixed(3)+' '+(g/255).toFixed(3)+' '+(b/255).toFixed(3)}
  function widthOf(txt,sz){return asc(txt).length*sz*.49}
  function T(txt,x,y,sz,bold,col){col=col||[34,33,36];return 'BT /'+(bold?'F2':'F1')+' '+sz+' Tf '+rgb(col[0],col[1],col[2])+' rg '+x.toFixed(2)+' '+y.toFixed(2)+' Td ('+pdfEsc(txt)+') Tj ET\n'}
  function TR(txt,right,y,sz,bold,col){return T(txt,right-widthOf(txt,sz),y,sz,bold,col)}
  function R(x,y,w,h,fill,stroke,lw){var a='';if(lw)a+=lw+' w ';if(fill)a+=rgb(fill[0],fill[1],fill[2])+' rg ';if(stroke)a+=rgb(stroke[0],stroke[1],stroke[2])+' RG ';return a+x+' '+y+' '+w+' '+h+' re '+(fill&&stroke?'B':fill?'f':'S')+'\n'}
  function L(x1,y1,x2,y2,col,w){return rgb((col||[210,210,210])[0],(col||[210,210,210])[1],(col||[210,210,210])[2])+' RG '+(w||1)+' w '+x1+' '+y1+' m '+x2+' '+y2+' l S\n'}
  function IM(name,x,y,w,h){return 'q '+w+' 0 0 '+h+' '+x+' '+y+' cm /'+name+' Do Q\n'}
  function line(label,value,x,y,labelSize,valueSize,valueX){return T(label,x,y,labelSize,1,[34,33,36])+T(value,valueX,y,valueSize,0,[34,33,36])}
  function drawPage(order,item,page,total,img,logo,names){
    var cmd='',c=cust(order),v=sell(order),ref=code(item)||'--',right=555;
    cmd+=R(0,0,595,842,[255,255,255]);
    cmd+=R(0,834,198,8,[63,187,221]);cmd+=R(198,834,198,8,[247,220,98]);cmd+=R(396,834,199,8,[239,85,133]);
    if(logo)cmd+=IM(names.logo,40,724,160,78);else cmd+=T('ARMAZEM',40,768,24,1,[0,0,0]);
    cmd+=TR(ono(order),right,790,18,1,[239,85,133]);
    cmd+=TR('Cliente: '+cut(c.name||'Nao informado',34),right,770,12,0,[34,33,36]);
    cmd+=TR('Vendedora: '+cut(v.label||v.name||v.id||'--',24),right,755,12,0,[34,33,36]);
    cmd+=TR('Data: '+date(order&&order.createdAt),right,740,12,0,[34,33,36]);
    cmd+=L(40,712,555,712,[202,202,202],1);
    cmd+=R(40,172,515,500,[247,253,255],[63,187,221],2);
    if(img)cmd+=IM(names.art,50,182,495,480);else{cmd+=R(50,182,495,480,[255,241,246]);cmd+=T('#'+ref,298,420,34,1,[217,54,107])}
    cmd+=line('Produto:',prod(item),40,136,16,16,109);
    cmd+=line('Quantidade:',String(qty(item)),40,108,14,14,128);
    if(theme(item))cmd+=line('Tema:',theme(item),40,80,14,14,86);
    cmd+=line('Ref:',ref,40,52,14,14,73);
    cmd+=T('Ficha de Producao - Gerado automaticamente',40,24,8,0,[153,153,153]);
    cmd+=TR('Pagina '+page+' de '+total,555,24,8,0,[153,153,153]);
    return cmd;
  }
  function build(order,arts,artImgs,logo){
    var objs=[],pages=[];function add(x){objs.push(x);return objs.length}
    var catalog=add(''),pagesId=add(''),fontRegular=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),fontBold=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    arts.forEach(function(item,p){var xo={},names={};var im=artImgs[p];if(im){var iid=add('<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+im.bin.length+' >>\nstream\n'+im.bin+'\nendstream');xo.ART=iid;names.art='ART'}if(logo){var lid=add('<< /Type /XObject /Subtype /Image /Width '+logo.w+' /Height '+logo.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+logo.bin.length+' >>\nstream\n'+logo.bin+'\nendstream');xo.LG=lid;names.logo='LG'}var content=drawPage(order,item,p+1,arts.length,im,logo,names);var cid=add('<< /Length '+content.length+' >>\nstream\n'+content+'endstream');var xos=Object.keys(xo).map(function(k){return '/'+k+' '+xo[k]+' 0 R'}).join(' ');var pid=add('<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 '+fontRegular+' 0 R /F2 '+fontBold+' 0 R >> /XObject << '+xos+' >> >> /Contents '+cid+' 0 R >>');pages.push(pid)});
    objs[catalog-1]='<< /Type /Catalog /Pages '+pagesId+' 0 R >>';objs[pagesId-1]='<< /Type /Pages /Kids ['+pages.map(function(p){return p+' 0 R'}).join(' ')+'] /Count '+pages.length+' >>';
    var pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',ofs=[0];objs.forEach(function(o,i){ofs[i+1]=pdf.length;pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n'});var start=pdf.length;pdf+='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n';for(var j=1;j<ofs.length;j++)pdf+=String(ofs[j]).padStart(10,'0')+' 00000 n \n';pdf+='trailer << /Size '+(objs.length+1)+' /Root '+catalog+' 0 R >>\nstartxref\n'+start+'\n%%EOF';var u=new Uint8Array(pdf.length);for(var k=0;k<pdf.length;k++)u[k]=pdf.charCodeAt(k)&255;return u;
  }
  async function download(order){var arts=arr(order);if(!arts.length){alert('Este pedido nao tem artes para gerar PDF.');return false}try{status('Gerando PDF... carregando imagens');var imgs=await eachLimit(arts,2,function(i){return thumb(imgUrl(i),1200,1164,.90)});var logo=await thumb(LOGO,1200,585,.90);status('Gerando PDF... montando arquivo');var bytes=build(order,arts,imgs,logo);var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));a.download=name(order);document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1200);status('PDF baixado.');setTimeout(hide,1400);return true}catch(e){hide();alert('Nao consegui gerar o PDF.');return false}}
  function bridge(){if(window.ArmazemOrderTools){window.ArmazemOrderTools.openPdf=download;window.__ARMAZEM_REAL_PDF_BRIDGE__=true;return true}return false}
  window.ArmazemOrderPdf={version:'4',download:download};
  if(!bridge()){var tries=0,t=setInterval(function(){tries++;if(bridge()||tries>40)clearInterval(t)},250)}
})();
