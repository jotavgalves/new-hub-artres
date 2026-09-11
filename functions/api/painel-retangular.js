import { loadConfig } from './_config.js';
import { baseIndexParams, dedupeRows, readIndex } from './_catalog_index.js';

const ROOT_FOLDER_ID = '1r4BdVOZasdtlE16K7TKIVkHCfVSHLRML';
const PRODUCT_KEY = 'retangular-1x2';
const DEFAULT_LABEL = 'Painel Retangular';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const MAX_DEPTH = 10;
const MAX_FOLDERS = 800;
const MAX_ARTWORKS = 5000;
const INDEX_PAGE_SIZE = 500;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const mode = clean(url.searchParams.get('mode') || 'items');
    const theme = clean(url.searchParams.get('theme') || '');
    const query = clean(url.searchParams.get('q') || url.searchParams.get('code') || '');
    const { config } = await loadConfig(context.env);
    const commercial = rectangularProduct(config);

    let source = 'catalog_index';
    let catalog = await scanIndexed(context.env).catch(error => {
      console.warn('PAINEL_RETANGULAR_INDEX_FAILED', String(error && error.message || error));
      return { artworks:[], themeFolders:[] };
    });

    if (!catalog.artworks.length) {
      const apiKey = driveApiKey(context.env);
      if (!apiKey) return json({ ok:false, error:'PAINEL_RETANGULAR_SEM_INDICE_E_SEM_GOOGLE_DRIVE_API_KEY' }, 503);
      catalog = await scanDrive(apiKey);
      source = 'google-drive-live';
    }

    if (mode === 'themes') {
      const folders = uniqueThemes(catalog).map(t => ({
        id:`retangular-1x2-theme:${t.id}`,
        driveFolderId:t.id,
        name:t.name,
        theme:t.name,
        kind:'theme',
        product:PRODUCT_KEY,
        productKey:PRODUCT_KEY,
        productName:commercial.label,
        synthetic:!!t.synthetic
      }));
      return json({ ok:true, mode, source, rootFolderId:ROOT_FOLDER_ID, folders, total:folders.length, artworkTotal:catalog.artworks.length, product:commercial });
    }

    if (mode === 'search') {
      const wanted = norm(query);
      const digits = query.replace(/\D/g, '');
      const items = catalog.artworks.filter(row => {
        if (!wanted && !digits) return false;
        if (digits && String(row.code || '') === digits) return true;
        return norm([row.code,row.name,row.theme,row.path].filter(Boolean).join(' ')).includes(wanted);
      }).map(row => asItem(row, commercial)).sort(sortItems).slice(0, 100);
      return json({ ok:true, mode, source, rootFolderId:ROOT_FOLDER_ID, total:items.length, items, product:commercial });
    }

    if (mode === 'has-theme') {
      const available = catalog.artworks.some(row => themeMatches(row, theme));
      return json({ ok:true, mode, source, rootFolderId:ROOT_FOLDER_ID, theme, available, product:commercial });
    }

    if (mode === 'items') {
      const items = catalog.artworks.filter(row => !theme || themeMatches(row, theme)).map(row => asItem(row, commercial)).sort(sortItems);
      return json({ ok:true, mode, source, rootFolderId:ROOT_FOLDER_ID, theme, product:PRODUCT_KEY, productName:commercial.label, size:'1X2', sizeKey:'100x200', total:items.length, items });
    }

    return json({ ok:false, error:'MODO_INVALIDO' }, 400);
  } catch (error) {
    return json({ ok:false, error:'FALHA_AO_LER_PAINEL_RETANGULAR', detail:String(error && error.message || error || '').slice(0,240) }, 500);
  }
}

