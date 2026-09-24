import { exchangeServiceAccountToken, parseServiceAccountCredentials } from './catalog-v2/service-account-google-drive.mjs';

const DRIVE_API='https://www.googleapis.com/drive/v3/files';
const UPLOAD_API='https://www.googleapis.com/upload/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder';
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive';

export async function createAuthenticatedDrive(){
  const raw=String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON||'').trim();
  if(!raw) throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON não configurado.');
  const credentials=parseServiceAccountCredentials(raw);
  const token=await exchangeServiceAccountToken(credentials,{scope:DRIVE_SCOPE});
  return new DriveMutationClient(token.accessToken,credentials.clientEmail);
}

export class DriveMutationClient{
  constructor(accessToken,serviceAccountEmail){
    this.accessToken=accessToken;
    this.serviceAccountEmail=serviceAccountEmail;
    this.requests=0;
  }

  async request(url,options={},attempts=5){
    let last;
    for(let i=0;i<attempts;i++){
      this.requests++;
      try{
        const response=await fetch(url,{
          redirect:'error',
          ...options,
          headers:{
            Accept:'application/json',
            Authorization:`Bearer ${this.accessToken}`,
            ...(options.headers||{})
          }
        });
        if(![408,425,429,500,502,503,504].includes(response.status)) return response;
        last=new Error(`HTTP ${response.status}: ${await response.text()}`);
      }catch(error){last=error;}
      await sleep(Math.min(500*2**i,5000));
    }
    throw last||new Error('Falha no Google Drive');
  }

