import { loadConfig, getActiveDrive, getBolinhas } from './_config.js';

const DEFAULT_ROOT_FOLDER_ID = '193kW8g7EsmrNwlGE3ugbC3qzOcDEwUae';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (!url.pathname.startsWith('/api/drive')) return context.next();

  const apiKey = context.env.GOOGLE_API_KEY || context.env.GOOGLE_DRIVE_API_KEY || context.env.DRIVE_API_KEY;
  const { config } = await loadConfig(context.env);
  const mode = String(url.searchParams.get('mode') || 'themes');
  const rawFolderId = String(url.searchParams.get('folderId') || '');

  if (mode === 'products' && rawFolderId.startsWith('collection:')) {
    return json(await collectionProducts(rawFolderId, config, apiKey));
  }

  const response = await context.next();
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers }); }

  try {
    if (data && data.ok !== false) {
      if (mode === 'themes') data = await shapeThemes(data, config);
      if (mode === 'products') data = await shapeProducts(data, config, apiKey, rawFolderId);
      if (mode === 'items') data = await shapeItems(data, config, apiKey, rawFolderId);
      if (mode === 'search') data = shapeSearch(data, config);
    }
  } catch (error) {
    data.editorialWarning = String(error && error.message || error);
  }

  return json(data, response.status);
}

async function shapeThemes(data, config) {
  const s = structure(config);
  const hiddenNames = new Set();
  activeCollections(s).forEach(c => { if (c.hideChildrenFromRoot !== false) children(c).forEach(x => hiddenNames.add(norm(x))); });
  activeTransplants(s).forEach(t => { if (t.hideSource !== false) hiddenNames.add(norm(t.from)); });

  const folders = (data.folders || []).filter(f => !hiddenNames.has(norm(f.rawName || f.name)));
  activeCollections(s).forEach(c => {
    folders.push({ id: 'collection:' + safeId(c.id || c.name), name: c.name, rawName: c.name, label: c.name, kind: 'theme', virtual: true, collection: true, order: Number(c.order || 0) });
  });
  folders.sort((a,b)=>(Number(a.order ?? 9999)-Number(b.order ?? 9999)) || String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{numeric:true}));
  return { ...data, folders };
}

async function collectionProducts(rawId, config, apiKey) {
  const id = rawId.replace(/^collection:/,'');
  const collection = activeCollections(structure(config)).find(c => safeId(c.id || c.name) === id);
  if (!collection) return { ok:true, mode:'products', theme:'', folders:[] };
  const root = await rootThemes(config, apiKey);
  const folders = [];
  children(collection).forEach(name => {
    const f = root.byName.get(norm(name));
    if (f) folders.push({ id:f.id, name:displayName(f.name,config), rawName:f.name, label:displayName(f.name,config), kind:'folder', virtualChild:true, product:'', productName:'' });
  });
  folders.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'pt-BR',{numeric:true}));
  return { ok:true, mode:'products', theme:collection.name, folders, virtualCollection:true, collectionId:id, configVersion:version(config) };
}

async function shapeProducts(data, config, apiKey, folderId) {
  if (!apiKey || !folderId) return data;
  const root = await rootThemes(config, apiKey);
  const current = root.byId.get(folderId);
  if (!current) return data;

  const receivers = activeTransplants(structure(config)).filter(t => norm(t.to) === norm(current.name));
  if (!receivers.length) return data;

  const folders = [...(data.folders || [])];
  const existing = new Set(folders.map(f => f.id));
  const bolinhas = getBolinhas(config);

  for (const rule of receivers) {
    const source = root.byName.get(norm(rule.from));
    if (!source) continue;
    const list = await listChildren(source.id, apiKey);
    if (rule.mode !== 'mergeItems') {
      list.filter(f => f.mimeType === FOLDER_MIME).forEach(f => {
        if (!existing.has(f.id)) {
          existing.add(f.id);
          folders.push({ id:f.id, name:displayName(f.name,config), rawName:f.name, label:displayName(f.name,config), kind:'folder', product:'', productName:'', fromTheme:source.name, transplanted:true });
        }
      });
    }
    if (rule.mode !== 'mergeFolders' && list.some(f => String(f.mimeType||'').startsWith('image/'))) {
      if (!folders.some(f => f.id === current.id && f.kind !== 'folder')) folders.push(makeProduct(current.id, bolinhas));
    }
  }
  return { ...data, folders };
}