async function scanIndexed(env) {
  const rows = [];
  for (let offset = 0; offset < MAX_ARTWORKS; offset += INDEX_PAGE_SIZE) {
    const params = baseIndexParams(INDEX_PAGE_SIZE);
    params.set('type','eq.artwork');
    params.set('root_drive_id','eq.' + ROOT_FOLDER_ID);
    params.set('offset',String(offset));
    const batch = await readIndex(env, params);
    rows.push(...batch);
    if (batch.length < INDEX_PAGE_SIZE) break;
  }
  return { artworks:dedupeRows(rows).map(indexRowToArtwork).filter(Boolean), themeFolders:[] };
}

function indexRowToArtwork(row) {
  const id = String(row && row.drive_id || '');
  if (!id) return null;
  const name = clean(row.name || 'Sem nome');
  const pathParts = Array.isArray(row.path_parts) ? row.path_parts.map(clean).filter(Boolean) : pathPartsFromPath(row.path, name);
  const theme = clean(row.theme || pathParts[0] || '');
  return {
    id,
    name,
    code:clean(row.code || '') || extractArtworkCode(name),
    theme,
    themeFolderId:'',
    parentFolderId:String(row.parent_drive_id || ''),
    pathParts,
    path:clean(row.path || pathParts.concat(name).join(' / ')),
    image:clean(row.thumbnail_url || '') || `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200`,
    driveUrl:clean(row.drive_url || '') || `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`
  };
}

function pathPartsFromPath(path, fileName) {
  const parts = String(path || '').split(' / ').map(clean).filter(Boolean);
  if (parts.length && clean(parts[parts.length - 1]) === clean(fileName)) parts.pop();
  return parts;
}

async function scanDrive(apiKey) {
  const queue=[{id:ROOT_FOLDER_ID,pathParts:[],depth:0,themeFolderId:''}];
  const artworks=[];
  const themeFolders=[];
  const seen=new Set();
  let visited=0;
  while(queue.length && visited<MAX_FOLDERS && artworks.length<MAX_ARTWORKS){
    const current=queue.shift();
    if(!current || seen.has(current.id)) continue;
    seen.add(current.id); visited++;
    const children=await listChildren(apiKey,current.id);
    for(const file of children){
      const mime=String(file&&file.mimeType||'');
      if(mime==='application/vnd.google-apps.folder'){
        if(current.depth>=MAX_DEPTH) continue;
        const folderName=clean(file.name||'');
        const nextPath=current.pathParts.concat(folderName).filter(Boolean);
        const themeFolderId=current.depth===0?String(file.id||''):current.themeFolderId;
        if(current.depth===0&&folderName) themeFolders.push({id:String(file.id||''),name:folderName});
        queue.push({id:String(file.id||''),pathParts:nextPath,depth:current.depth+1,themeFolderId});
        continue;
      }
      if(!mime.startsWith('image/')) continue;
      const id=String(file.id||'');
      const name=clean(file.name||'Sem nome');
      artworks.push({id,name,code:extractArtworkCode(name),theme:current.pathParts[0]||'',themeFolderId:current.themeFolderId||'',parentFolderId:current.id,pathParts:current.pathParts.slice(),path:current.pathParts.concat(name).join(' / '),image:id?`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1200`:'',driveUrl:id?`https://drive.google.com/file/d/${encodeURIComponent(id)}/view`:''});
      if(artworks.length>=MAX_ARTWORKS) break;
    }
  }
  return {artworks,themeFolders};
}

async function listChildren(apiKey,folderId){
  const files=[]; let pageToken='';
  do{
    const url=new URL(DRIVE_API);
    url.searchParams.set('key',apiKey);
    url.searchParams.set('q',`'${escapeDriveQuery(folderId)}' in parents and trashed = false`);
    url.searchParams.set('fields','nextPageToken,files(id,name,mimeType,parents,fileExtension,modifiedTime)');
    url.searchParams.set('pageSize','1000');
    url.searchParams.set('supportsAllDrives','true');
    url.searchParams.set('includeItemsFromAllDrives','true');
    if(pageToken) url.searchParams.set('pageToken',pageToken);
    const response=await fetch(url.toString(),{headers:{Accept:'application/json'}});
    if(!response.ok) throw new Error(`GOOGLE_DRIVE_${response.status}`);
    const data=await response.json(); files.push(...(Array.isArray(data.files)?data.files:[])); pageToken=String(data.nextPageToken||'');
  }while(pageToken);
  return files;
}

