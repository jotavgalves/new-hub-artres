#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const VERSION = '1.0.0';

const API_KEY = firstEnv('GOOGLE_API_KEY','GOOGLE_DRIVE_API_KEY','DRIVE_API_KEY');
const SOURCE_ROOT_ID = process.env.KC_SOURCE_ROOT_ID || '11cU5yMWafopC0JfMHotRxThpkgbQl-RW';
const SOURCE_ROOT_NAME = process.env.KC_SOURCE_ROOT_NAME || 'PAINÉIS DE FESTA';
const DEST_ROOT_ID = process.env.KC_DEST_ROOT_ID || '1eZbQ5wv3-nyzbUirt6k5OoBnlK63Szpt';
const DEST_ROOT_NAME = process.env.KC_DEST_ROOT_NAME || 'KITS E CILINDROS (TEMP)';
const GROUP_SIZE = clampInt(process.env.KC_GROUP_SIZE,40,1,80);
const CONCURRENCY = clampInt(process.env.KC_CONCURRENCY,8,1,20);
const OUT_DIR = path.resolve(process.env.KC_OUT_DIR || 'kits-cilindros-simulation');

if(!API_KEY){
  console.error('Defina GOOGLE_API_KEY, GOOGLE_DRIVE_API_KEY ou DRIVE_API_KEY.');
  process.exit(1);
}

const startedAt=Date.now();
let requestCount=0;
const restrictedParents=new Set();

const root={
  id:SOURCE_ROOT_ID,name:SOURCE_ROOT_NAME,parentId:null,path:'',depth:0,
  url:`https://drive.google.com/drive/folders/${SOURCE_ROOT_ID}`,resourceKey:null
};

console.log('== SIMULAÇÃO Kits e Cilindros ==');
console.log('version:',VERSION);
console.log('source:',SOURCE_ROOT_ID);
console.log('destination:',DEST_ROOT_ID);
console.log('MODO: SOMENTE LEITURA — NENHUMA ALTERAÇÃO SERÁ FEITA');

const {nodes,nodeById}=await scanFolders(root);

const componentIds=new Set(nodes.filter(n=>isComponentName(n.name)).map(n=>n.id));
const topLevelComponents=nodes.filter(n=>{
  if(!componentIds.has(n.id)) return false;
  let pid=n.parentId;
  while(pid && pid!==SOURCE_ROOT_ID){
    if(componentIds.has(pid)) return false;
    pid=nodeById.get(pid)?.parentId || null;
  }
  return true;
});

const rawPlans=[];
const covered=[];
const skipped=[];

for(const n of nodes){
  if(!componentIds.has(n.id)) continue;
  if(topLevelComponents.some(x=>x.id===n.id)) continue;
  let pid=n.parentId, covering=null;
  while(pid && pid!==SOURCE_ROOT_ID){
    if(componentIds.has(pid)){ covering=nodeById.get(pid); break; }
    pid=nodeById.get(pid)?.parentId || null;
  }
  covered.push({
    status:'COBERTO_POR_COMPONENTE_PAI',
    componentId:n.id,componentName:n.name,sourcePath:n.path,
    coveredById:covering?.id||'',coveredByPath:covering?.path||''
  });
}

for(const component of topLevelComponents){
  const theme=nodeById.get(component.parentId);
  if(!theme || theme.id===SOURCE_ROOT_ID){
    skipped.push({
      status:'SEM_TEMA',
      componentId:component.id,
      componentName:component.name,
      sourcePath:component.path,
      reason:'A pasta componente está diretamente na raiz e não possui uma pasta-tema acima dela.'
    });
    continue;
  }

  rawPlans.push({
    componentId:component.id,
    componentName:component.name,
    canonicalType:canonicalComponent(component.name),
    sourcePath:component.path,
    themeId:theme.id,
    themeName:theme.name,
    themeSourcePath:theme.path,
    destinationRootId:DEST_ROOT_ID,
    destinationRootName:DEST_ROOT_NAME,
    destinationThemeName:theme.name,
    destinationThemePath:`${DEST_ROOT_NAME} / ${theme.name}`,
    destinationComponentPath:`${DEST_ROOT_NAME} / ${theme.name} / ${component.name}`
  });
}

