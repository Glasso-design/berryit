// Server-only extension of the existing read-only Connector Engine contract.
import { ConnectorError,fetchWithTimeout } from './contract.mjs';
const fail=(code,message)=>{throw new ConnectorError(code,message);};
const text=value=>typeof value==='string'?value:'';

export async function readProjectRepository({actor,input,connections,fetchImpl=fetch}){
 if(!input||!['branches','commits','pulls','files'].includes(input.kind)
 || !/^[0-9a-f-]{36}$/i.test(input.project??''))fail('BAD_CONFIG','Ogiltig repositorybegäran');
 const context=await actor.rpc('repository_read_context',{p_project:input.project});
 if(context.error||!context.data)fail('FORBIDDEN','Repositoryåtkomst nekad eller ej konfigurerad');
 const {repository,provider_id,secret_ref}=context.data;
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))fail('BAD_CONFIG','Ogiltig registrerad repositoryidentitet');
 const connection=connections?.[secret_ref];
 if(!connection?.token||String(connection.repositories?.[repository])!==String(provider_id))fail('NOT_CONFIGURED','Serverns godkända repositoryläsare saknas');
 const base='https://api.github.com/repos/'+repository;
 const get=async suffix=>{
  const response=await fetchWithTimeout(fetchImpl,base+suffix,{method:'GET',headers:{Authorization:'Bearer '+connection.token,Accept:'application/vnd.github+json','User-Agent':'berryit-connector-engine'}},8000);
  if(!response.ok)fail(response.status===404?'NOT_FOUND':'BAD_RESPONSE','GitHub-läsning misslyckades ('+response.status+')');
  if(Number(response.headers.get('content-length'))>2000000)fail('BAD_RESPONSE','GitHub-svar är för stort');
  // Enforce the bound even without Content-Length. Do not return provider errors/headers.
  if(!response.body)fail('BAD_RESPONSE','Tomt GitHub-svar');
  const reader=response.body.getReader();const chunks=[];let bytes=0;
  for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;
   if(bytes>2000000){await reader.cancel();fail('BAD_RESPONSE','GitHub-svar är för stort');}chunks.push(next.value);}
  const payload=new Uint8Array(bytes);let offset=0;for(const part of chunks){payload.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(payload));}catch{fail('BAD_RESPONSE','Ogiltigt GitHub-svar');}
 };
 const metadata=await get('');
 if(String(metadata.id)!==String(provider_id)||text(metadata.full_name).toLowerCase()!==repository.toLowerCase())fail('FORBIDDEN','Repositoryidentiteten har ändrats');
 const page=input.page??1;if(!Number.isSafeInteger(page)||page<1||page>10000)fail('BAD_CONFIG','Ogiltig sida');
 const ref=text(input.ref);if(ref.length>200||/[\x00-\x1f]/.test(ref))fail('BAD_CONFIG','Ogiltig branch/ref');
 let suffix='/'+input.kind+'?per_page=100&page='+page;
 if(input.kind==='commits'&&ref)suffix+='&sha='+encodeURIComponent(ref);
 if(input.kind==='files'){
  const path=text(input.path);if(path.length>1000||path.split('/').some(p=>p==='.'||p==='..')||/[\x00-\x1f\\]/.test(path))fail('BAD_CONFIG','Ogiltig filsökväg');
  suffix='/contents/'+path.split('/').map(encodeURIComponent).join('/')+(ref?'?ref='+encodeURIComponent(ref):'');
 }
 const data=await get(suffix);
 const trim=(s,max=4000)=>text(s).slice(0,max);
 let entries;
 if(input.kind==='branches')entries=Array.isArray(data)?data.map(b=>({name:trim(b.name,200),sha:trim(b.commit?.sha,64)})):[];
 if(input.kind==='commits')entries=Array.isArray(data)?data.map(c=>({sha:trim(c.sha,64),message:trim(c.commit?.message),date:trim(c.commit?.committer?.date,100)})):[];
 if(input.kind==='pulls')entries=Array.isArray(data)?data.map(p=>({number:p.number,title:trim(p.title),state:trim(p.state,40),head:trim(p.head?.ref,200),base:trim(p.base?.ref,200)})):[];
 if(input.kind==='files'){
  if(Array.isArray(data))entries=data.map(f=>({name:trim(f.name,500),path:trim(f.path,1000),type:trim(f.type,30)}));
  else if(data.encoding==='base64'&&typeof data.content==='string'){
   let decoded;try{decoded=Uint8Array.from(atob(data.content.replace(/\s/g,'')),c=>c.charCodeAt(0));}catch{fail('BAD_RESPONSE','Ogiltig filkodning');}
   let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(decoded);}catch{content='Binär fil kan inte visas i textgranskaren.';}
   entries=[{path:trim(data.path,1000),encoding:'utf-8',content}];
  }else entries=[{path:trim(data.path,1000),content:'Filen saknar stödd textrepresentation eller överskrider GitHubs Contents-gräns.'}];
 }
 // No provider download URLs, credentials, arbitrary headers or API base escape.
 return {repository,kind:input.kind,entries,page,mayHaveMore:input.kind!=='files'?entries.length===100:Array.isArray(data)&&data.length>=1000,readOnly:true};
}
