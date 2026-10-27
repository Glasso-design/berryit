import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectAccessWorkspace} from '../../shared/ui/ProjectAccessWorkspace';
import {TaskWorkspace} from '../../shared/ui/TaskWorkspace';
import {FactoryWorkspace} from '../../shared/ui/FactoryWorkspace';
import {createPortalAccessClient} from '../../shared/project-access';
import {createPortalProjectControlClient} from '../../shared/project-control';
import {createFactoryHttpClient} from '../../shared/factory';
import '../../desktop/src/styles.css';
const access=createPortalAccessClient();
const control=createPortalProjectControlClient({repository:access.repository,syncIssues:async(project,integration)=>{
 const r=await fetch('/synthetic/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,integration})});const d=await r.json();if(!r.ok)throw Error(d.error);return d.data;
}});
const factory=createFactoryHttpClient(fetch,'/synthetic/factory');
function Harness(){
 const [tab,setTab]=useState('projects'),[target,setTarget]=useState(''),[scope,setScope]=useState<{project:string;product:string}|null>(null);
 return <main className="min-h-screen space-y-5 bg-ink p-6 text-paper"><p>LOCAL / MOCK · synthetic authenticated transport · real PostgreSQL RLS · no GoTrue or native WebView2</p>
  <nav className="flex gap-3"><button onClick={()=>setTab('projects')}>Projektregistret</button><button onClick={()=>setTab('tasks')}>All Tasks</button></nav>{target&&<p role="status">{target}</p>}
  {tab==='projects'&&<ProjectAccessWorkspace client={access} control={control} onOpenTicket={reference=>setTarget('Support Desk: '+reference)} onOpenAi={project=>setTarget('Ask ONARLY AI project: '+project)} onOpenFactory={(project,product)=>{setScope({project,product});setTab('factory');}}/>}
  {tab==='tasks'&&<TaskWorkspace client={control}/>}{tab==='factory'&&<FactoryWorkspace client={factory} initialProject={scope?.project} initialProduct={scope?.product}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
