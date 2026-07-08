let CACHE={at:0,rows:[]};
let QUERY_CACHE={};
const TTL=10*60*1000;
const QUERY_TTL=5*60*1000;
const PAGE=1000;
const CACHE_ROWS_LIMIT=20000;
const SELECT='id,theme,product,size,drive_file_id,drive_url,drive_file_name,deleted_at';

export async function onRequestGet(context){
  try{
    const url=new URL(context.request.url);
    const q=String(url.searchParams.get('q')||'').trim();
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||80),1),120);
    const debug=url.searchParams.get('debug')==='1';
    const nq=norm(q);
    const digits=q.replace(/\D/g,'');

    if(nq.length<2&&digits.length<2){
      return json({ok:true,total:0,items:[],folders:[],source:'supabase-artworks'});
    }

    const direct=await directSearch(context.env,q,limit);
    let matches=searchRows(direct,q);
    let cacheRows=0;

    if(matches.length<1&&nq.length>=3){
      const rows=await loadRows(context.env);
      cacheRows=rows.length;
      matches=searchRows(rows,q);
    }

    matches=matches.slice(0,limit);
    const payload={ok:true,total:matches.length,items:matches.map(mapItem),folders:[],source:'supabase-artworks'};
    if(debug)payload.debug={directRows:direct.length,cacheRows:cacheRows,query:nq};
    return json(payload);
  }catch(error){
    return json({ok:false,error:String(error&&error.message||error||'ERRO_BUSCA_CATALOGO')},500);
  }
}

async function loadRows(env){
  if(CACHE.rows.length&&Date.now()-CACHE.at<TTL)return CACHE.rows;
  const cfg=config(env);
  const rows=[];
  for(let offset=0;offset<CACHE_ROWS_LIMIT;offset+=PAGE){
    const params=new URLSearchParams({select:SELECT,order:'id.desc',limit:String(PAGE),offset:String(offset)});
    params.set('deleted_at','is.null');
    const page=await fetchRows(cfg,params);
    if(!page.length)break;
    rows.push(...page);
    if(page.length<PAGE)break;
  }
  CACHE={at:Date.now(),rows};
  return rows;
}

async function directSearch(env,q,limit){
  const key=norm(q)+'|'+limit;
  const hit=QUERY_CACHE[key];
  if(hit&&Date.now()-hit.at<QUERY_TTL)return hit.rows;

  const cfg=config(env);
  const raw=String(q||'').trim();
  const rows=[];
  const digits=raw.replace(/\D/g,'');

  if(digits.length>=2){
    rows.push(...await fetchByParams(cfg,{id:'eq.'+digits},limit));
  }

  if(/^[A-Za-z0-9_-]{10,}$/.test(raw)){
    rows.push(...await fetchByParams(cfg,{drive_file_id:'eq.'+raw},limit));
  }

  const terms=buildTerms(raw);
  for(let i=0;i<terms.length&&rows.length<limit;i++){
    rows.push(...await fetchByText(cfg,terms[i],limit));
  }

  const deduped=sortRows(dedupeRows(rows),q);
  QUERY_CACHE[key]={at:Date.now(),rows:deduped};
  return deduped;
}

async function fetchByParams(cfg,filters,limit){
  const params=new URLSearchParams({select:SELECT,order:'id.desc',limit:String(limit)});
  params.set('deleted_at','is.null');
  Object.keys(filters).forEach(function(k){params.set(k,filters[k])});
  return fetchRows(cfg,params);
}

async function fetchByText(cfg,term,limit){
  const clean=cleanLike(term);
  if(norm(clean).length<2)return[];
  const params=new URLSearchParams({select:SELECT,order:'id.desc',limit:String(limit)});
  params.set('deleted_at','is.null');
  params.set('or','('+['theme','product','size','drive_file_name','drive_file_id'].map(function(c){return c+'.ilike.*'+clean+'*'}).join(',')+')');
  return fetchRows(cfg,params);
}

async function fetchRows(cfg,params){
  const r=await fetch(cfg.base+'/artworks?'+params.toString(),{headers:{apikey:cfg.key,Authorization:'Bearer '+cfg.key,Accept:'application/json'}});
  if(!r.ok)throw new Error('SUPABASE_ARTWORKS_'+r.status);
  const page=await r.json();
  return Array.isArray(page)?page:[];
}

