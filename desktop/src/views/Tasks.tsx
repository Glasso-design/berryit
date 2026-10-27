import {useMemo} from 'react';
import {TaskWorkspace} from '@berryit/shared/ui/TaskWorkspace';
import {useSession} from '@/auth/session';
import {desktopProjectControl} from '@/project-control/client';
export function Tasks({onOpenTicket}:{onOpenTicket:(reference:string)=>void}){
 const {supabase,config}=useSession();const client=useMemo(()=>supabase?desktopProjectControl(supabase,config?.controlUrl):null,[supabase,config?.controlUrl]);
 return client?<TaskWorkspace client={client} onOpenTicket={onOpenTicket}/>:null;
}
