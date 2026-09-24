#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  createAuthenticatedDrive,
  normalizeName,
  cleanName,
  isComponentName
} from './kits-cilindros-drive-auth.mjs';

const SOURCE_ROOT_ID=process.env.KC_SOURCE_ROOT_ID||'11cU5yMWafopC0JfMHotRxThpkgbQl-RW';
const DEST_ROOT_ID=process.env.KC_DEST_ROOT_ID||'1eZbQ5wv3-nyzbUirt6k5OoBnlK63Szpt';
const RUN_ID=process.env.KC_RUN_ID||'KC-20260924191337';
const CONTROL_NAME='__CONTROLE_NAO_APAGAR';
const OUT_DIR=path.resolve(process.env.KC_VERIFY_OUT_DIR||'kits-cilindros-verification');
const CONCURRENCY=10;

await fs.mkdir(OUT_DIR,{recursive:true});
const drive=await createAuthenticatedDrive();

console.log('== VERIFICAÇÃO Kits e Cilindros ==');
console.log('RUN_ID:',RUN_ID);

const sourceScan=await scanTree(SOURCE_ROOT_ID);
const sourceComponents=sourceScan.nodes.filter(n=>isComponentName(n.name));
const sourceRemainingNested=[];
const sourceRemainingTop=[];

for(const n of sourceComponents){
  if(n.parentId===SOURCE_ROOT_ID) sourceRemainingTop.push(n);
  else sourceRemainingNested.push(n);
}

const destDirect=await drive.listChildren(DEST_ROOT_ID,{foldersOnly:true});
const themeFolders=destDirect.filter(f=>normalizeName(f.name)!==normalizeName(CONTROL_NAME));
const controlFolders=destDirect.filter(f=>normalizeName(f.name)===normalizeName(CONTROL_NAME));

const destinationChildren=[];
for(let i=0;i<themeFolders.length;i+=CONCURRENCY){
  const batch=themeFolders.slice(i,i+CONCURRENCY);
  const result=await Promise.all(batch.map(async theme=>({
    theme,
    children:await drive.listChildren(theme.id,{foldersOnly:true})
  })));
  destinationChildren.push(...result);
}

const allDestComponents=[];
for(const {theme,children} of destinationChildren){
  for(const child of children){
    allDestComponents.push({
      ...child,
      destinationThemeId:theme.id,
      destinationThemeName:theme.name
    });
  }
}

const tagged=await drive.listByAppProperty('kcRunId',RUN_ID);
const taggedComponents=tagged.filter(x=>x.appProperties?.kcKind==='component');
const taggedThemes=tagged.filter(x=>x.appProperties?.kcKind==='theme');

const destIds=new Set(allDestComponents.map(x=>x.id));
const taggedIds=new Set(taggedComponents.map(x=>x.id));

const taggedNotInDestination=[];
const badMetadata=[];
for(const item of taggedComponents){
  const props=item.appProperties||{};
  const current=await drive.getFile(item.id,'id,name,parents,trashed,appProperties');
  const destParent=String(props.kcDestinationParentId||'').trim();
  const originalParent=String(props.kcOriginalParentId||'').trim();

  if(!current.parents?.includes(destParent)){
    taggedNotInDestination.push({
      id:item.id,
      name:item.name,
      currentParents:current.parents||[],
      expectedDestinationParentId:destParent,
      originalParentId:originalParent
    });
  }
  if(!originalParent||!destParent||String(props.kcState||'')!=='MOVED'){
    badMetadata.push({
      id:item.id,
      name:item.name,
      appProperties:props
    });
  }
}

const untaggedInDestination=allDestComponents
  .filter(x=>!taggedIds.has(x.id))
  .map(x=>({id:x.id,name:x.name,theme:x.destinationThemeName}));

const missingTaggedFromDestination=taggedComponents
  .filter(x=>!destIds.has(x.id))
  .map(x=>({id:x.id,name:x.name}));

const unexpectedComponentNamesInDestination=allDestComponents
  .filter(x=>!isComponentName(x.name))
  .map(x=>({id:x.id,name:x.name,theme:x.destinationThemeName}));

const duplicateIds=allDestComponents
  .map(x=>x.id)
  .filter((id,i,a)=>a.indexOf(id)!==i);

