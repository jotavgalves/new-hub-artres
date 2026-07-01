import { loadConfig, getActiveDrive, getBolinhas } from "./_config.js";
const DEFAULT_ROOT_FOLDER_ID="193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae";
const DRIVE_API="https://www.googleapis.com/drive/v3/files";
const FOLDER_MIME="application/vnd.google-apps.folder";

export async function onRequestGet(context){
 try{
  const apiKey=context.env.GOOGLE_API_KEY||context.env.GOOGLE_DRIVE_API_KEY||context.env.DRIVE_API_KEY;
  if(!apiKey)return json({ok:false,error:"GOOGLE_API_KEY_NAO_CONFIGURADA"},500);
  const {config}=await loadConfig(context.env); const drive=getActiveDrive(config,"bolinhas"); const bolinhas=getBolinhas(config);
  const rootFolderId=sanitizeId(drive&&drive.folderId)||DEFAULT_ROOT_FOLDER_ID;
  const url=new URL(context.request.url); const mode=String(url.searchParams.get("mode")||"themes");
  const folderId=sanitizeId(url.searchParams.get("folderId"))||rootFolderId;
  const theme=cleanLabel(url.searchParams.get("theme")||"");
  const searchCode=String(url.searchParams.get("code")||"").replace(/\D/g,"").slice(0,20);
  if(mode==="themes"){
   const folders=(await listChildren(folderId,apiKey)).filter(f=>f.mimeType===FOLDER_MIME).map(f=>applyFolderRule({id:f.id,name:cleanLabel(f.name),rawName:f.name,kind:"theme"},config,"theme")).filter(f=>!f.hidden); sortFolders(folders);
   return json({ok:true,mode,folders,configVersion:config.ui&&config.ui.cacheVersion||config.version||1},200,15);
  }
  if(mode==="products"){
   const children=await listChildren(folderId,apiKey);
   const folders=children.filter(f=>f.mimeType===FOLDER_MIME).map(f=>applyFolderRule({id:f.id,name:cleanLabel(f.name),rawName:f.name,kind:"folder",product:"",productName:"",label:cleanLabel(f.name)},config,"subtheme")).filter(f=>!f.hidden); sortFolders(folders);
   if(children.some(f=>String(f.mimeType||"").startsWith("image/")))folders.push(makeBolinhasProduct(folderId,bolinhas));
   return json({ok:true,mode,theme,folders},200,15);
  }
  if(mode==="items"){
   const items=(await listChildren(folderId,apiKey)).filter(f=>String(f.mimeType||"").startsWith("image/")).map(f=>itemFromFile(f,{folderId,theme,bolinhas,config})).filter(i=>i.code&&!isBlockedArt(i.code,config)&&!isHiddenTheme(i.theme,config)).sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
   return json({ok:true,mode,theme:displayTheme(theme,config),product:bolinhas.productKey,productName:bolinhas.label,total:items.length,items},200,15);
  }
  if(mode==="search"){
   if(!searchCode||searchCode.length<2||isBlockedArt(searchCode,config))return json({ok:true,mode,items:[]},200,15);
   const items=await searchByCode(searchCode,apiKey,rootFolderId,bolinhas,config); return json({ok:true,mode,total:items.length,items},200,15);
  }
  if(mode==="folderSearch"){
   const q=cleanLabel(url.searchParams.get("q")||""); if(!q||normalizeText(q).length<2)return json({ok:true,mode,results:[]},200,15);
   const results=await searchFolders(q,apiKey,rootFolderId,config); return json({ok:true,mode,total:results.length,results},200,15);
  }
  return json({ok:false,error:"MODO_INVALIDO"},400);
 }catch(error){return json({ok:false,error:"FALHA_AO_LER_DRIVE",detail:String(error&&error.message||error)},500)}
}
function controls(config){return config.catalogControls||{hiddenArtCodes:[],hiddenThemes:[],themeOverrides:[],subthemeOverrides:[],artBlocks:[]}}
function norm(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[_-]+/g," ").replace(/\s+/g," ").trim()}
function findRule(name,config,type="theme"){const c=controls(config);const list=type==="subtheme"?(c.subthemeOverrides||[]):(c.themeOverrides||[]);const n=norm(name);return list.find(r=>r&&r.match&&norm(r.match)===n)||list.find(r=>r&&r.displayName&&norm(r.displayName)===n)||null}
function isHiddenTheme(name,config){const c=controls(config),n=norm(name);if((c.hiddenThemes||[]).some(x=>norm(x)===n))return true;const r=findRule(name,config,"theme")||findRule(name,config,"subtheme");return !!(r&&r.hidden)}
function displayTheme(name,config){const r=findRule(name,config,"theme")||findRule(name,config,"subtheme");return r&&r.displayName?r.displayName:cleanLabel(name)}
function applyFolderRule(folder,config,type){const rule=findRule(folder.rawName||folder.name,config,type);const hidden=isHiddenTheme(folder.rawName||folder.name,config);return {...folder,name:rule&&rule.displayName?rule.displayName:folder.name,label:rule&&rule.displayName?rule.displayName:(folder.label||folder.name),order:rule&&Number.isFinite(Number(rule.order))?Number(rule.order):9999,hidden}}
function sortFolders(folders){folders.sort((a,b)=>(Number(a.order||9999)-Number(b.order||9999))||a.name.localeCompare(b.name,"pt-BR",{numeric:true}))}
function isBlockedArt(code,config){const c=controls(config),art=String(code||"").replace(/\D/g,"");if(!art)return false;if((c.hiddenArtCodes||[]).map(x=>String(x).replace(/\D/g,"")).includes(art))return true;return (c.artBlocks||[]).some(b=>b&&b.active!==false&&String(b.code||"").replace(/\D/g,"")===art)}
function makeBolinhasProduct(folderId,bolinhas){return{id:folderId,name:bolinhas.label,rawName:bolinhas.label,kind:"product",product:bolinhas.productKey,productName:bolinhas.label,label:bolinhas.label,unitPrice:bolinhas.unitPrice,price:bolinhas.unitPrice,priceLabel:bolinhas.priceLabel,minQty:bolinhas.minQty,step:bolinhas.step,directItems:true,skipProductsStep:bolinhas.skipProductsStep,disableCustomization:bolinhas.disableCustomization,customizationDisabled:bolinhas.disableCustomization,allowCustomSize:!bolinhas.disableCustomization,canCustomize:!bolinhas.disableCustomization}}
async function listChildren(folderId,apiKey){const out=[];let pageToken="";do{const p=new URLSearchParams({key:apiKey,q:`'${folderId}' in parents and trashed = false`,fields:"nextPageToken, files(id,name,mimeType,webViewLink,modifiedTime,parents)",pageSize:"1000",orderBy:"folder,name_natural"});if(pageToken)p.set("pageToken",pageToken);const r=await fetch(`${DRIVE_API}?${p.toString()}`,{headers:{Accept:"application/json"}});if(!r.ok)throw new Error(`Drive API ${r.status}`);const d=await r.json();out.push(...(d.files||[]));pageToken=d.nextPageToken||""}while(pageToken);return out}
async function searchFolders(query,apiKey,rootFolderId,config){const q=String(query||"").replace(/'/g,"\\'").trim();const p=new URLSearchParams({key:apiKey,q:`name contains '${q}' and trashed = false and mimeType = '${FOLDER_MIME}'`,fields:"files(id,name,mimeType,parents)",pageSize:"40",orderBy:"name_natural"});const r=await fetch(`${DRIVE_API}?${p.toString()}`,{headers:{Accept:"application/json"}});if(!r.ok)throw new Error(`Drive API ${r.status}`);const d=await r.json(),out=[];for(const f of(d.files||[])){try{if(isHiddenTheme(f.name,config))continue;const ancestry=await buildAncestry(f.id,apiKey);const rootIndex=ancestry.findIndex(a=>a.id===rootFolderId);if(rootIndex===-1)continue;const belowRoot=ancestry.slice(rootIndex+1);if(!belowRoot.length)continue;const themeFolder=belowRoot[0];if(isHiddenTheme(themeFolder.name,config))continue;out.push({id:f.id,name:displayTheme(f.name,config),rawName:f.name,label:displayTheme(f.name,config),kind:"folder",product:"",productName:"",theme:displayTheme(themeFolder.name,config),themeId:themeFolder.id,trail:belowRoot.slice(1,Math.max(1,belowRoot.length-1)).filter(x=>!isHiddenTheme(x.name,config)).map(x=>({id:x.id,name:displayTheme(x.name,config),kind:"folder"})),path:belowRoot.map(x=>displayTheme(x.name,config)).join(" / ")})}catch(_){}if(out.length>=30)break}return out.sort((a,b)=>a.path.localeCompare(b.path,"pt-BR",{numeric:true}))}
async function searchByCode(code,apiKey,rootFolderId,bolinhas,config){const safe=String(code||"").replace(/[^0-9]/g,"");if(!safe||safe.length<2||isBlockedArt(safe,config))return[];const p=new URLSearchParams({key:apiKey,q:`name contains '${safe}' and trashed = false and mimeType contains 'image/'`,fields:"files(id,name,mimeType,webViewLink,parents)",pageSize:"40",orderBy:"name_natural"});const r=await fetch(`${DRIVE_API}?${p.toString()}`,{headers:{Accept:"application/json"}});if(!r.ok)throw new Error(`Drive API ${r.status}`);const d=await r.json(),out=[];for(const f of(d.files||[])){const parsed=parseArtFilename(f.name),artCode=parsed.code;if(!artCode||!artCode.includes(safe)||isBlockedArt(artCode,config))continue;const parentId=f.parents&&f.parents[0]||"";const ancestry=await buildAncestry(parentId,apiKey);const rootIndex=ancestry.findIndex(a=>a.id===rootFolderId);if(rootIndex===-1)continue;const belowRoot=ancestry.slice(rootIndex+1);if(!belowRoot.length)continue;const themeLabel=parsed.theme||belowRoot.map(x=>cleanLabel(x.name)).join(" / ")||"Sem tema";if(isHiddenTheme(themeLabel,config)||belowRoot.some(x=>isHiddenTheme(x.name,config)))continue;out.push(itemFromFile(f,{folderId:parentId,theme:themeLabel,bolinhas,config}));if(out.length>=24)break}return out.sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0))}
function itemFromFile(file,{folderId,theme,bolinhas,config}){const parsed=parseArtFilename(file.name);const image=`https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1200`;return{id:file.id,code:parsed.code,sortId:Number(parsed.code)||0,theme:displayTheme(parsed.theme||theme||"Sem tema",config),product:bolinhas.productKey,productName:bolinhas.label,productLabel:bolinhas.label,size:parsed.dimension||"50x50",dimension:parsed.dimension||"50x50",embeddedTheme:parsed.theme,embeddedProduct:parsed.productRaw,originalName:file.name,themeId:"",productFolderId:folderId,image,thumbnail:image,driveUrl:file.webViewLink||`https://drive.google.com/file/d/${file.id}/view`,unitPrice:bolinhas.unitPrice,price:bolinhas.unitPrice,priceLabel:bolinhas.priceLabel,minQty:bolinhas.minQty,step:bolinhas.step,disableCustomization:bolinhas.disableCustomization,customizationDisabled:bolinhas.disableCustomization,allowCustomSize:!bolinhas.disableCustomization,canCustomize:!bolinhas.disableCustomization,measureDisabled:bolinhas.disableCustomization}}
function parseArtFilename(value){const base=String(value||"").replace(/\.[^.]+$/,"").trim();const parts=base.split("_").map(p=>p.trim()).filter(Boolean);const leadingId=base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);const code=leadingId?leadingId[1]:cleanCode(base);return{code,theme:cleanLabel(parts[1]||""),productRaw:cleanLabel(parts[2]||""),dimension:normalizeDimension(parts.slice(3).join(" "))}}
async function buildAncestry(startFolderId,apiKey){const ancestry=[];let currentId=startFolderId;const seen=new Set();for(let depth=0;depth<12&&currentId&&!seen.has(currentId);depth++){seen.add(currentId);const file=await getFile(currentId,apiKey);ancestry.unshift(file);currentId=file.parents&&file.parents[0]}return ancestry}
async function getFile(fileId,apiKey){const p=new URLSearchParams({key:apiKey,fields:"id,name,mimeType,parents"});const r=await fetch(`${DRIVE_API}/${encodeURIComponent(fileId)}?${p.toString()}`,{headers:{Accept:"application/json"}});if(!r.ok)throw new Error(`Drive file ${r.status}`);return r.json()}
function cleanCode(value){const base=String(value||"").replace(/\.[^.]+$/,"").trim();const leadingId=base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);if(leadingId)return leadingId[1];const arteMatch=base.match(/(?:arte|art)[^\d]*(\d+)/i);if(arteMatch)return arteMatch[1];const nums=base.match(/\d+/g);return nums?nums[0]:base.replace(/[^\w-]/g,"").toUpperCase()}
function cleanLabel(value){return String(value||"").replace(/[_-]+/g," ").replace(/\s+/g," ").trim().replace(/\b\w/g,m=>m.toLocaleUpperCase("pt-BR"))}
function normalizeDimension(value){const text=String(value||"").trim();if(!text)return"";const compact=text.replace(/\s+/g,"").replace(/×/g,"x").toLowerCase();const sizeMatch=compact.match(/(\d+(?:[\.,]\d+)?)[xX](\d+(?:[\.,]\d+)?)/);if(sizeMatch)return`${sizeMatch[1]}x${sizeMatch[2]}`.replace(/,/g,".");return cleanLabel(text)}
function normalizeText(value){return String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim()}
function sanitizeId(value){const id=String(value||"").trim();return/^[A-Za-z0-9_-]{10,}$/.test(id)?id:""}
function json(payload,status=200,cache=0){return new Response(JSON.stringify(payload),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":cache?`public, max-age=${cache}, s-maxage=${cache}`:"no-store, max-age=0","X-Content-Type-Options":"nosniff"}})}
