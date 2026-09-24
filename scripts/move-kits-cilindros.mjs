#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  createAuthenticatedDrive,
  FOLDER_MIME,
  normalizeName,
  cleanName,
  destinationThemeName,
  isComponentName
} from './kits-cilindros-drive-auth.mjs';

const SOURCE_ROOT_ID=process.env.KC_SOURCE_ROOT_ID||'11cU5yMWafopC0JfMHotRxThpkgbQl-RW';
const SOURCE_ROOT_NAME=process.env.KC_SOURCE_ROOT_NAME||'PAINÉIS DE FESTA';
const DEST_ROOT_ID=process.env.KC_DEST_ROOT_ID||'1eZbQ5wv3-nyzbUirt6k5OoBnlK63Szpt';
const DEST_ROOT_NAME=process.env.KC_DEST_ROOT_NAME||'KITS E CILINDROS (TEMP)';
const CONFIRM=String(process.env.KC_CONFIRM||'').trim();
const REQUIRED_CONFIRM='MOVER KITS E CILINDROS';
const SCAN_CONCURRENCY=10;
const OUT_DIR=path.resolve(process.env.KC_OUT_DIR||'kits-cilindros-move-result');
const RUN_ID=process.env.KC_RUN_ID||`KC-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`;

if(CONFIRM!==REQUIRED_CONFIRM){
  console.error(`Confirmação inválida. Digite exatamente: ${REQUIRED_CONFIRM}`);
  process.exit(2);
}

await fs.mkdir(OUT_DIR,{recursive:true});
const drive=await createAuthenticatedDrive();
const startedAt=Date.now();

console.log('== MOVER Kits e Cilindros ==');
console.log('RUN_ID:',RUN_ID);
console.log('service_account:',drive.serviceAccountEmail);
console.log('origem:',SOURCE_ROOT_ID);
console.log('destino:',DEST_ROOT_ID);
console.log('rollback: metadados appProperties + artifact local');

let manifest={
  schemaVersion:2,
  runId:RUN_ID,
  createdAt:new Date().toISOString(),
  updatedAt:new Date().toISOString(),
  state:'PREPARING',
  rollbackMode:'DRIVE_APP_PROPERTIES',
  source:{id:SOURCE_ROOT_ID,name:SOURCE_ROOT_NAME},
  destination:{id:DEST_ROOT_ID,name:DEST_ROOT_NAME},
  serviceAccountEmail:drive.serviceAccountEmail,
  themes:[],
  operations:[],
  skipped:[],
  conflicts:[],
  stats:{}
};

