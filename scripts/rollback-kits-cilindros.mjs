#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createAuthenticatedDrive, normalizeName } from './kits-cilindros-drive-auth.mjs';

const DEST_ROOT_ID=process.env.KC_DEST_ROOT_ID||'1eZbQ5wv3-nyzbUirt6k5OoBnlK63Szpt';
const CONTROL_FOLDER='__CONTROLE_NAO_APAGAR';
const RUN_ID=String(process.env.KC_RUN_ID||'').trim();
const CONFIRM=String(process.env.KC_CONFIRM||'').trim();
const REQUIRED_CONFIRM='DESFAZER KITS E CILINDROS';
const OUT_DIR=path.resolve(process.env.KC_OUT_DIR||'kits-cilindros-rollback-result');

if(!RUN_ID){
  console.error('Informe KC_RUN_ID.');
  process.exit(2);
}
if(CONFIRM!==REQUIRED_CONFIRM){
  console.error(`Confirmação inválida. Digite exatamente: ${REQUIRED_CONFIRM}`);
  process.exit(2);
}

await fs.mkdir(OUT_DIR,{recursive:true});
const drive=await createAuthenticatedDrive();
console.log('== DESFAZER Kits e Cilindros ==');
console.log('RUN_ID:',RUN_ID);
console.log('service_account:',drive.serviceAccountEmail);

const destChildren=await drive.listChildren(DEST_ROOT_ID,{foldersOnly:true});
const controls=destChildren.filter(f=>normalizeName(f.name)===normalizeName(CONTROL_FOLDER));
if(controls.length!==1){
  throw new Error(`Esperava exatamente 1 pasta ${CONTROL_FOLDER}; encontrei ${controls.length}.`);
}
const control=controls[0];

const manifestName=`rollback-${RUN_ID}.json`;
const manifests=await drive.listChildren(control.id,{name:manifestName});
if(manifests.length!==1){
  throw new Error(`Esperava exatamente 1 manifesto ${manifestName}; encontrei ${manifests.length}.`);
}
const manifestFile=manifests[0];
const manifest=await drive.downloadJsonFile(manifestFile.id);

if(manifest.runId!==RUN_ID) throw new Error('RUN_ID do manifesto não confere.');
if(manifest.destination?.id!==DEST_ROOT_ID) throw new Error('Destino do manifesto não confere com o destino solicitado.');

manifest.rollback={
  requestedAt:new Date().toISOString(),
  serviceAccountEmail:drive.serviceAccountEmail,
  restored:[],
  alreadyRestored:[],
  conflicts:[],
  errors:[],
  deletedThemeFolders:[],
  retainedThemeFolders:[]
};
manifest.state='ROLLBACK_RUNNING';
await saveAndCheckpoint();

const ops=[...(manifest.operations||[])].reverse();
for(const op of ops){
  try{
    const current=await drive.getFile(op.componentId,'id,name,parents,trashed');
    if(current.trashed){
      manifest.rollback.conflicts.push({
        componentId:op.componentId,
        componentName:op.componentName,
        reason:'ITEM_NA_LIXEIRA'
      });
      continue;
    }

    if(current.parents?.includes(op.originalParentId)){
      op.status='ROLLED_BACK';
      op.rolledBackAt=op.rolledBackAt||new Date().toISOString();
      manifest.rollback.alreadyRestored.push(op.componentId);
      continue;
    }

    if(!current.parents?.includes(op.destinationParentId)){
      manifest.rollback.conflicts.push({
        componentId:op.componentId,
        componentName:op.componentName,
        currentParents:current.parents||[],
        expectedDestinationParentId:op.destinationParentId,
        originalParentId:op.originalParentId,
        reason:'CONFLITO_MANUAL'
      });
      continue;
    }

    await drive.moveFile(op.componentId,op.destinationParentId,op.originalParentId);
    op.status='ROLLED_BACK';
    op.rolledBackAt=new Date().toISOString();
    manifest.rollback.restored.push(op.componentId);
    console.log('RESTAURADO:',op.componentName,'->',op.originalParentPath);
  }catch(error){
    manifest.rollback.errors.push({
      componentId:op.componentId,
      componentName:op.componentName,
      message:String(error?.message||error)
    });
  }
  await saveLocal();
}

for(const theme of [...(manifest.themes||[])].reverse()){
  if(!theme.createdByRun) continue;
  try{
    const children=await drive.listChildren(theme.destinationThemeId);
    if(children.length===0){
      await drive.deleteFile(theme.destinationThemeId);
      manifest.rollback.deletedThemeFolders.push(theme.destinationThemeId);
      console.log('PASTA-TEMA REMOVIDA:',theme.destinationThemeName);
    }else{
      manifest.rollback.retainedThemeFolders.push({
        id:theme.destinationThemeId,
        name:theme.destinationThemeName,
        children:children.length,
        reason:'NAO_ESTA_VAZIA'
      });
    }
  }catch(error){
    manifest.rollback.errors.push({
      themeId:theme.destinationThemeId,
      themeName:theme.destinationThemeName,
      message:String(error?.message||error)
    });
  }
}

manifest.rollback.finishedAt=new Date().toISOString();
manifest.rollback.requests=drive.requests;
manifest.state=(manifest.rollback.conflicts.length||manifest.rollback.errors.length)
  ?'ROLLBACK_WITH_CONFLICTS'
  :'ROLLED_BACK';
manifest.updatedAt=new Date().toISOString();
await saveAndCheckpoint();

console.log('');
console.log('== RESULTADO ==');
console.log('estado:',manifest.state);
console.log('restaurados:',manifest.rollback.restored.length);
console.log('já restaurados:',manifest.rollback.alreadyRestored.length);
console.log('conflitos:',manifest.rollback.conflicts.length);
console.log('erros:',manifest.rollback.errors.length);
console.log('pastas-tema removidas:',manifest.rollback.deletedThemeFolders.length);

if(manifest.state!=='ROLLED_BACK') process.exitCode=1;

async function saveLocal(){
  await fs.writeFile(path.join(OUT_DIR,manifestName),JSON.stringify(manifest,null,2),'utf8');
  await fs.writeFile(path.join(OUT_DIR,'RESUMO.txt'),[
    'DESFAZER — KITS E CILINDROS',
    `RUN_ID: ${RUN_ID}`,
    `Estado: ${manifest.state}`,
    `Restaurados: ${manifest.rollback?.restored?.length||0}`,
    `Já restaurados: ${manifest.rollback?.alreadyRestored?.length||0}`,
    `Conflitos: ${manifest.rollback?.conflicts?.length||0}`,
    `Erros: ${manifest.rollback?.errors?.length||0}`,
    `Pastas-tema removidas: ${manifest.rollback?.deletedThemeFolders?.length||0}`
  ].join('\n')+'\n','utf8');
}

async function saveAndCheckpoint(){
  manifest.updatedAt=new Date().toISOString();
  await saveLocal();
  await drive.updateJsonFile(manifestFile.id,manifest);
}
