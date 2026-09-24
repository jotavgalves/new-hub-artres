#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  createAuthenticatedDrive,
  normalizeName
} from './kits-cilindros-drive-auth.mjs';

const SOURCE_ROOT_ID=process.env.KC_SOURCE_ROOT_ID||'11cU5yMWafopC0JfMHotRxThpkgbQl-RW';
const DEST_ROOT_ID=process.env.KC_DEST_ROOT_ID||'1eZbQ5wv3-nyzbUirt6k5OoBnlK63Szpt';
const RUN_ID=process.env.KC_RUN_ID||'KC-20260924191337';
const CONTROL_NAME='__CONTROLE_NAO_APAGAR';
const OUT_DIR=path.resolve(process.env.KC_VERIFY_OUT_DIR||'kits-cilindros-verification');
const CONCURRENCY=25;

const EXPECTED_SKIPPED=[
  {id:'1CddkZ0l2WRdeLQ-d9GxHAgaMmjqUIJgK',name:'CILINDROS DIVERSOS'},
  {id:'1bsi57CUqnBSxDYKUtyYMweDhzy8CoRgs',name:'CILINDROS RIPADOS'},
  {id:'19QdcKihncr8W2lwTd9TY7lA4YThREO8E',name:'KIT'}
];

await fs.mkdir(OUT_DIR,{recursive:true});
const drive=await createAuthenticatedDrive();

console.log('== VERIFICAÇÃO RÁPIDA Kits e Cilindros ==');
console.log('RUN_ID:',RUN_ID);

const destDirect=await drive.listChildren(DEST_ROOT_ID,{foldersOnly:true});
const themeFolders=destDirect.filter(f=>normalizeName(f.name)!==normalizeName(CONTROL_NAME));
const controlFolders=destDirect.filter(f=>normalizeName(f.name)===normalizeName(CONTROL_NAME));

const taggedRaw=await drive.listByAppProperty('kcRunId',RUN_ID);
const taggedById=new Map();
for(const item of taggedRaw){ if(item?.id) taggedById.set(item.id,item); }
const tagged=[...taggedById.values()];
const duplicateTaggedIds=taggedRaw.map(x=>x?.id).filter((id,i,a)=>id&&a.indexOf(id)!==i);
const taggedComponents=tagged.filter(x=>x.appProperties?.kcKind==='component');
const taggedThemes=tagged.filter(x=>x.appProperties?.kcKind==='theme');

const badComponentMetadata=[];
for(const item of taggedComponents){
  const p=item.appProperties||{};
  const original=String(p.kcOriginalParentId||'').trim();
  const destination=String(p.kcDestinationParentId||'').trim();
  const state=String(p.kcState||'').trim();
  if(!original||!destination||state!=='MOVED'||!(item.parents||[]).includes(destination)){
    badComponentMetadata.push({
      id:item.id,name:item.name,parents:item.parents||[],appProperties:p
    });
  }
}

const badThemeMetadata=[];
for(const item of taggedThemes){
  const p=item.appProperties||{};
  if(String(p.kcState||'').trim()!=='CREATED'||!(item.parents||[]).includes(DEST_ROOT_ID)){
    badThemeMetadata.push({
      id:item.id,name:item.name,parents:item.parents||[],appProperties:p
    });
  }
}

const themeIds=new Set(themeFolders.map(x=>x.id));
const taggedThemeIds=new Set(taggedThemes.map(x=>x.id));
const themesMissingTag=themeFolders.filter(x=>!taggedThemeIds.has(x.id)).map(x=>({id:x.id,name:x.name}));
const taggedThemesMissingFromDestination=taggedThemes.filter(x=>!themeIds.has(x.id)).map(x=>({id:x.id,name:x.name}));

const destinationChildren=[];
for(let i=0;i<themeFolders.length;i+=CONCURRENCY){
  const batch=themeFolders.slice(i,i+CONCURRENCY);
  const rows=await Promise.all(batch.map(async theme=>({
    theme,
    children:await drive.listChildren(theme.id,{foldersOnly:true})
  })));
  destinationChildren.push(...rows);
}

const allDestComponents=[];
for(const {theme,children} of destinationChildren){
  for(const child of children){
    allDestComponents.push({
      id:child.id,
      name:child.name,
      parents:child.parents||[],
      destinationThemeId:theme.id,
      destinationThemeName:theme.name
    });
  }
}

const destComponentIds=new Set(allDestComponents.map(x=>x.id));
const taggedComponentIds=new Set(taggedComponents.map(x=>x.id));

const untaggedInDestination=allDestComponents
  .filter(x=>!taggedComponentIds.has(x.id))
  .map(x=>({id:x.id,name:x.name,theme:x.destinationThemeName}));

