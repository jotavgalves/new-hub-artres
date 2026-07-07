(function(){
  if(window.ArmazemOrderPdf)return;
  var LOGO='https://acompanhe-armazem.pages.dev/assets/logo.svg';
  function s(v){return String(v==null?'':v).trim()}
  function asc(v){return s(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'')}
  function dig(v){return s(v).replace(/\D/g,'')}
  function arr(o){return Array.isArray(o&&o.items)?o.items:[]}
  function ono(o){return s(o&&(o.orderNumber||o.orderCode||o.displayId||o.id))}
  function cust(o){return o&&o.customer||{}}
  function sell(o){return o&&o.seller||{}}
  function code(i){return s(i&&(i.code||i.codigo||i.id)).replace(/^#/,'')}
  function prod(i){return s(i&&(i.productName||i.product_name||i.product||'Artes'))||'Artes'}
  function theme(i){return s(i&&i.theme)}
  function qty(i){return Math.max(1,Number(i&&(i.qty||i.quantity||1))||1)}
  function imgUrl(i){return s(i&&(i.image||i.thumbnail||i.thumb||i.url||i.imageUrl||i.image_url))}
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
      var u=new URL(url,location.origin).toString();
      var im=await Promise.race([loadImg(u),wait(8000)]);
      var c=document.createElement('canvas'),x=c.getContext('2d');c.width=w;c.height=h;x.fillStyle='#fff';x.fillRect(0,0,w,h);
      var iw=im.naturalWidth||im.width,ih=im.naturalHeight||im.height,sc=Math.min(w/iw,h/ih),dw=iw*sc,dh=ih*sc;
      x.drawImage(im,(w-dw)/2,(h-dh)/2,dw,dh);
      return {w:w,h:h,bin:dataBin(c.toDataURL('image/jpeg',q||.76))};
    }catch(e){return null}
  }
  async function eachLimit(list,limit,fn){var out=Array(list.length),n=0;async function run(){while(n<list.length){var i=n++;out[i]=await fn(list[i],i)}}var a=[];for(var i=0;i<Math.min(limit,list.length);i++)a.push(run());await Promise.all(a);return out}
  function rgb(r,g,b){return (r/255).toFixed(3)+' '+(g/255).toFixed(3)+' '+(b/255).toFixed(3)}
  function T(txt,x,y,sz,bold,col,align){col=col||[34,33,36];var out='BT /F1 '+sz+' Tf '+rgb(col[0],col[1],col[2])+' rg ';var tx=x;if(align==='right')tx=x-(asc(txt).length*sz*.35);if(align==='center')tx=x-(asc(txt).length*sz*.18);return out+tx.toFixed(2)+' '+y.toFixed(2)+' Td ('+pdfEsc(txt)+') Tj ET\n'}
  function R(x,y,w,h,fill,stroke){var a='';if(fill)a+=rgb(fill[0],fill[1],fill[2])+' rg ';if(stroke)a+=rgb(stroke[0],stroke[1],stroke[2])+' RG ';return a+x+' '+y+' '+w+' '+h+' re '+(fill&&stroke?'B':fill?'f':'S')+'\n'}
  function IM(name,x,y,w,h){return 'q '+w+' 0 0 '+h+' '+x+' '+y+' cm /'+name+' Do Q\n'}
  function drawPage(order,page,total,chunk,imgs,logo,names){
    var H=842,cmd='';cmd+=R(0,0,595,842,[255,250,246]);cmd+=R(28,714,539,96,[255,255,255],[240,226,230]);
    if(logo)cmd+=IM(names.logo,42,752,125,36);else cmd+=T('ARMAZEM',42,770,18,1,[217,54,107]);
    var c=cust(order),v=sell(order);cmd+=T('Resumo visual do pedido',190,785,8,1,[217,54,107]);cmd+=T(ono(order),190,760,20,1,[34,33,36]);cmd+=T(date(order&&order.createdAt),190,742,8,0,[111,104,114]);
    cmd+=T('Cliente',385,788,7,1,[141,133,144]);cmd+=T(cut(c.name||'Nao informado',28),385,770,10,1);cmd+=T('WhatsApp: '+cut(c.whatsapp||c.phone||'--',22),385,752,8,0,[111,104,114]);cmd+=T('Vend.: '+cut(v.label||v.name||v.id||'--',18),385,736,8,0,[111,104,114]);
    cmd+=T('Pagina '+page+'/'+total,540,24,8,1,[141,133,144],'right');cmd+=T('Armazem Festas e Eventos - Hub de Artes',298,24,8,1,[141,133,144],'center');
    var xs=[34,304],ys=[566,425,284,143],cw=257,ch=122,iw=237,ih=78;
    chunk.forEach(function(it,i){var x=xs[i%2],y=ys[Math.floor(i/2)],nm=names.imgs[i];cmd+=R(x,y,cw,ch,[255,255,255],[240,226,230]);if(imgs[i])cmd+=IM(nm,x+10,y+34,iw,ih);else{cmd+=R(x+10,y+34,iw,ih,[255,241,246]);cmd+=T('#'+(code(it)||'--'),x+cw/2,y+72,22,1,[217,54,107],'center')}cmd+=T('#'+(code(it)||'--'),x+10,y+18,13,1);cmd+=T(qty(it)+' un.',x+cw-12,y+18,8,1,[111,104,114],'right');cmd+=T(cut(prod(it),25),x+10,y+8,8,1,[111,104,114]);cmd+=T(cut(theme(it),22),x+cw-12,y+8,8,0,[111,104,114],'right')});
    return cmd;
  }
  function build(order,arts,artImgs,logo){
    var objs=[],pages=[],font=add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');function add(x){objs.push(x);return objs.length}
    objs.push('');objs.push('');var catalog=1,pagesId=2;
    var chunks=[];for(var i=0;i<arts.length;i+=8)chunks.push(arts.slice(i,i+8));
    chunks.forEach(function(ch,p){var xo={},names={imgs:[]},imgIds=[];ch.forEach(function(it,i){var im=artImgs[p*8+i];if(im){var id=add('<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+im.bin.length+' >>\nstream\n'+im.bin+'\nendstream');var nm='I'+p+'_'+i;xo[nm]=id;names.imgs[i]=nm;imgIds.push(id)}});if(logo){var lid=add('<< /Type /XObject /Subtype /Image /Width '+logo.w+' /Height '+logo.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+logo.bin.length+' >>\nstream\n'+logo.bin+'\nendstream');xo.LG=lid;names.logo='LG'}var content=drawPage(order,p+1,chunks.length,ch,ch.map(function(_,i){return artImgs[p*8+i]}),logo,names);var cid=add('<< /Length '+content.length+' >>\nstream\n'+content+'endstream');var xos=Object.keys(xo).map(function(k){return '/'+k+' '+xo[k]+' 0 R'}).join(' ');var pid=add('<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 '+font+' 0 R >> /XObject << '+xos+' >> >> /Contents '+cid+' 0 R >>');pages.push(pid)});
    objs[catalog-1]='<< /Type /Catalog /Pages '+pagesId+' 0 R >>';objs[pagesId-1]='<< /Type /Pages /Kids ['+pages.map(function(p){return p+' 0 R'}).join(' ')+'] /Count '+pages.length+' >>';
    var pdf='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',ofs=[0];objs.forEach(function(o,i){ofs[i+1]=pdf.length;pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n'});var start=pdf.length;pdf+='xref\n0 '+(objs.length+1)+'\n0000000000 65535 f \n';for(var j=1;j<ofs.length;j++)pdf+=String(ofs[j]).padStart(10,'0')+' 00000 n \n';pdf+='trailer << /Size '+(objs.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';var u=new Uint8Array(pdf.length);for(var k=0;k<pdf.length;k++)u[k]=pdf.charCodeAt(k)&255;return u;
  }
  async function download(order){var arts=arr(order);if(!arts.length){alert('Este pedido nao tem artes para gerar PDF.');return false}try{status('Gerando PDF... carregando imagens');var imgs=await eachLimit(arts,3,function(i){return thumb(imgUrl(i),700,430,.76)});var logo=await thumb(LOGO,700,210,.82);status('Gerando PDF... montando arquivo');var bytes=build(order,arts,imgs,logo);var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));a.download=name(order);document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1200);status('PDF baixado.');setTimeout(hide,1400);return true}catch(e){hide();alert('Nao consegui gerar o PDF.');return false}}
  window.ArmazemOrderPdf={download:download};
})();