  async json(url,options={}){
    const response=await this.request(url,options);
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{};}catch{}
    if(!response.ok){
      const e=new Error(`Drive API ${response.status}: ${text}`);
      e.status=response.status;e.payload=data;throw e;
    }
    return data;
  }

  async getFile(id,fields='id,name,mimeType,parents,trashed,webViewLink,capabilities,appProperties'){
    const params=new URLSearchParams({supportsAllDrives:'true',fields});
    return await this.json(`${DRIVE_API}/${encodeURIComponent(id)}?${params}`);
  }

  async listChildren(parentId,{foldersOnly=false,name=null}={}){
    const files=[];let pageToken='';
    do{
      const clauses=[`'${escapeQ(parentId)}' in parents`,'trashed = false'];
      if(foldersOnly) clauses.push(`mimeType = '${FOLDER}'`);
      if(name!==null) clauses.push(`name = '${escapeQ(name)}'`);
      const params=new URLSearchParams({
        q:clauses.join(' and '),
        fields:'nextPageToken,files(id,name,mimeType,parents,trashed,webViewLink,capabilities,appProperties)',
        pageSize:'1000',
        orderBy:'folder,name_natural',
        supportsAllDrives:'true',
        includeItemsFromAllDrives:'true'
      });
      if(pageToken) params.set('pageToken',pageToken);
      const data=await this.json(`${DRIVE_API}?${params}`);
      files.push(...(Array.isArray(data.files)?data.files:[]));
      pageToken=String(data.nextPageToken||'');
    }while(pageToken);
    return files;
  }

  async createFolder(name,parentId,appProperties=null){
    const params=new URLSearchParams({supportsAllDrives:'true',fields:'id,name,parents,webViewLink,appProperties'});
    const metadata={name,mimeType:FOLDER,parents:[parentId]};
    if(appProperties && typeof appProperties==='object') metadata.appProperties=appProperties;
    return await this.json(`${DRIVE_API}?${params}`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(metadata)
    });
  }

  async patchAppProperties(fileId,properties){
    const params=new URLSearchParams({supportsAllDrives:'true',fields:'id,name,parents,appProperties'});
    return await this.json(`${DRIVE_API}/${encodeURIComponent(fileId)}?${params}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({appProperties:properties})
    });
  }

  async listByAppProperty(key,value){
    const files=[];let pageToken='';
    const safeKey=escapeQ(key),safeValue=escapeQ(value);
    do{
      const params=new URLSearchParams({
        q:`appProperties has { key='${safeKey}' and value='${safeValue}' } and trashed = false`,
        fields:'nextPageToken,files(id,name,mimeType,parents,trashed,webViewLink,capabilities,appProperties)',
        pageSize:'1000',
        orderBy:'folder,name_natural',
        supportsAllDrives:'true',
        includeItemsFromAllDrives:'true'
      });
      if(pageToken) params.set('pageToken',pageToken);
      const data=await this.json(`${DRIVE_API}?${params}`);
      files.push(...(Array.isArray(data.files)?data.files:[]));
      pageToken=String(data.nextPageToken||'');
    }while(pageToken);
    return files;
  }

  async moveFile(fileId,fromParentId,toParentId){
    const params=new URLSearchParams({
      addParents:toParentId,
      removeParents:fromParentId,
      supportsAllDrives:'true',
      fields:'id,name,parents,webViewLink'
    });
    return await this.json(`${DRIVE_API}/${encodeURIComponent(fileId)}?${params}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:'{}'
    });
  }

  async deleteFile(fileId){
    const params=new URLSearchParams({supportsAllDrives:'true'});
    const response=await this.request(`${DRIVE_API}/${encodeURIComponent(fileId)}?${params}`,{method:'DELETE'});
    if(response.status===404) return false;
    if(!response.ok) throw new Error(`Drive API ${response.status}: ${await response.text()}`);
    return true;
  }

  async uploadJsonFile(name,parentId,object){
    const boundary='kc_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
    const metadata={name,mimeType:'application/json',parents:[parentId]};
    const body=[
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(object,null,2)}\r\n`,
      `--${boundary}--`
    ].join('');
    const params=new URLSearchParams({uploadType:'multipart',supportsAllDrives:'true',fields:'id,name,parents,webViewLink'});
    return await this.json(`${UPLOAD_API}?${params}`,{
      method:'POST',
      headers:{'Content-Type':`multipart/related; boundary=${boundary}`},
      body
    });
  }

  async updateJsonFile(fileId,object){
    const params=new URLSearchParams({uploadType:'media',supportsAllDrives:'true',fields:'id,name,parents,webViewLink'});
    return await this.json(`${UPLOAD_API}/${encodeURIComponent(fileId)}?${params}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(object,null,2)
    });
  }

  async downloadJsonFile(fileId){
    const params=new URLSearchParams({alt:'media',supportsAllDrives:'true'});
    const response=await this.request(`${DRIVE_API}/${encodeURIComponent(fileId)}?${params}`);
    const text=await response.text();
    if(!response.ok) throw new Error(`Drive API ${response.status}: ${text}`);
    return JSON.parse(text);
  }
}

export const FOLDER_MIME=FOLDER;
export function normalizeName(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim();
}
export function cleanName(value){return String(value||'').replace(/\s+/g,' ').trim();}
export function destinationThemeName(name){return normalizeName(name)==='UNICORNIO'?'UNICÓRNIO':cleanName(name);}
export function isComponentName(name){
  const tokens=normalizeName(name).split(/[^A-Z0-9]+/).filter(Boolean);
  const cyl=tokens.some(isCylinderToken);
  const kit=tokens.includes('KIT')||(tokens.includes('KIR')&&cyl);
  return kit||cyl;
}
function isCylinderToken(token){
  const t=String(token||'').toUpperCase();
  if(['CILINDRO','CILINDROS','CICLINDROS','CILNIDROS','CILIDROS','CILINDOS'].includes(t)) return true;
  return levenshtein(t,'CILINDROS')<=2||levenshtein(t,'CILINDRO')<=2;
}
function levenshtein(a,b){
  if(a===b)return 0;if(!a.length)return b.length;if(!b.length)return a.length;
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const cur=[i];
    for(let j=1;j<=b.length;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    for(let j=0;j<cur.length;j++)prev[j]=cur[j];
  }
  return prev[b.length];
}
function escapeQ(value){return String(value||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