function rectangularProduct(config){
  const products=config&&config.products&&typeof config.products==='object'?config.products:{};
  const raw=products.retangular1x2||products[PRODUCT_KEY]||{};
  const unitPrice=number(raw.unitPrice,0);
  return {key:PRODUCT_KEY,label:clean(raw.label||DEFAULT_LABEL)||DEFAULT_LABEL,enabled:raw.enabled!==false&&unitPrice>0,unitPrice,minQty:positive(raw.minQty||raw.minimum,1),step:positive(raw.step,1),initialQty:positive(raw.initialQty||raw.initial,1),catalogReady:true,size:'1X2',sizeKey:'100x200',rootFolderId:ROOT_FOLDER_ID};
}

function asItem(row,commercial){
  return {id:row.id,driveFileId:row.id,code:row.code||row.id,sortId:Number(row.code)||0,theme:row.theme||'Sem tema',themeId:row.themeFolderId||'',product:PRODUCT_KEY,productKey:PRODUCT_KEY,productName:commercial.label,productLabel:commercial.label,productFolderId:`retangular-1x2:${row.themeFolderId||norm(row.theme||'sem-tema')}`,size:'1X2',sizeKey:'100x200',image:row.image,driveUrl:row.driveUrl,name:row.name,path:row.path,details:{size:'1X2',sizeKey:'100x200',width:100,height:200,unit:'cm',fixed:true}};
}

function uniqueThemes(catalog){
  const map=new Map();
  for(const folder of catalog.themeFolders||[]){const key=norm(folder.name);if(key&&!map.has(key))map.set(key,{id:folder.id,name:folder.name,synthetic:false});}
  for(const row of catalog.artworks||[]){const name=clean(row.theme||'');const key=norm(name);if(key&&!map.has(key))map.set(key,{id:row.themeFolderId||`derived-${key}`,name,synthetic:!row.themeFolderId});}
  if(!map.size&&Array.isArray(catalog.artworks)&&catalog.artworks.length)map.set('__all__',{id:ROOT_FOLDER_ID,name:'Todos os Retangulares',synthetic:true});
  return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true}));
}

function themeMatches(row,wantedTheme){
  const wanted=norm(wantedTheme); if(!wanted)return true;
  if(['todos os retangulares','todos','painel retangular','painel retangular 1x2'].includes(wanted))return true;
  const candidates=[row.theme,...(row.pathParts||[])].map(norm).filter(Boolean);
  return candidates.some(value=>value===wanted||value.includes(wanted)||wanted.includes(value));
}
function sortItems(a,b){return (Number(b.sortId)||0)-(Number(a.sortId)||0)||String(a.code).localeCompare(String(b.code),'pt-BR',{numeric:true});}
function extractArtworkCode(name){const base=clean(name).replace(/\.[a-z0-9]{2,5}$/i,'');const match=base.match(/(?:^|[^0-9])#?([0-9]{2,7})(?:[^0-9]|$)/);return match?match[1]:'';}
function driveApiKey(env){return String(env&&(env.GOOGLE_API_KEY||env.GOOGLE_DRIVE_API_KEY||env.DRIVE_API_KEY)||'').trim();}
function escapeDriveQuery(value){return String(value||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function clean(value){return String(value==null?'':value).replace(/\s+/g,' ').trim();}
function norm(value){return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();}
function number(value,fallback){const parsed=Number(String(value==null?'':value).replace(',','.'));return Number.isFinite(parsed)&&parsed>=0?Math.round(parsed*100)/100:fallback;}
function positive(value,fallback){const parsed=Number.parseInt(value,10);return Number.isFinite(parsed)&&parsed>0?parsed:fallback;}
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'}});}