// Detecta colisões: duas pastas-tema diferentes com o mesmo nome no destino plano.
const themesByNormalizedName=new Map();
for(const p of rawPlans){
  const key=normalize(p.themeName);
  if(!themesByNormalizedName.has(key)) themesByNormalizedName.set(key,new Map());
  themesByNormalizedName.get(key).set(p.themeId,p.themeSourcePath);
}
const collisionKeys=new Set([...themesByNormalizedName.entries()]
  .filter(([,ids])=>ids.size>1)
  .map(([key])=>key));

const plans=rawPlans.map(p=>({
  status:collisionKeys.has(normalize(p.themeName))?'COLISAO_DE_TEMA':'SIMULAR_MOVER',
  ...p,
  note:collisionKeys.has(normalize(p.themeName))
    ? 'Há mais de uma pasta-tema de origem com este mesmo nome. Não executar automaticamente sem resolver a colisão.'
    : 'Criar/reutilizar a pasta-tema no destino e mover esta pasta componente para dentro dela.'
}));

const uniqueThemes=new Map();
for(const p of plans){
  if(!uniqueThemes.has(p.themeId)){
    uniqueThemes.set(p.themeId,{
      themeId:p.themeId,
      themeName:p.themeName,
      themeSourcePath:p.themeSourcePath,
      destinationThemePath:p.destinationThemePath,
      collision:collisionKeys.has(normalize(p.themeName)),
      components:0
    });
  }
  uniqueThemes.get(p.themeId).components++;
}

const summary={
  version:VERSION,
  generatedAt:new Date().toISOString(),
  source:{id:SOURCE_ROOT_ID,name:SOURCE_ROOT_NAME,url:root.url},
  destination:{
    id:DEST_ROOT_ID,name:DEST_ROOT_NAME,
    url:`https://drive.google.com/drive/folders/${DEST_ROOT_ID}`
  },
  mode:'DRY_RUN_ONLY',
  scannedFolders:nodes.length,
  matchedComponentFolders:componentIds.size,
  topLevelComponentMoves:plans.length,
  themeContainers:uniqueThemes.size,
  collisionThemes:[...uniqueThemes.values()].filter(x=>x.collision).length,
  skippedNoTheme:skipped.length,
  coveredByParentComponent:covered.length,
  restrictedParents:restrictedParents.size,
  requests:requestCount,
  elapsedSeconds:Math.round((Date.now()-startedAt)/10)/100
};

await fs.mkdir(OUT_DIR,{recursive:true});
await fs.writeFile(path.join(OUT_DIR,'plano-movimentacao.json'),JSON.stringify({summary,themes:[...uniqueThemes.values()],plans,skipped,covered,restrictedParents:[...restrictedParents]},null,2),'utf8');
await fs.writeFile(path.join(OUT_DIR,'plano-movimentacao.csv'),toCsv(plans),'utf8');
await fs.writeFile(path.join(OUT_DIR,'temas-a-criar.csv'),themesCsv([...uniqueThemes.values()]),'utf8');
await fs.writeFile(path.join(OUT_DIR,'ignorados.csv'),ignoredCsv(skipped,covered),'utf8');
await fs.writeFile(path.join(OUT_DIR,'SIMULACAO.html'),buildHtml(summary,[...uniqueThemes.values()],plans,skipped,covered),'utf8');
await fs.writeFile(path.join(OUT_DIR,'RESUMO.txt'),buildTextSummary(summary),'utf8');

console.log('');
console.log('== RESULTADO DA SIMULAÇÃO ==');
console.log(JSON.stringify(summary,null,2));
console.log('Nenhuma pasta foi criada, movida, renomeada ou excluída.');