const report={
  runId:RUN_ID,
  generatedAt:new Date().toISOString(),
  source:{
    scannedFolders:sourceScan.nodes.length,
    componentFoldersStillInSource:sourceComponents.length,
    nestedComponentsStillInSource:sourceRemainingNested.map(x=>({id:x.id,name:x.name,path:x.path,parentId:x.parentId})),
    topLevelComponentsStillInSource:sourceRemainingTop.map(x=>({id:x.id,name:x.name,path:x.path,parentId:x.parentId}))
  },
  destination:{
    directFolders:destDirect.length,
    themeFolders:themeFolders.length,
    controlFolders:controlFolders.length,
    componentFolders:allDestComponents.length,
    untaggedInDestination,
    unexpectedComponentNamesInDestination,
    duplicateIds
  },
  tags:{
    taggedItems:tagged.length,
    taggedComponents:taggedComponents.length,
    taggedThemes:taggedThemes.length,
    taggedNotInDestination,
    missingTaggedFromDestination,
    badMetadata
  }
};

report.ok=
  sourceRemainingNested.length===0 &&
  sourceRemainingTop.length===3 &&
  themeFolders.length===228 &&
  allDestComponents.length===454 &&
  taggedComponents.length===454 &&
  taggedThemes.length===228 &&
  untaggedInDestination.length===0 &&
  taggedNotInDestination.length===0 &&
  missingTaggedFromDestination.length===0 &&
  badMetadata.length===0 &&
  unexpectedComponentNamesInDestination.length===0 &&
  duplicateIds.length===0;

await fs.writeFile(path.join(OUT_DIR,'verificacao.json'),JSON.stringify(report,null,2),'utf8');
await fs.writeFile(path.join(OUT_DIR,'RESUMO.txt'),summary(report),'utf8');

console.log(JSON.stringify({
  ok:report.ok,
  sourceNestedRemaining:sourceRemainingNested.length,
  sourceTopRemaining:sourceRemainingTop.map(x=>x.name),
  destinationThemes:themeFolders.length,
  destinationComponents:allDestComponents.length,
  taggedComponents:taggedComponents.length,
  taggedThemes:taggedThemes.length,
  untaggedInDestination:untaggedInDestination.length,
  taggedNotInDestination:taggedNotInDestination.length,
  badMetadata:badMetadata.length,
  unexpectedComponentNamesInDestination:unexpectedComponentNamesInDestination.length
},null,2));

if(!report.ok) process.exitCode=1;

async function scanTree(rootId){
  const rootFile=await drive.getFile(rootId);
  const root={...rootFile,parentId:null,path:'',depth:0};
  const nodes=[];
  const seen=new Set([rootId]);
  let frontier=[root];

  while(frontier.length){
    const next=[];
    for(let i=0;i<frontier.length;i+=CONCURRENCY){
      const batch=frontier.slice(i,i+CONCURRENCY);
      const rows=await Promise.all(batch.map(async parent=>({
        parent,
        children:await drive.listChildren(parent.id,{foldersOnly:true})
      })));
      for(const {parent,children} of rows){
        for(const item of children){
          if(seen.has(item.id)) continue;
          seen.add(item.id);
          const node={
            ...item,
            parentId:parent.id,
            path:parent.path?`${parent.path} / ${cleanName(item.name)}`:cleanName(item.name),
            depth:parent.depth+1
          };
          nodes.push(node);next.push(node);
        }
      }
    }
    frontier=next;
  }
  return {nodes};
}

function summary(r){
  return [
    'VERIFICAÇÃO — KITS E CILINDROS',
    `RUN_ID: ${r.runId}`,
    `RESULTADO: ${r.ok?'OK':'ATENÇÃO'}`,
    '',
    `Pastas-tema no destino: ${r.destination.themeFolders}`,
    `Componentes no destino: ${r.destination.componentFolders}`,
    `Componentes marcados pelo RUN_ID: ${r.tags.taggedComponents}`,
    `Temas marcados pelo RUN_ID: ${r.tags.taggedThemes}`,
    `Componentes nested ainda na origem: ${r.source.nestedComponentsStillInSource.length}`,
    `Componentes top-level ainda na origem: ${r.source.topLevelComponentsStillInSource.length}`,
    `Sem tag no destino: ${r.destination.untaggedInDestination.length}`,
    `Marcados fora do destino: ${r.tags.taggedNotInDestination.length}`,
    `Metadados de rollback inválidos: ${r.tags.badMetadata.length}`,
    `Nomes inesperados no destino: ${r.destination.unexpectedComponentNamesInDestination.length}`,
    '',
    'Top-level mantidos na origem:',
    ...r.source.topLevelComponentsStillInSource.map(x=>`- ${x.name}`)
  ].join('\n')+'\n';
}
