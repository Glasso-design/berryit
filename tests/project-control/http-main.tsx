import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProjectAccessWorkspace} from '../../shared/ui/ProjectAccessWorkspace';
import {TaskWorkspace} from '../../shared/ui/TaskWorkspace';
import {createPortalAccessClient} from '../../shared/project-access';
import {createPortalProjectControlClient} from '../../shared/project-control';
import '../../desktop/src/styles.css';
const access=createPortalAccessClient(),control=createPortalProjectControlClient();
function Harness(){
 const [tasks,setTasks]=useState(false),[target,setTarget]=useState('');
 return <main className="min-h-screen space-y-5 bg-ink p-6 text-paper"><p>REAL isolated Auth / PostgREST / Storage · Chromium rehearsal · no native or production verification</p>
  <nav><button onClick={()=>setTasks(false)}>Projektregistret</button><button onClick={()=>setTasks(true)}>All Tasks</button></nav>
  {target&&<p role="status">{target}</p>}{tasks?<TaskWorkspace client={control}/>:<ProjectAccessWorkspace client={access} control={control} onOpenTicket={r=>setTarget('Support Desk: '+r)}/>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