function searchRows(rows,q){
  const raw=String(q||'').trim();
  const nq=norm(raw);
  const digits=raw.replace(/\D/g,'');
  const tokens=nq.split(' ').filter(Boolean);
  const looksDriveId=/^[A-Za-z0-9_-]{10,}$/.test(raw);
  return sortRows(dedupeRows(rows).filter(function(r){
    const id=String(r.id||'');
    const fileId=String(r.drive_file_id||'');
    const file=String(r.drive_file_name||'');
    if(digits&&id===digits)return true;
    if(looksDriveId&&fileId===raw)return true;
    const hay=norm([id,r.theme,r.product,r.size,file,fileId].join(' '));
    if(hay.includes(nq))return true;
    return tokens.length>1&&tokens.every(function(t){return hay.includes(t)});
  }),q);
}

function sortRows(rows,q){
  return dedupeRows(rows).sort(function(a,b){return score(b,q)-score(a,q)||Number(b.id||0)-Number(a.id||0)});
}

function score(r,q){
  const raw=String(q||'').trim();
  const digits=raw.replace(/\D/g,'');
  const nq=norm(raw);
  const id=String(r.id||'');
  const fileId=String(r.drive_file_id||'');
  const hay=norm([id,r.theme,r.product,r.size,r.drive_file_name,fileId].join(' '));
  const tokens=nq.split(' ').filter(Boolean);
  if(digits&&id===digits)return 1000;
  if(fileId&&fileId===raw)return 950;
  if(norm(r.theme)===nq)return 850;
  if(norm(r.product)===nq)return 800;
  if(norm(r.size)===nq)return 760;
  if(norm(r.drive_file_name).includes(nq))return 700;
  if(norm(r.theme).includes(nq))return 650;
  if(norm(r.product).includes(nq))return 600;
  if(tokens.length>1&&tokens.every(function(t){return hay.includes(t)}))return 500;
  return 1;
}

function mapItem(r){
  const driveId=String(r.drive_file_id||'').trim();
  const img=driveId?'https://drive.google.com/thumbnail?id='+encodeURIComponent(driveId)+'&sz=w1200':'';
  return{ id:driveId||String(r.id), code:String(r.id||''), theme:String(r.theme||'Sem tema'), product:String(r.product||''), productName:String(r.product||''), productLabel:String(r.product||''), size:String(r.size||''), dimension:String(r.size||''), driveFileId:driveId, originalName:String(r.drive_file_name||''), driveUrl:String(r.drive_url||''), image:img, thumbnail:img, qty:1, details:{} };
}

function buildTerms(raw){
  const out=[];
  addTerm(out,raw);
  addTerm(out,norm(raw));
  accentVariants(norm(raw)).forEach(function(v){addTerm(out,v)});
  return out.slice(0,4);
}

function accentVariants(s){
  const v=[];
  const x=String(s||'');
  if(x.includes('ao'))v.push(x.replace(/ao/g,'ão'));
  if(x.includes('oes'))v.push(x.replace(/oes/g,'ões'));
  if(x.includes('cao'))v.push(x.replace(/cao/g,'ção'));
  if(x.includes('coes'))v.push(x.replace(/coes/g,'ções'));
  return v;
}

function addTerm(out,v){
  const x=String(v||'').replace(/\s+/g,' ').trim();
  if(norm(x).length>1&&!out.some(function(y){return norm(y)===norm(x)}))out.push(x);
}

function cleanLike(v){return String(v||'').replace(/[(),]/g,' ').replace(/[\*%]/g,' ').replace(/\s+/g,' ').trim()}
function dedupeRows(rows){const seen={};return(rows||[]).filter(function(r){const k=String(r.drive_file_id||r.id||'');if(!k||seen[k])return false;seen[k]=true;return true})}
function config(env){const base=restBase(env.ARTS_SUPABASE_URL||env.SUPABASE_ARTS_URL||env.ARTWORKS_SUPABASE_URL);const key=String(env.ARTS_SUPABASE_SERVICE_KEY||env.SUPABASE_ARTS_SERVICE_KEY||env.ARTWORKS_SUPABASE_SERVICE_KEY||'').trim();if(!base||!key)throw new Error('CONFIGURE_ARTS_SUPABASE_URL_E_SERVICE_KEY');return{base,key}}
function restBase(value){let u=String(value||'').trim().replace(/\/+$/,'');if(!u)return'';if(!/\/rest\/v1$/.test(u))u+='/rest/v1';return u}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim()}
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'}})}