try{
  const [sourceRoot,destRoot]=await Promise.all([
    drive.getFile(SOURCE_ROOT_ID),
    drive.getFile(DEST_ROOT_ID)
  ]);
  assertFolder(sourceRoot,'origem');
  assertFolder(destRoot,'destino');

  if(destRoot.capabilities?.canAddChildren===false){
    throw new Error('PREFLIGHT: a conta de serviço não pode criar/adicionar itens na pasta destino.');
  }

  console.log('Lendo estrutura autenticada...');
  const {nodes,nodeById}=await scanTree(drive,SOURCE_ROOT_ID);
  console.log('pastas lidas:',nodes.length);

  const componentIds=new Set(nodes.filter(n=>isComponentName(n.name)).map(n=>n.id));
  const topComponents=[];
  const covered=[];

  for(const n of nodes){
    if(!componentIds.has(n.id)) continue;
    let pid=n.parentId;
    let covering=null;
    while(pid&&pid!==SOURCE_ROOT_ID){
      if(componentIds.has(pid)){covering=nodeById.get(pid);break;}
      pid=nodeById.get(pid)?.parentId||null;
    }
    if(covering){
      covered.push({id:n.id,name:n.name,path:n.path,coveredById:covering.id,coveredByPath:covering.path});
    }else{
      topComponents.push(n);
    }
  }

  const candidates=[];
  for(const component of topComponents){
    const theme=nodeById.get(component.parentId);
    if(!theme||theme.id===SOURCE_ROOT_ID){
      manifest.skipped.push({
        status:'SEM_TEMA',
        componentId:component.id,
        componentName:component.name,
        sourcePath:component.path
      });
      continue;
    }
    candidates.push({
      component,
      theme,
      destinationThemeName:destinationThemeName(theme.name)
    });
  }

  const byDestName=new Map();
  for(const c of candidates){
    const key=normalizeName(c.destinationThemeName);
    if(!byDestName.has(key)) byDestName.set(key,new Map());
    byDestName.get(key).set(c.theme.id,c.theme.path);
  }
  const collisions=[...byDestName.entries()].filter(([key,ids])=>ids.size>1&&key!=='UNICORNIO');
  if(collisions.length){
    throw new Error('PREFLIGHT: temas diferentes resultariam no mesmo nome no destino: '+collisions.map(([k])=>k).join(', '));
  }

  const permissionProblems=[];
  for(const c of candidates){
    if(c.component.capabilities?.canEdit===false){
      permissionProblems.push(`sem canEdit: ${c.component.path}`);
    }
    if(c.theme.capabilities?.canRemoveChildren===false){
      permissionProblems.push(`sem canRemoveChildren: ${c.theme.path}`);
    }
  }
  if(permissionProblems.length){
    throw new Error('PREFLIGHT: permissões insuficientes em '+permissionProblems.length+' item(ns). Ex.: '+permissionProblems.slice(0,5).join(' | '));
  }

  const destChildren=await drive.listChildren(DEST_ROOT_ID,{foldersOnly:true});
  const destByNormalized=new Map();
  for(const item of destChildren){
    const key=normalizeName(item.name);
    if(key==='CONTROLE NAO APAGAR') continue;
    if(!destByNormalized.has(key)) destByNormalized.set(key,[]);
    destByNormalized.get(key).push(item);
  }
  for(const [key,items] of destByNormalized){
    if(items.length>1) throw new Error(`PREFLIGHT: existem ${items.length} pastas destino com o mesmo nome normalizado: ${key}`);
  }

  const groups=new Map();
  for(const c of candidates){
    const key=normalizeName(c.destinationThemeName);
    if(!groups.has(key)) groups.set(key,{
      key,
      destinationName:c.destinationThemeName,
      sources:new Map(),
      components:[]
    });
    const g=groups.get(key);
    g.sources.set(c.theme.id,c.theme.path);
    g.components.push(c);
  }

  manifest.stats={
    scannedFolders:nodes.length,
    matchedComponents:componentIds.size,
    plannedMoves:candidates.length,
    destinationThemes:groups.size,
    themesCreated:0,
    themesReused:0,
    skippedNoTheme:manifest.skipped.length,
    coveredByParentComponent:covered.length
  };
  manifest.coveredByParentComponent=covered;
  await saveLocal();

  console.log('Preparando pastas-tema no destino...');
  for(const g of groups.values()){
    let destFolder=null;
    const existing=destByNormalized.get(g.key)||[];
    if(existing.length===1){
      destFolder=existing[0];
      manifest.stats.themesReused++;
    }else if(existing.length===0){
      destFolder=await drive.createFolder(g.destinationName,DEST_ROOT_ID,{
        kcRunId:RUN_ID,
        kcKind:'theme',
        kcState:'CREATED'
      });
      manifest.stats.themesCreated++;
    }else{
      throw new Error(`PREFLIGHT: destino ambíguo para ${g.destinationName}`);
    }

    manifest.themes.push({
      destinationThemeId:destFolder.id,
      destinationThemeName:g.destinationName,
      sourceThemeIds:[...g.sources.keys()],
      sourceThemePaths:[...g.sources.values()],
      createdByRun:existing.length===0,
      components:g.components.length
    });

    for(const c of g.components){
      manifest.operations.push({
        index:manifest.operations.length+1,
        componentId:c.component.id,
        componentName:c.component.name,
        sourcePath:c.component.path,
        originalParentId:c.theme.id,
        originalParentName:c.theme.name,
        originalParentPath:c.theme.path,
        destinationParentId:destFolder.id,
        destinationParentName:g.destinationName,
        destinationPath:`${DEST_ROOT_NAME} / ${g.destinationName} / ${c.component.name}`,
        status:'PENDING',
        movedAt:null,
        rolledBackAt:null,
        error:null
      });
    }
    await saveLocal();
  }

  manifest.state='MOVING';
  await saveLocal();

  console.log('movimentos planejados:',manifest.operations.length);
  console.log('RUN_ID para desfazer:',RUN_ID);

  let moved=0;
  for(const op of manifest.operations){
    const current=await drive.getFile(op.componentId,'id,name,parents,capabilities,appProperties');
    if(current.parents?.includes(op.destinationParentId)){
      op.status='ALREADY_AT_DESTINATION';
      op.movedAt=new Date().toISOString();
      await ensureRollbackMetadata(op,'MOVED');
      continue;
    }
    if(!current.parents?.includes(op.originalParentId)){
      throw new Error(`CONFLITO antes de mover ${op.sourcePath}: pai atual inesperado [${(current.parents||[]).join(',')}]`);
    }

    await ensureRollbackMetadata(op,'PREPARED');
    await drive.moveFile(op.componentId,op.originalParentId,op.destinationParentId);
    op.status='MOVED';
    op.movedAt=new Date().toISOString();
    moved++;

    try{
      await drive.patchAppProperties(op.componentId,{
        kcRunId:RUN_ID,
        kcKind:'component',
        kcOriginalParentId:op.originalParentId,
        kcDestinationParentId:op.destinationParentId,
        kcState:'MOVED'
      });
    }catch(error){
      console.warn('AVISO: pasta movida, mas estado MOVED não pôde ser gravado; PREPARED continua suficiente para rollback:',op.componentName);
    }

    console.log(`[${op.index}/${manifest.operations.length}] OK ${op.sourcePath} -> ${op.destinationPath}`);
    await saveLocal();
  }

  manifest.state='COMPLETED';
  manifest.completedAt=new Date().toISOString();
  manifest.stats.moved=manifest.operations.filter(x=>['MOVED','ALREADY_AT_DESTINATION'].includes(x.status)).length;
  manifest.stats.requests=drive.requests;
  manifest.stats.elapsedSeconds=Math.round((Date.now()-startedAt)/10)/100;
  await saveLocal();

  console.log('');
  console.log('== CONCLUÍDO ==');
  console.log(JSON.stringify(manifest.stats,null,2));
  console.log('RUN_ID para desfazer:',RUN_ID);
}catch(error){
  console.error('[ERRO]',error?.stack||error);
  manifest.state='MOVE_FAILED_ROLLBACK_RUNNING';
  manifest.failure={at:new Date().toISOString(),message:String(error?.message||error)};
  await saveLocal().catch(()=>{});

  const rollback=await automaticRollback();
  manifest.autoRollback=rollback;
  manifest.state=(rollback.conflicts.length||rollback.errors.length)?'AUTO_ROLLBACK_WITH_CONFLICTS':'AUTO_ROLLED_BACK';
  manifest.updatedAt=new Date().toISOString();
  await saveLocal().catch(()=>{});
  process.exitCode=1;
}

