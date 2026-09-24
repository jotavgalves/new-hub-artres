#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createAuthenticatedDrive } from './kits-cilindros-drive-auth.mjs';

const RUN_ID=String(process.env.KC_RUN_ID||'').trim();
const CONFIRM=String(process.env.KC_CONFIRM||'').trim();
const REQUIRED_CONFIRM='DESFAZER KITS E CILINDROS';
const OUT_DIR=path.resolve(process.env.KC_OUT_DIR||'kits-cilindros-rollback-result');

if(!RUN_ID){
  console.error('Informe KC_RUN_ID.');
  process.exit(2);
}
if(!/^KC-[0-9]{14}$/.test(RUN_ID)){
  console.error('RUN_ID inválido. Formato esperado: KC-YYYYMMDDHHMMSS');
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
console.log('fonte do rollback: appProperties das próprias pastas');

const tagged=await drive.listByAppProperty('kcRunId',RUN_ID);
const components=tagged.filter(x=>x.appProperties?.kcKind==='component');
const themes=tagged.filter(x=>x.appProperties?.kcKind==='theme');

const report={
  schemaVersion:2,
  runId:RUN_ID,
  startedAt:new Date().toISOString(),
  state:'ROLLBACK_RUNNING',
  serviceAccountEmail:drive.serviceAccountEmail,
  discovered:{
    taggedItems:tagged.length,
    components:components.length,
    themes:themes.length
  },
  restored:[],
  alreadyRestored:[],
  conflicts:[],
  errors:[],
  deletedThemeFolders:[],
  retainedThemeFolders:[]
};

if(!components.length && !themes.length){
  throw new Error('Nenhum item com este RUN_ID foi encontrado. Verifique se o RUN_ID está correto ou se o rollback já foi concluído.');
}

for(const item of components){
  const props=item.appProperties||{};
  const originalParentId=String(props.kcOriginalParentId||'').trim();
  const destinationParentId=String(props.kcDestinationParentId||'').trim();

  if(!originalParentId||!destinationParentId){
    report.conflicts.push({
      componentId:item.id,
      componentName:item.name,
      reason:'METADADOS_DE_ROLLBACK_INCOMPLETOS',
      appProperties:props
    });
    continue;
  }

  try{
    const current=await drive.getFile(item.id,'id,name,parents,trashed,appProperties');
    if(current.trashed){
      report.conflicts.push({
        componentId:item.id,
        componentName:item.name,
        reason:'ITEM_NA_LIXEIRA'
      });
      continue;
    }

    if(current.parents?.includes(originalParentId)){
      report.alreadyRestored.push(item.id);
      await clearRollbackMetadata(item.id).catch(()=>{});
      continue;
    }

    if(!current.parents?.includes(destinationParentId)){
      report.conflicts.push({
        componentId:item.id,
        componentName:item.name,
        currentParents:current.parents||[],
        expectedDestinationParentId:destinationParentId,
        originalParentId,
        reason:'CONFLITO_MANUAL'
      });
      continue;
    }

    await drive.moveFile(item.id,destinationParentId,originalParentId);
    report.restored.push(item.id);
    await clearRollbackMetadata(item.id).catch(()=>{});
    console.log('RESTAURADO:',item.name,'->',originalParentId);
  }catch(error){
    report.errors.push({
      componentId:item.id,
      componentName:item.name,
      message:String(error?.message||error)
    });
  }
  await save();
}

for(const theme of themes){
  try{
    const children=await drive.listChildren(theme.id);
    if(children.length===0){
      await drive.deleteFile(theme.id);
      report.deletedThemeFolders.push(theme.id);
      console.log('PASTA-TEMA REMOVIDA:',theme.name);
    }else{
      report.retainedThemeFolders.push({
        id:theme.id,
        name:theme.name,
        children:children.length,
        reason:'NAO_ESTA_VAZIA'
      });
    }
  }catch(error){
    report.errors.push({
      themeId:theme.id,
      themeName:theme.name,
      message:String(error?.message||error)
    });
  }
  await save();
}

report.finishedAt=new Date().toISOString();
report.requests=drive.requests;
report.state=(report.conflicts.length||report.errors.length)
  ?'ROLLBACK_WITH_CONFLICTS'
  :'ROLLED_BACK';
await save();

console.log('');
console.log('== RESULTADO ==');
console.log('estado:',report.state);
console.log('componentes encontrados:',components.length);
console.log('restaurados agora:',report.restored.length);
console.log('já estavam restaurados:',report.alreadyRestored.length);
console.log('conflitos:',report.conflicts.length);
console.log('erros:',report.errors.length);
console.log('pastas-tema removidas:',report.deletedThemeFolders.length);

if(report.state!=='ROLLED_BACK') process.exitCode=1;

async function clearRollbackMetadata(fileId){
  await drive.patchAppProperties(fileId,{
    kcRunId:null,
    kcKind:null,
    kcOriginalParentId:null,
    kcDestinationParentId:null,
    kcState:null
  });
}

async function save(){
  report.updatedAt=new Date().toISOString();
  await fs.writeFile(path.join(OUT_DIR,`rollback-${RUN_ID}.json`),JSON.stringify(report,null,2),'utf8');
  await fs.writeFile(path.join(OUT_DIR,'RESUMO.txt'),[
    'DESFAZER — KITS E CILINDROS',
    `RUN_ID: ${RUN_ID}`,
    `Estado: ${report.state}`,
    `Itens marcados encontrados: ${report.discovered.taggedItems}`,
    `Componentes: ${report.discovered.components}`,
    `Pastas-tema: ${report.discovered.themes}`,
    `Restaurados agora: ${report.restored.length}`,
    `Já restaurados: ${report.alreadyRestored.length}`,
    `Conflitos: ${report.conflicts.length}`,
    `Erros: ${report.errors.length}`,
    `Pastas-tema removidas: ${report.deletedThemeFolders.length}`
  ].join('\n')+'\n','utf8');
}