async function scanFolders(rootNode){
  const nodes=[];
  const nodeById=new Map([[rootNode.id,rootNode]]);
  const seen=new Set([rootNode.id]);
  let frontier=[rootNode];
  let level=0;

  while(frontier.length){
    const parentById=new Map(frontier.map(n=>[n.id,n]));
    const groups=chunk(frontier,GROUP_SIZE);
    console.log(`nível ${level}: ${frontier.length} pasta(s), ${groups.length} grupo(s)`);
    const next=[];

    for(let offset=0;offset<groups.length;offset+=CONCURRENCY){
      const wave=groups.slice(offset,offset+CONCURRENCY);
      const results=await Promise.all(wave.map(group=>listFoldersSafe(group)));
      for(const files of results){
        for(const file of files){
          const parentId=(file.parents||[]).find(id=>parentById.has(id));
          if(!parentId || !file.id || seen.has(file.id)) continue;
          seen.add(file.id);
          const parent=parentById.get(parentId);
          const name=clean(file.name||file.id);
          const node={
            id:file.id,name,parentId,
            path:parent.path?`${parent.path} / ${name}`:name,
            depth:parent.depth+1,
            url:file.webViewLink||`https://drive.google.com/drive/folders/${file.id}`,
            resourceKey:file.resourceKey||null
          };
          nodes.push(node);nodeById.set(node.id,node);next.push(node);
        }
      }
    }

    console.log(`  -> ${next.length} subpasta(s)`);
    frontier=next;level++;
  }
  return {nodes,nodeById};
}

async function listFoldersSafe(parentNodes){
  try{return await listFolders(parentNodes);}
  catch(error){
    if(!isPermissionError(error)) throw error;
    if(parentNodes.length===1){
      restrictedParents.add(parentNodes[0].id);
      console.warn(`  !! sem permissão: ${parentNodes[0].path||parentNodes[0].name}`);
      return [];
    }
    const mid=Math.ceil(parentNodes.length/2);
    const [a,b]=await Promise.all([
      listFoldersSafe(parentNodes.slice(0,mid)),
      listFoldersSafe(parentNodes.slice(mid))
    ]);
    return [...a,...b];
  }
}

async function listFolders(parentNodes){
  const ids=parentNodes.map(x=>x.id);
  const resourceKeys=parentNodes.filter(x=>x.resourceKey).map(x=>`${x.id}/${x.resourceKey}`).join(',');
  const all=[];
  let pageToken='';

  do{
    const qParents=ids.map(id=>`'${escapeDriveQuery(id)}' in parents`).join(' or ');
    const params=new URLSearchParams({
      key:API_KEY,
      q:`(${qParents}) and trashed = false and mimeType = '${FOLDER_MIME}'`,
      fields:'nextPageToken,files(id,name,mimeType,parents,webViewLink,resourceKey)',
      pageSize:'1000',
      orderBy:'name_natural',
      supportsAllDrives:'true',
      includeItemsFromAllDrives:'true'
    });
    if(pageToken) params.set('pageToken',pageToken);
    const headers={Accept:'application/json'};
    if(resourceKeys) headers['X-Goog-Drive-Resource-Keys']=resourceKeys;

    requestCount++;
    const response=await fetchWithRetry(`${DRIVE_API}?${params}`,{headers});
    if(!response.ok){
      const body=await response.text();
      const e=new Error(`Drive API ${response.status}: ${body}`);
      e.status=response.status;e.body=body;throw e;
    }
    const data=await response.json();
    if(Array.isArray(data.files)) all.push(...data.files);
    pageToken=data.nextPageToken||'';
  }while(pageToken);

  return all;
}

function isComponentName(name){
  const tokens=tokenize(name);
  const hasKit=tokens.includes('KIT') || (tokens.includes('KIR') && tokens.some(isCylinderToken));
  const hasCylinder=tokens.some(isCylinderToken);
  return hasKit || hasCylinder;
}

function isCylinderToken(token){
  const t=String(token||'').toUpperCase();
  if(['CILINDRO','CILINDROS','CICLINDROS','CILNIDROS','CILIDROS','CILINDOS','CILINDRO','CILINDROs'.toUpperCase()].includes(t)) return true;
  return levenshtein(t,'CILINDROS')<=2 || levenshtein(t,'CILINDRO')<=2;
}