async function ensureRollbackMetadata(op,state){
  await drive.patchAppProperties(op.componentId,{
    kcRunId:RUN_ID,
    kcKind:'component',
    kcOriginalParentId:op.originalParentId,
    kcDestinationParentId:op.destinationParentId,
    kcState:state
  });
}

async function clearRollbackMetadata(fileId){
  await drive.patchAppProperties(fileId,{
    kcRunId:null,
    kcKind:null,
    kcOriginalParentId:null,
    kcDestinationParentId:null,
    kcState:null
  });
}

async function scanTree(driveClient,rootId){
  const rootFile=await driveClient.getFile(rootId);
  const root={...rootFile,parentId:null,path:'',depth:0};
  const nodes=[];
  const nodeById=new Map([[rootId,root]]);
  const seen=new Set([rootId]);
  let frontier=[root];

  while(frontier.length){
    const next=[];
    for(let i=0;i<frontier.length;i+=SCAN_CONCURRENCY){
      const batch=frontier.slice(i,i+SCAN_CONCURRENCY);
      const result=await Promise.all(batch.map(async parent=>({
        parent,
        children:await driveClient.listChildren(parent.id,{foldersOnly:true})
      })));
      for(const {parent,children} of result){
        for(const item of children){
          if(seen.has(item.id)) continue;
          seen.add(item.id);
          const node={
            ...item,
            parentId:parent.id,
            path:parent.path?`${parent.path} / ${cleanName(item.name)}`:cleanName(item.name),
            depth:parent.depth+1
          };
          nodes.push(node);nodeById.set(node.id,node);next.push(node);
        }
      }
    }
    frontier=next;
  }
  return {nodes,nodeById};
}

