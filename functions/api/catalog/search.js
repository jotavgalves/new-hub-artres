let CACHE={at:0,rows:[]};
const TTL=10*60*1000;
const PAGE=1000;

export async function onRequestGet(context){
  try{
    const url=new URL(context.request.url);
    const q=String(url.searchParams.get('q')||'').trim();
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||80),1),120);
    if(norm(q).length<1)return json({ok:true,total:0,items:[],folders:[],source:'supabase-artworks'});
    const rows=await loadRows(context.env);
    const matches=searchRows(rows,q).slice(0,limit).map(mapItem);
    return json({ok:true,total:matches.length,items:matches,folders:[],source:'supabase-artworks',cached:Date.now()-CACHE.at<TTL});
  }catch(error){
    return json({ok:false,error:String(error&&error.message||error||'ERRO_BUSCA_CATALOGO')},500);
  }
}

async function loadRows(env){
  if(CACHE.rows.length&&Date.now()-CACHE.at<TTL)return CACHE.rows;
  const base=restBase(env.ARTS_SUPABASE_URL||env.SUPABASE_ARTS_URL||env.ARTWORKS_SUPABASE_URL);
  const key=String(env.ARTS_SUPABASE_SERVICE_KEY||env.SUPABASE_ARTS_SERVICE_KEY||env.ARTWORKS_SUPABASE_SERVICE_KEY||'').trim();
  if(!base||!key)throw new Error('CONFIGURE_ARTS_SUPABASE_URL_E_SERVICE_KEY');
  const rows=[];
  for(let offset=0;offset<20000;offset+=PAGE){
    const params=new URLSearchParams({select:'id,theme,product,size,drive_file_id,drive_url,drive_file_name,deleted_at,status',order:'id.desc',limit:String(PAGE),offset:String(offset)});
    params.set('deleted_at','is.null');
    const r=await fetch(base+'/artworks?'+params.toString(),{headers:{apikey:key,Authorization:'Bearer '+key,Accept:'application/json'}});
    if(!r.ok)throw new Error('SUPABASE_ARTWORKS_'+r.status);
    const page=await r.json();
    if(!Array.isArray(page)||!page.length)break;
    rows.push(...page);
    if(page.length<PAGE)break;
  }
  CACHE={at:Date.now(),rows};
  return rows;
}

function searchRows(rows,q){
  const raw=String(q||'').trim();
  const nq=norm(raw);
  const digits=raw.replace(/\D/g,'');
  const tokens=nq.split(' ').filter(Boolean);
  const looksDriveId=/^[A-Za-z0-9_-]{10,}$/.test(raw);
  return rows.filter(function(r){
    const id=String(r.id||'');
    const fileId=String(r.drive_file_id||'');
    const file=String(r.drive_file_name||'');
    if(digits&&id===digits)return true;
    if(looksDriveId&&fileId===raw)return true;
    const hay=norm([id,r.theme,r.product,r.size,file,fileId].join(' '));
    if(hay.includes(nq))return true;
    return tokens.length>1&&tokens.every(t=>hay.includes(t));
  }).sort(function(a,b){return score(b,q)-score(a,q)||Number(b.id||0)-Number(a.id||0)});
}

function score(r,q){
  const raw=String(q||'').trim();
  const digits=raw.replace(/\D/g,'');
  const nq=norm(raw);
  const id=String(r.id||'');
  const fileId=String(r.drive_file_id||'');
  if(digits&&id===digits)return 1000;
  if(fileId&&fileId===raw)return 950;
  if(norm(r.theme)===nq)return 800;
  if(norm(r.product)===nq)return 700;
  if(norm(r.drive_file_name).includes(nq))return 600;
  if(norm(r.theme).includes(nq))return 500;
  if(norm(r.product).includes(nq))return 400;
  return 1;
}

function mapItem(r){
  const driveId=String(r.drive_file_id||'').trim();
  const img=driveId?'https://drive.google.com/thumbnail?id='+encodeURIComponent(driveId)+'&sz=w1200':'';
  return{ id:driveId||String(r.id), code:String(r.id||''), theme:String(r.theme||'Sem tema'), product:String(r.product||''), productName:String(r.product||''), productLabel:String(r.product||''), size:String(r.size||''), dimension:String(r.size||''), driveFileId:driveId, originalName:String(r.drive_file_name||''), driveUrl:String(r.drive_url||''), image:img, thumbnail:img, qty:1, details:{} };
}

function restBase(value){
  let u=String(value||'').trim().replace(/\/+$/,'');
  if(!u)return'';
  if(!/\/rest\/v1$/.test(u))u+='/rest/v1';
  return u;
}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'}})}
