#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const API_KEY = firstEnv('GOOGLE_API_KEY', 'GOOGLE_DRIVE_API_KEY', 'DRIVE_API_KEY');
const ROOT_ID = process.env.DRIVE_MAP_ROOT_ID || '11cU5yMWafopC0JfMHotRxThpkgbQl-RW';
const ROOT_NAME = process.env.DRIVE_MAP_ROOT_NAME || 'PAINÉIS DE FESTA';
const GROUP_SIZE = clampInt(process.env.DRIVE_MAP_GROUP_SIZE, 40, 1, 80);
const CONCURRENCY = clampInt(process.env.DRIVE_MAP_CONCURRENCY, 8, 1, 20);
const OUT_DIR = path.resolve(process.env.DRIVE_MAP_OUT_DIR || 'drive-map-output');

if (!API_KEY) {
  console.error('Defina GOOGLE_API_KEY, GOOGLE_DRIVE_API_KEY ou DRIVE_API_KEY.');
  process.exit(1);
}

const startedAt = Date.now();

const root = {
  id: ROOT_ID,
  name: ROOT_NAME,
  parentId: null,
  path: '',
  depth: 0,
  url: `https://drive.google.com/drive/folders/${ROOT_ID}`
};

const nodes = [];
const seen = new Set([ROOT_ID]);
let frontier = [root];
let level = 0;
let requestCount = 0;

console.log('== Drive Map Turbo ==');
console.log('root:', ROOT_ID);
console.log('group_size:', GROUP_SIZE);
console.log('concurrency:', CONCURRENCY);

while (frontier.length) {
  const parentById = new Map(frontier.map(item => [item.id, item]));
  const groups = chunk(frontier.map(item => item.id), GROUP_SIZE);
  console.log(`nível ${level}: ${frontier.length} pasta(s), ${groups.length} grupo(s)`);

  const next = [];
  for (let offset = 0; offset < groups.length; offset += CONCURRENCY) {
    const wave = groups.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(wave.map(ids => listFoldersForParents(ids)));
    for (const files of results) {
      for (const file of files) {
        const parentId = (file.parents || []).find(id => parentById.has(id));
        if (!parentId || !file.id || seen.has(file.id)) continue;

        seen.add(file.id);
        const parent = parentById.get(parentId);
        const cleanName = normalizeLabel(file.name || file.id);
        const childPath = parent.path ? `${parent.path} / ${cleanName}` : cleanName;
        const node = {
          id: file.id,
          name: cleanName,
          parentId,
          path: childPath,
          depth: parent.depth + 1,
          url: file.webViewLink || `https://drive.google.com/drive/folders/${file.id}`,
          resourceKey: file.resourceKey || null
        };

        nodes.push(node);
        next.push(node);
      }
    }
  }

  console.log(`  -> ${next.length} subpasta(s)`);
  frontier = next;
  level += 1;
}

const elapsedSeconds = Math.round((Date.now() - startedAt) / 10) / 100;
const maxDepth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);

const payload = {
  generatedAt: new Date().toISOString(),
  source: root.url,
  root,
  stats: {
    folders: nodes.length,
    maxDepth,
    requests: requestCount,
    elapsedSeconds,
    groupSize: GROUP_SIZE,
    concurrency: CONCURRENCY
  },
  nodes
};

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, 'mapa-drive.json'), JSON.stringify(payload, null, 2), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'mapa-drive.csv'), toCsv(nodes), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'MAPA.html'), buildHtml(payload), 'utf8');
await fs.writeFile(path.join(OUT_DIR, 'RESUMO.txt'), buildSummary(payload), 'utf8');

console.log('');
console.log('== Concluído ==');
console.log('pastas:', nodes.length);
console.log('profundidade:', maxDepth);
console.log('requisições:', requestCount);
console.log('tempo:', elapsedSeconds + 's');
console.log('saída:', OUT_DIR);