async function automaticRollback(){
  const restored=[];const alreadyOriginal=[];const conflicts=[];const errors=[];const deletedThemes=[];

  let tagged=[];
  try{
    tagged=await drive.listByAppProperty('kcRunId',RUN_ID);
  }catch(error){
    errors.push({stage:'DISCOVER_TAGGED_ITEMS',message:String(error?.message||error)});
  }

  const componentItems=tagged.filter(x=>x.appProperties?.kcKind==='component');
  const themeItems=tagged.filter(x=>x.appProperties?.kcKind==='theme');

  for(const item of componentItems){
    const props=item.appProperties||{};
    const originalParentId=String(props.kcOriginalParentId||'').trim();
    const destinationParentId=String(props.kcDestinationParentId||'').trim();

    if(!originalParentId||!destinationParentId){
      conflicts.push({componentId:item.id,name:item.name,reason:'METADADOS_INCOMPLETOS'});
      continue;
    }

    try{
      const current=await drive.getFile(item.id,'id,name,parents,appProperties');
      if(current.parents?.includes(originalParentId)){
        alreadyOriginal.push(item.id);
        await clearRollbackMetadata(item.id).catch(()=>{});
        const op=manifest.operations.find(x=>x.componentId===item.id);
        if(op){op.status='ROLLED_BACK';op.rolledBackAt=new Date().toISOString();}
        continue;
      }
      if(!current.parents?.includes(destinationParentId)){
        const conflict={componentId:item.id,name:item.name,currentParents:current.parents||[],reason:'CONFLITO_MANUAL'};
        conflicts.push(conflict);manifest.conflicts.push(conflict);continue;
      }

      await drive.moveFile(item.id,destinationParentId,originalParentId);
      restored.push(item.id);
      await clearRollbackMetadata(item.id).catch(()=>{});
      const op=manifest.operations.find(x=>x.componentId===item.id);
      if(op){op.status='ROLLED_BACK';op.rolledBackAt=new Date().toISOString();}
    }catch(error){
      errors.push({componentId:item.id,message:String(error?.message||error)});
    }
  }

  for(const theme of themeItems){
    try{
      const children=await drive.listChildren(theme.id);
      if(children.length===0){
        await drive.deleteFile(theme.id);
        deletedThemes.push(theme.id);
      }
    }catch(error){
      errors.push({themeId:theme.id,message:String(error?.message||error)});
    }
  }

  await saveLocal().catch(()=>{});
  return {
    discoveredTaggedItems:tagged.length,
    restored,
    alreadyOriginal,
    conflicts,
    errors,
    deletedThemes,
    finishedAt:new Date().toISOString()
  };
}

async function saveLocal(){
  manifest.updatedAt=new Date().toISOString();
  await fs.writeFile(path.join(OUT_DIR,`rollback-${RUN_ID}.json`),JSON.stringify(manifest,null,2),'utf8');
  await fs.writeFile(path.join(OUT_DIR,'RUN_ID.txt'),RUN_ID+'\n','utf8');
  await fs.writeFile(path.join(OUT_DIR,'RESUMO.txt'),summaryText(),'utf8');
}

function summaryText(){
  return [
    'KITS E CILINDROS — MOVIMENTAÇÃO',
    `RUN_ID: ${RUN_ID}`,
    `Estado: ${manifest.state}`,
    `Rollback: metadados internos das próprias pastas + artifact GitHub`,
    `Origem: ${SOURCE_ROOT_NAME} (${SOURCE_ROOT_ID})`,
    `Destino: ${DEST_ROOT_NAME} (${DEST_ROOT_ID})`,
    `Movimentos planejados: ${manifest.operations.length}`,
    `Movidos: ${manifest.operations.filter(x=>x.status==='MOVED').length}`,
    `Restaurados: ${manifest.operations.filter(x=>x.status==='ROLLED_BACK').length}`,
    `Conflitos: ${manifest.conflicts.length}`
  ].join('\n')+'\n';
}

function assertFolder(file,label){
  if(!file||file.mimeType!==FOLDER_MIME) throw new Error(`PREFLIGHT: ${label} não é uma pasta do Google Drive.`);
  if(file.trashed) throw new Error(`PREFLIGHT: pasta ${label} está na lixeira.`);
}