async function shapeItems(data, config, apiKey, folderId) {
  if (!apiKey || !folderId) return data;
  const root = await rootThemes(config, apiKey);
  const current = root.byId.get(folderId);
  if (!current) return data;

  const receivers = activeTransplants(structure(config)).filter(t => norm(t.to) === norm(current.name) && t.mode !== 'mergeFolders');
  if (!receivers.length) return data;

  const bolinhas = getBolinhas(config);
  const items = [...(data.items || [])];
  const existing = new Set(items.map(i => i.id));
  const themeLabel = data.theme || displayName(current.name, config);

  for (const rule of receivers) {
    const source = root.byName.get(norm(rule.from));
    if (!source) continue;
    const list = await listChildren(source.id, apiKey);
    list.filter(f => String(f.mimeType||'').startsWith('image/')).forEach(file => {
      if (existing.has(file.id)) return;
      const item = itemFromFile(file, { folderId: source.id, theme: themeLabel, bolinhas, config });
      item.sourceTheme = displayName(source.name, config);
      item.transplanted = true;
      existing.add(file.id);
      items.push(item);
    });
  }
  items.sort((a,b)=>(Number(b.sortId)||0)-(Number(a.sortId)||0));
  return { ...data, items, total: items.length };
}

function shapeSearch(data, config) {
  const rules = activeTransplants(structure(config)).filter(t => t.hideSource !== false);
  if (!rules.length || !Array.isArray(data.items)) return data;
  const items = data.items.map(item => {
    const r = rules.find(t => norm(t.from) === norm(item.theme || item.embeddedTheme));
    if (!r) return item;
    return { ...item, theme: displayName(r.to, config), sourceTheme: item.theme, transplanted: true };
  });
  return { ...data, items };
}