function canonicalComponent(name){
  const tokens=tokenize(name);
  const hasKit=tokens.includes('KIT') || tokens.includes('KIR');
  const hasCylinder=tokens.some(isCylinderToken);
  const text=normalize(name);
  if(hasKit && hasCylinder) return 'KIT + CILINDROS';
  if(hasKit && text.includes('ROMANO')) return 'KIT + ROMANO';
  if(hasKit && text.includes('LATERAL')) return 'KIT + LATERAL';
  if(hasKit) return 'KIT';
  if(hasCylinder && text.includes('ROMANO')) return 'CILINDROS + ROMANO';
  if(hasCylinder && text.includes('LATERAL')) return 'CILINDROS + LATERAL';
  if(hasCylinder) return 'CILINDROS';
  return 'OUTRO';
}

function tokenize(value){
  return normalize(value).split(/[^A-Z0-9]+/).filter(Boolean);
}
function normalize(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
}
function clean(value){return String(value||'').replace(/\s+/g,' ').trim();}

function levenshtein(a,b){
  if(a===b)return 0;
  if(!a.length)return b.length;if(!b.length)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const cur=[i];
    for(let j=1;j<=b.length;j++){
      cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    }
    for(let j=0;j<cur.length;j++)prev[j]=cur[j];
  }
  return prev[b.length];
}

function isPermissionError(error){
  const text=String(error?.body||error?.message||error||'');
  return Number(error?.status)===403 ||
    /insufficientFilePermissions|does not have sufficient permissions|Drive API 403/i.test(text);
}

async function fetchWithRetry(url,options={},attempts=6){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const r=await fetch(url,options);
      if(![429,500,502,503,504].includes(r.status)) return r;
      last=new Error(`HTTP ${r.status}: ${await r.text()}`);
    }catch(e){last=e;}
    await new Promise(resolve=>setTimeout(resolve,Math.min(8000,400*2**i)));
  }
  throw last||new Error('Falha ao acessar o Drive');
}

