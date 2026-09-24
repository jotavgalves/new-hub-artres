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
const CONTROL_FOLDER='__CONTROLE_NAO_APAGAR';
const SCAN_CONCURRENCY=10;
const CHECKPOINT_EVERY=10;
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

let manifest={
  schemaVersion:1,
  runId:RUN_ID,
  createdAt:new Date().toISOString(),
  updatedAt:new Date().toISOString(),
  state:'PREPARING',
  source:{id:SOURCE_ROOT_ID,name:SOURCE_ROOT_NAME},
  destination:{id:DEST_ROOT_ID,name:DEST_ROOT_NAME},
  control:{folderName:CONTROL_FOLDER,folderId:null,manifestFileId:null,manifestFileName:`rollback-${RUN_ID}.json`},
  serviceAccountEmail:drive.serviceAccountEmail,
  themes:[],
  operations:[],
  skipped:[],
  conflicts:[],
  stats:{}
};

let controlFolder=null;
let remoteManifestFile=null;
let createdThemeFolders=[];

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
    throw new Error('PREFLIGHT: existem temas diferentes que resultariam no mesmo nome no destino: '+collisions.map(([k])=>k).join(', '));
  }

  // Permissões explícitas são verificadas antes de alterar o Drive.
  const permissionProblems=[];
  for(const c of candidates){
    if(c.component.capabilities?.canEdit===false){
      permissionProblems.push(`sem canEdit: ${c.component.path}`);
    }
    if(c.theme.capabilities?.canRemoveChildren===false){
      permissionProblems.push(`sem canRemoveChildren no tema: ${c.theme.path}`);
    }
  }
  if(permissionProblems.length){
    throw new Error('PREFLIGHT: permissões insuficientes em '+permissionProblems.length+' item(ns). Ex.: '+permissionProblems.slice(0,5).join(' | '));
  }

  const destChildren=await drive.listChildren(DEST_ROOT_ID,{foldersOnly:true});
  const destByNormalized=new Map();
  for(const f of destChildren){
    const key=normalizeName(f.name);
    if(!destByNormalized.has(key)) destByNormalized.set(key,[]);
    destByNormalized.get(key).push(f);
  }

  for(const [key,items] of destByNormalized){
    if(items.length>1 && key!==normalizeName(CONTROL_FOLDER)){
      throw new Error(`PREFLIGHT: existem ${items.length} pastas no destino com o mesmo nome normalizado: ${key}`);
    }
  }

  // A pasta de controle é criada antes de qualquer componente ser movido.
  const controls=destByNormalized.get(normalizeName(CONTROL_FOLDER))||[];
  if(controls.length>1) throw new Error('PREFLIGHT: mais de uma pasta __CONTROLE_NAO_APAGAR no destino.');
  if(controls.length===1){
    controlFolder=controls[0];
  }else{
    controlFolder=await drive.createFolder(CONTROL_FOLDER,DEST_ROOT_ID);
    console.log('pasta de controle criada:',controlFolder.id);
  }
  manifest.control.folderId=controlFolder.id;

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

  // Cria/reutiliza containers dos temas, sem mover componentes ainda.
  for(const g of groups.values()){
    let destFolder=null;
    const existing=destByNormalized.get(g.key)||[];
    if(existing.length===1){
      destFolder=existing[0];
    }else if(existing.length===0){
      destFolder=await drive.createFolder(g.destinationName,DEST_ROOT_ID);
      createdThemeFolders.push(destFolder.id);
    }else{
      throw new Error(`PREFLIGHT: destino ambíguo para ${g.destinationName}`);
    }

    manifest.themes.push({
      destinationThemeId:destFolder.id,
      destinationThemeName:g.destinationName,
      sourceThemeIds:[...g.sources.keys()],
      sourceThemePaths:[...g.sources.values()],
      createdByRun:createdThemeFolders.includes(destFolder.id),
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
  }

  manifest.stats={
    scannedFolders:nodes.length,
    matchedComponents:componentIds.size,
    plannedMoves:manifest.operations.length,
    destinationThemes:manifest.themes.length,
    themesCreated:createdThemeFolders.length,
    themesReused:manifest.themes.length-createdThemeFolders.length,
    skippedNoTheme:manifest.skipped.length,
    coveredByParentComponent:covered.length
  };
  manifest.coveredByParentComponent=covered;
  manifest.state='READY';
  await saveLocal();

  // Salva o plano completo no Drive ANTES do primeiro move.
  remoteManifestFile=await drive.uploadJsonFile(manifest.control.manifestFileName,controlFolder.id,manifest);
  manifest.control.manifestFileId=remoteManifestFile.id;
  manifest.state='MOVING';
  await checkpoint(true);

  console.log('manifesto de rollback:',remoteManifestFile.id);
  console.log('movimentos planejados:',manifest.operations.length);

  let moved=0;
  for(const op of manifest.operations){
    const current=await drive.getFile(op.componentId,'id,name,parents,capabilities');
    if(current.parents?.includes(op.destinationParentId)){
      op.status='ALREADY_AT_DESTINATION';
      op.movedAt=new Date().toISOString();
      continue;
    }
    if(!current.parents?.includes(op.originalParentId)){
      throw new Error(`CONFLITO antes de mover ${op.sourcePath}: pai atual inesperado [${(current.parents||[]).join(',')}]`);
    }

    await drive.moveFile(op.componentId,op.originalParentId,op.destinationParentId);
    op.status='MOVED';
    op.movedAt=new Date().toISOString();
    moved++;
    console.log(`[${op.index}/${manifest.operations.length}] OK ${op.sourcePath} -> ${op.destinationPath}`);

    await saveLocal();
    if(moved%CHECKPOINT_EVERY===0) await checkpoint(false);
  }

  manifest.state='COMPLETED';
  manifest.completedAt=new Date().toISOString();
  manifest.stats.moved=manifest.operations.filter(x=>['MOVED','ALREADY_AT_DESTINATION'].includes(x.status)).length;
  manifest.stats.requests=drive.requests;
  manifest.stats.elapsedSeconds=Math.round((Date.now()-startedAt)/10)/100;
  await checkpoint(true);

  console.log('');
  console.log('== CONCLUÍDO ==');
  console.log(JSON.stringify(manifest.stats,null,2));
  console.log('RUN_ID para desfazer:',RUN_ID);
}catch(error){
  console.error('[ERRO]',error?.stack||error);
  manifest.state='MOVE_FAILED_ROLLBACK_RUNNING';
  manifest.failure={at:new Date().toISOString(),message:String(error?.message||error)};
  await checkpointBestEffort();

  const rollback=await automaticRollback();
  manifest.autoRollback=rollback;
  manifest.state=rollback.conflicts.length?'AUTO_ROLLBACK_WITH_CONFLICTS':'AUTO_ROLLED_BACK';
  manifest.updatedAt=new Date().toISOString();
  await checkpointBestEffort();
  process.exitCode=1;
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
        for(const f of children){
          if(seen.has(f.id)) continue;
          seen.add(f.id);
          const node={
            ...f,
            parentId:parent.id,
            path:parent.path?`${parent.path} / ${cleanName(f.name)}`:cleanName(f.name),
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
  const restored=[];const conflicts=[];const errors=[];
  const movedOps=manifest.operations.filter(x=>['MOVED','ALREADY_AT_DESTINATION'].includes(x.status)).reverse();

  for(const op of movedOps){
    try{
      const current=await drive.getFile(op.componentId,'id,name,parents');
      if(current.parents?.includes(op.originalParentId)){
        op.status='ROLLED_BACK';
        op.rolledBackAt=new Date().toISOString();
        restored.push(op.componentId);
        continue;
      }
      if(!current.parents?.includes(op.destinationParentId)){
        const item={componentId:op.componentId,name:op.componentName,currentParents:current.parents||[],reason:'CONFLITO_MANUAL'};
        conflicts.push(item);manifest.conflicts.push(item);continue;
      }
      await drive.moveFile(op.componentId,op.destinationParentId,op.originalParentId);
      op.status='ROLLED_BACK';
      op.rolledBackAt=new Date().toISOString();
      restored.push(op.componentId);
    }catch(e){
      errors.push({componentId:op.componentId,message:String(e?.message||e)});
    }
  }

  const deletedThemes=[];
  for(const theme of [...manifest.themes].reverse()){
    if(!theme.createdByRun) continue;
    try{
      const children=await drive.listChildren(theme.destinationThemeId);
      if(children.length===0){
        await drive.deleteFile(theme.destinationThemeId);
        deletedThemes.push(theme.destinationThemeId);
      }
    }catch(e){errors.push({themeId:theme.destinationThemeId,message:String(e?.message||e)});}
  }
  await saveLocal();
  return {restored,conflicts,errors,deletedThemes,finishedAt:new Date().toISOString()};
}

async function saveLocal(){
  manifest.updatedAt=new Date().toISOString();
  await fs.writeFile(path.join(OUT_DIR,`rollback-${RUN_ID}.json`),JSON.stringify(manifest,null,2),'utf8');
  await fs.writeFile(path.join(OUT_DIR,'RUN_ID.txt'),RUN_ID+'\n','utf8');
  await fs.writeFile(path.join(OUT_DIR,'RESUMO.txt'),summaryText(),'utf8');
}

async function checkpoint(force){
  await saveLocal();
  if(remoteManifestFile?.id){
    await drive.updateJsonFile(remoteManifestFile.id,manifest);
    if(force) console.log('checkpoint remoto salvo:',manifest.state);
  }
}

async function checkpointBestEffort(){
  try{await checkpoint(true);}catch(e){
    console.error('[AVISO] falha ao salvar checkpoint remoto:',e?.message||e);
    try{await saveLocal();}catch{}
  }
}

function summaryText(){
  return [
    'KITS E CILINDROS — MOVIMENTAÇÃO',
    `RUN_ID: ${RUN_ID}`,
    `Estado: ${manifest.state}`,
    `Origem: ${SOURCE_ROOT_NAME} (${SOURCE_ROOT_ID})`,
    `Destino: ${DEST_ROOT_NAME} (${DEST_ROOT_ID})`,
    `Movimentos planejados: ${manifest.operations.length}`,
    `Movidos: ${manifest.operations.filter(x=>x.status==='MOVED').length}`,
    `Restaurados: ${manifest.operations.filter(x=>x.status==='ROLLED_BACK').length}`,
    `Conflitos: ${manifest.conflicts.length}`,
    `Manifesto Drive: ${manifest.control.manifestFileId||'ainda não criado'}`
  ].join('\n')+'\n';
}

function assertFolder(file,label){
  if(!file||file.mimeType!==FOLDER_MIME) throw new Error(`PREFLIGHT: ${label} não é uma pasta do Google Drive.`);
  if(file.trashed) throw new Error(`PREFLIGHT: pasta ${label} está na lixeira.`);
}