async function listFoldersForParents(parentIds) {
  const all = [];
  let pageToken = '';

  do {
    const qParents = parentIds
      .map(id => `'${escapeDriveQuery(id)}' in parents`)
      .join(' or ');

    const params = new URLSearchParams({
      key: API_KEY,
      q: `(${qParents}) and trashed = false and mimeType = '${FOLDER_MIME}'`,
      fields: 'nextPageToken,files(id,name,mimeType,parents,webViewLink,resourceKey)',
      pageSize: '1000',
      orderBy: 'name_natural',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });

    if (pageToken) params.set('pageToken', pageToken);

    requestCount += 1;
    const response = await fetchWithRetry(`${DRIVE_API}?${params}`);
    if (!response.ok) {
      throw new Error(`Drive API ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    if (Array.isArray(data.files)) all.push(...data.files);
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return all;
}

async function fetchWithRetry(url, attempts = 6) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (![429, 500, 502, 503, 504].includes(response.status)) return response;
      lastError = new Error(`HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(8000, 400 * 2 ** attempt));
  }
  throw lastError || new Error('Falha desconhecida ao acessar o Google Drive.');
}

function toCsv(items) {
  const rows = [
    ['nivel', 'caminho', 'nome', 'id', 'id_pai', 'url'],
    ...items.map(item => [
      item.depth,
      item.path,
      item.name,
      item.id,
      item.parentId,
      item.url
    ])
  ];
  return rows.map(row => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function buildSummary(data) {
  return [
    'DRIVE MAP TURBO',
    '',
    `Raiz: ${data.root.name}`,
    `ID: ${data.root.id}`,
    `Pastas: ${data.stats.folders}`,
    `Profundidade máxima: ${data.stats.maxDepth}`,
    `Requisições ao Drive: ${data.stats.requests}`,
    `Tempo: ${data.stats.elapsedSeconds}s`,
    `Gerado em: ${data.generatedAt}`,
    '',
    'Abra MAPA.html para pesquisar e navegar.'
  ].join('\n') + '\n';
}

function buildHtml(data) {
  const embedded = JSON.stringify(data).replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drive Map Turbo — ${escapeHtml(data.root.name)}</title>
<style>
:root{font-family:Inter,Segoe UI,Arial,sans-serif;background:#f5f5f5;color:#111}
*{box-sizing:border-box} body{margin:0} header{position:sticky;top:0;z-index:5;background:#111;color:#fff;padding:18px 22px}
h1{font-size:19px;margin:0 0 7px}.meta{font-size:12px;opacity:.72;display:flex;gap:7px;flex-wrap:wrap}.pill{border:1px solid #ffffff33;border-radius:999px;padding:4px 8px}
.toolbar{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}input{flex:1;min-width:250px;padding:11px 13px;border:0;border-radius:9px;font-size:14px}button{padding:10px 12px;border:0;border-radius:9px;font-weight:650;cursor:pointer}
main{max-width:1500px;margin:auto;padding:18px}.card{background:#fff;border-radius:14px;padding:16px;box-shadow:0 2px 12px #0000000d}
details{margin-left:16px}summary{cursor:pointer;padding:5px 0}a{color:inherit;text-decoration:none}a:hover{text-decoration:underline}.count{font-size:11px;opacity:.5;margin-left:7px}
#results{display:none}.result{padding:10px 6px;border-bottom:1px solid #eee}.result:last-child{border:0}.path{font-size:12px;color:#777;margin-top:3px}.empty{padding:30px;text-align:center;color:#777}
</style>
</head>
<body>
<header>
<h1>Drive Map Turbo — ${escapeHtml(data.root.name)}</h1>
<div class="meta">
<span class="pill">${data.stats.folders} pastas</span>
<span class="pill">profundidade ${data.stats.maxDepth}</span>
<span class="pill">${data.stats.requests} requisições</span>
<span class="pill">${data.stats.elapsedSeconds}s</span>
</div>
<div class="toolbar">
<input id="q" placeholder="Buscar pasta ou caminho..." autocomplete="off">
<button id="expand">Expandir tudo</button>
<button id="collapse">Recolher</button>
</div>
</header>
<main><div class="card"><div id="tree"></div><div id="results"></div></div></main>
<script>
const DATA=${embedded};
const byParent=new Map();
for(const n of DATA.nodes){if(!byParent.has(n.parentId))byParent.set(n.parentId,[]);byParent.get(n.parentId).push(n)}
for(const arr of byParent.values())arr.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true}));
function render(parentId,host,depth=0){for(const n of byParent.get(parentId)||[]){const d=document.createElement('details');if(depth===0)d.open=true;const s=document.createElement('summary');const a=document.createElement('a');a.href=n.url;a.target='_blank';a.rel='noreferrer';a.textContent='📁 '+n.name;a.onclick=e=>e.stopPropagation();s.appendChild(a);const kids=(byParent.get(n.id)||[]).length;if(kids){const c=document.createElement('span');c.className='count';c.textContent=kids+' subpasta'+(kids===1?'':'s');s.appendChild(c)}d.appendChild(s);if(kids)render(n.id,d,depth+1);host.appendChild(d)}}
const tree=document.getElementById('tree');const root=document.createElement('details');root.open=true;const rs=document.createElement('summary');const ra=document.createElement('a');ra.href=DATA.root.url;ra.target='_blank';ra.rel='noreferrer';ra.textContent='📁 '+DATA.root.name;ra.onclick=e=>e.stopPropagation();rs.appendChild(ra);root.appendChild(rs);render(DATA.root.id,root);tree.appendChild(root);
document.getElementById('expand').onclick=()=>document.querySelectorAll('#tree details').forEach(d=>d.open=true);
document.getElementById('collapse').onclick=()=>document.querySelectorAll('#tree details').forEach((d,i)=>d.open=i===0);
const q=document.getElementById('q'),results=document.getElementById('results');
q.addEventListener('input',()=>{const term=q.value.trim().toLocaleLowerCase('pt-BR');if(!term){results.style.display='none';tree.style.display='block';results.innerHTML='';return}tree.style.display='none';results.style.display='block';const found=DATA.nodes.filter(n=>(n.path||n.name).toLocaleLowerCase('pt-BR').includes(term)).slice(0,750);results.innerHTML='';if(!found.length){results.innerHTML='<div class="empty">Nenhuma pasta encontrada.</div>';return}for(const n of found){const row=document.createElement('div');row.className='result';const a=document.createElement('a');a.href=n.url;a.target='_blank';a.rel='noreferrer';a.textContent='📁 '+n.name;const p=document.createElement('div');p.className='path';p.textContent=n.path;row.append(a,p);results.appendChild(row)}});
</script>
</body>
</html>`;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