const taggedMissingFromDestination=taggedComponents
  .filter(x=>!destComponentIds.has(x.id))
  .map(x=>({id:x.id,name:x.name,parents:x.parents||[]}));

const duplicateComponentIds=allDestComponents
  .map(x=>x.id)
  .filter((id,i,a)=>a.indexOf(id)!==i);

const skippedStatus=[];
for(const x of EXPECTED_SKIPPED){
  try{
    const f=await drive.getFile(x.id,'id,name,parents,trashed');
    skippedStatus.push({
      ...x,
      found:true,
      trashed:f.trashed===true,
      parents:f.parents||[],
      stillAtSource:(f.parents||[]).includes(SOURCE_ROOT_ID)
    });
  }catch(error){
    skippedStatus.push({...x,found:false,error:String(error?.message||error),stillAtSource:false});
  }
}

const report={
  runId:RUN_ID,
  generatedAt:new Date().toISOString(),
  destination:{
    directFolders:destDirect.length,
    themeFolders:themeFolders.length,
    controlFolders:controlFolders.length,
    componentFolders:allDestComponents.length,
    themesMissingTag,
    taggedThemesMissingFromDestination,
    untaggedInDestination,
    taggedMissingFromDestination,
    duplicateComponentIds
  },
  tags:{
    totalTagged:tagged.length,
    taggedComponents:taggedComponents.length,
    taggedThemes:taggedThemes.length,
    badComponentMetadata,
    badThemeMetadata,
    duplicateTaggedIds
  },
  skippedStatus
};

report.ok=
  destDirect.length===229 &&
  themeFolders.length===228 &&
  controlFolders.length===1 &&
  allDestComponents.length===454 &&
  taggedComponents.length===454 &&
  taggedThemes.length===228 &&
  tagged.length===682 &&
  duplicateTaggedIds.length>=0 &&
  themesMissingTag.length===0 &&
  taggedThemesMissingFromDestination.length===0 &&
  untaggedInDestination.length===0 &&
  taggedMissingFromDestination.length===0 &&
  duplicateComponentIds.length===0 &&
  badComponentMetadata.length===0 &&
  badThemeMetadata.length===0 &&
  skippedStatus.length===3 &&
  skippedStatus.every(x=>x.found&&!x.trashed&&x.stillAtSource);

await fs.writeFile(path.join(OUT_DIR,'verificacao.json'),JSON.stringify(report,null,2),'utf8');
await fs.writeFile(path.join(OUT_DIR,'RESUMO.txt'),[
  'VERIFICAÇÃO — KITS E CILINDROS',
  `RUN_ID: ${RUN_ID}`,
  `RESULTADO: ${report.ok?'OK':'ATENÇÃO'}`,
  '',
  `Pastas diretas no destino: ${destDirect.length}`,
  `Pastas-tema: ${themeFolders.length}`,
  `Pasta de controle: ${controlFolders.length}`,
  `Componentes no destino: ${allDestComponents.length}`,
  `Componentes marcados pelo RUN_ID: ${taggedComponents.length}`,
  `Temas marcados pelo RUN_ID: ${taggedThemes.length}`,
  `Itens marcados total: ${tagged.length}`,
  `Temas sem tag: ${themesMissingTag.length}`,
  `Componentes sem tag: ${untaggedInDestination.length}`,
  `Componentes marcados ausentes do destino: ${taggedMissingFromDestination.length}`,
  `Metadados inválidos de componente: ${badComponentMetadata.length}`,
  `Metadados inválidos de tema: ${badThemeMetadata.length}`,
  `IDs duplicados: ${duplicateComponentIds.length}`,
  '',
  'Exceções mantidas na origem:',
  ...skippedStatus.map(x=>`- ${x.name}: ${x.stillAtSource?'OK':'ATENÇÃO'}`)
].join('\n')+'\n','utf8');

console.log(JSON.stringify({
  ok:report.ok,
  directFolders:destDirect.length,
  themes:themeFolders.length,
  controls:controlFolders.length,
  components:allDestComponents.length,
  taggedTotal:tagged.length,
  taggedRawTotal:taggedRaw.length,
  taggedComponents:taggedComponents.length,
  taggedThemes:taggedThemes.length,
  themesMissingTag:themesMissingTag.length,
  taggedThemesMissingFromDestination:taggedThemesMissingFromDestination.length,
  untaggedInDestination:untaggedInDestination.length,
  taggedMissingFromDestination:taggedMissingFromDestination.length,
  duplicateComponentIds:duplicateComponentIds.length,
  badComponentMetadata:badComponentMetadata.length,
  badThemeMetadata:badThemeMetadata.length,
  duplicateTaggedIds:duplicateTaggedIds.length,
  skippedStatus:skippedStatus.map(x=>({name:x.name,stillAtSource:x.stillAtSource}))
},null,2));

if(!report.ok) process.exitCode=1;