function toCsv(plans){
  const head=['status','tipo_canonico','tema','caminho_tema_origem','pasta_componente','caminho_origem','destino_simulado','id_tema','id_componente','observacao'];
  const rows=[head,...plans.map(p=>[p.status,p.canonicalType,p.themeName,p.themeSourcePath,p.componentName,p.sourcePath,p.destinationComponentPath,p.themeId,p.componentId,p.note])];
  return rows.map(r=>r.map(csvEscape).join(',')).join('\n')+'\n';
}
function themesCsv(themes){
  const rows=[['tema','caminho_origem','destino_simulado','componentes','colisao','id_tema'],...themes.map(t=>[t.themeName,t.themeSourcePath,t.destinationThemePath,t.components,t.collision?'SIM':'NAO',t.themeId])];
  return rows.map(r=>r.map(csvEscape).join(',')).join('\n')+'\n';
}
function ignoredCsv(skipped,covered){
  const rows=[['status','pasta','origem','motivo_ou_coberto_por']];
  for(const x of skipped)rows.push([x.status,x.componentName,x.sourcePath,x.reason]);
  for(const x of covered)rows.push([x.status,x.componentName,x.sourcePath,x.coveredByPath]);
  return rows.map(r=>r.map(csvEscape).join(',')).join('\n')+'\n';
}
function csvEscape(v){
  const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function chunk(a,n){const out=[];for(let i=0;i<a.length;i+=n)out.push(a.slice(i,i+n));return out;}
function firstEnv(...names){for(const n of names){const v=String(process.env[n]||'').trim();if(v)return v;}return '';}
function clampInt(v,f,min,max){const n=parseInt(v||'',10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):f;}
function escapeDriveQuery(v){return String(v||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function buildTextSummary(s){
  return [
    'SIMULAÇÃO — KITS E CILINDROS',
    '',
    'NENHUMA ALTERAÇÃO FOI FEITA NO GOOGLE DRIVE.',
    '',
    `Origem: ${s.source.name} (${s.source.id})`,
    `Destino planejado: ${s.destination.name} (${s.destination.id})`,
    `Pastas lidas: ${s.scannedFolders}`,
    `Pastas componentes identificadas: ${s.matchedComponentFolders}`,
    `Movimentos efetivos simulados: ${s.topLevelComponentMoves}`,
    `Pastas-tema que seriam criadas/reutilizadas: ${s.themeContainers}`,
    `Temas com colisão de nome: ${s.collisionThemes}`,
    `Componentes sem tema: ${s.skippedNoTheme}`,
    `Componentes já cobertos por componente-pai: ${s.coveredByParentComponent}`,
    `Pastas restritas durante leitura: ${s.restrictedParents}`,
    `Tempo: ${s.elapsedSeconds}s`
  ].join('\n')+'\n';
}

function buildHtml(summary,themes,plans,skipped,covered){
  const data=JSON.stringify({summary,themes,plans,skipped,covered}).replace(/<\/script/gi,'<\\/script');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulação Kits e Cilindros</title><style>
  :root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#111;background:#f5f5f5}*{box-sizing:border-box}body{margin:0}header{background:#111;color:white;padding:20px;position:sticky;top:0}h1{margin:0 0 6px;font-size:20px}.warn{font-size:13px;color:#ffd27a}.stats{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.pill{border:1px solid #ffffff35;border-radius:999px;padding:4px 8px;font-size:12px}.bar{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}input,select{padding:10px 12px;border:0;border-radius:8px;font-size:14px}input{min-width:280px;flex:1}main{max-width:1500px;margin:auto;padding:18px}.card{background:#fff;border-radius:12px;padding:14px}.row{padding:11px 5px;border-bottom:1px solid #eee}.row:last-child{border-bottom:0}.dest{font-weight:650;margin-top:4px}.src{font-size:12px;color:#777;margin-top:3px}.collision{color:#a23}.empty{padding:30px;text-align:center;color:#777}</style></head><body>
  <header><h1>SIMULAÇÃO — Kits e Cilindros</h1><div class="warn">Somente leitura. Nenhuma pasta foi criada, movida, renomeada ou excluída.</div><div class="stats">
  <span class="pill">${summary.topLevelComponentMoves} movimentos</span><span class="pill">${summary.themeContainers} temas</span><span class="pill">${summary.collisionThemes} colisões</span><span class="pill">${summary.elapsedSeconds}s</span></div>
  <div class="bar"><input id="q" placeholder="Buscar tema, componente ou caminho..."><select id="status"><option value="">Todos</option><option>SIMULAR_MOVER</option><option>COLISAO_DE_TEMA</option></select></div></header>
  <main><div class="card"><div id="list"></div></div></main><script>
  const DATA=${data};const list=document.getElementById('list'),q=document.getElementById('q'),status=document.getElementById('status');
  function render(){const term=q.value.trim().toLowerCase(),st=status.value;const rows=DATA.plans.filter(p=>(!st||p.status===st)&&(!term||[p.themeName,p.componentName,p.sourcePath,p.destinationComponentPath,p.canonicalType].join(' ').toLowerCase().includes(term)));list.innerHTML='';if(!rows.length){list.innerHTML='<div class="empty">Nenhum item.</div>';return}for(const p of rows){const d=document.createElement('div');d.className='row';const badge=document.createElement('div');badge.className=p.status==='COLISAO_DE_TEMA'?'collision':'';badge.textContent=p.status+' · '+p.canonicalType;const dest=document.createElement('div');dest.className='dest';dest.textContent='→ '+p.destinationComponentPath;const src=document.createElement('div');src.className='src';src.textContent='Origem: '+p.sourcePath;d.append(badge,dest,src);list.appendChild(d)}}q.addEventListener('input',render);status.addEventListener('change',render);render();
  </script></body></html>`;
}