function structure(config){const s=config.catalogStructure||{};return {collections:s.collections||[],transplants:s.transplants||[]};}
function activeCollections(s){return (s.collections||[]).filter(c=>c&&c.active!==false&&c.name);}
function activeTransplants(s){return (s.transplants||[]).filter(t=>t&&t.active!==false&&t.from&&t.to);}
function children(c){return Array.isArray(c.children)?c.children:String(c.children||'').split(/\n|,/).map(x=>x.trim()).filter(Boolean);}
function safeId(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();}
function version(config){return Number(config.ui&&config.ui.cacheVersion||config.version||1);}
function displayName(name,config){const r=findRule(name,config,'theme')||findRule(name,config,'subtheme');return r&&r.displayName?r.displayName:cleanLabel(name);}
function controls(config){return config.catalogControls||{themeOverrides:[],subthemeOverrides:[]};}
function findRule(name,config,type='theme'){const c=controls(config);const list=type==='subtheme'?(c.subthemeOverrides||[]):(c.themeOverrides||[]);const n=norm(name);return list.find(r=>r&&r.match&&norm(r.match)===n)||list.find(r=>r&&r.displayName&&norm(r.displayName)===n)||null;}
function cleanLabel(value){return String(value||'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g,m=>m.toLocaleUpperCase('pt-BR'));}

async function rootThemes(config, apiKey) {
  const drive = getActiveDrive(config,'bolinhas');
  const rootFolderId = sanitizeId(drive&&drive.folderId) || DEFAULT_ROOT_FOLDER_ID;
  const folders = (await listChildren(rootFolderId, apiKey)).filter(f => f.mimeType === FOLDER_MIME);
  return { folders, byName:new Map(folders.map(f=>[norm(f.name),f])), byId:new Map(folders.map(f=>[f.id,f])) };
}

async function listChildren(folderId, apiKey) {
  if (!apiKey) return [];
  const out=[]; let pageToken='';
  do {
    const p=new URLSearchParams({key:apiKey,q:`'${folderId}' in parents and trashed = false`,fields:'nextPageToken, files(id,name,mimeType,webViewLink,modifiedTime,parents)',pageSize:'1000',orderBy:'folder,name_natural'});
    if(pageToken)p.set('pageToken',pageToken);
    const r=await fetch(`${DRIVE_API}?${p.toString()}`,{headers:{Accept:'application/json'}});
    if(!r.ok)throw new Error(`Drive API ${r.status}`);
    const d=await r.json(); out.push(...(d.files||[])); pageToken=d.nextPageToken||'';
  } while(pageToken);
  return out;
}

function makeProduct(folderId, bolinhas){return {id:folderId,name:bolinhas.label,rawName:bolinhas.label,kind:'product',product:bolinhas.productKey,productName:bolinhas.label,label:bolinhas.label,unitPrice:bolinhas.unitPrice,price:bolinhas.unitPrice,priceLabel:bolinhas.priceLabel,minQty:bolinhas.minQty,step:bolinhas.step,directItems:true,skipProductsStep:bolinhas.skipProductsStep,disableCustomization:bolinhas.disableCustomization,customizationDisabled:bolinhas.disableCustomization,allowCustomSize:!bolinhas.disableCustomization,canCustomize:!bolinhas.disableCustomization};}
function itemFromFile(file,{folderId,theme,bolinhas,config}){const parsed=parseArtFilename(file.name);const image=`https://drive.google.com/thumbnail?id=${encodeURIComponent(file.id)}&sz=w1200`;return{id:file.id,code:parsed.code,sortId:Number(parsed.code)||0,theme:displayName(theme||parsed.theme||'Sem tema',config),product:bolinhas.productKey,productName:bolinhas.label,productLabel:bolinhas.label,size:parsed.dimension||'50x50',dimension:parsed.dimension||'50x50',embeddedTheme:parsed.theme,embeddedProduct:parsed.productRaw,originalName:file.name,themeId:'',productFolderId:folderId,image,thumbnail:image,driveUrl:file.webViewLink||`https://drive.google.com/file/d/${file.id}/view`,unitPrice:bolinhas.unitPrice,price:bolinhas.unitPrice,priceLabel:bolinhas.priceLabel,minQty:bolinhas.minQty,step:bolinhas.step,disableCustomization:bolinhas.disableCustomization,customizationDisabled:bolinhas.disableCustomization,allowCustomSize:!bolinhas.disableCustomization,canCustomize:!bolinhas.disableCustomization,measureDisabled:bolinhas.disableCustomization};}
function parseArtFilename(value){const base=String(value||'').replace(/\.[^.]+$/,'').trim();const parts=base.split('_').map(p=>p.trim()).filter(Boolean);const leadingId=base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);const code=leadingId?leadingId[1]:cleanCode(base);return{code,theme:cleanLabel(parts[1]||''),productRaw:cleanLabel(parts[2]||''),dimension:normalizeDimension(parts.slice(3).join(' '))};}
function cleanCode(value){const base=String(value||'').replace(/\.[^.]+$/,'').trim();const leadingId=base.match(/^\s*(\d{1,20})(?:[_\-\s]|$)/);if(leadingId)return leadingId[1];const nums=base.match(/\d+/g);return nums?nums[0]:base.replace(/[^\w-]/g,'').toUpperCase();}
function normalizeDimension(value){const text=String(value||'').trim();if(!text)return'';const compact=text.replace(/\s+/g,'').replace(/×/g,'x').toLowerCase();const sizeMatch=compact.match(/(\d+(?:[\.,]\d+)?)[xX](\d+(?:[\.,]\d+)?)/);if(sizeMatch)return`${sizeMatch[1]}x${sizeMatch[2]}`.replace(/,/g,'.');return cleanLabel(text);}
function sanitizeId(value){const id=String(value||'').trim();return/^[A-Za-z0-9_-]{10,}$/.test(id)?id:'';}
function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff'}});}
