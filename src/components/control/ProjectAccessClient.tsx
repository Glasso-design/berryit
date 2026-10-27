"use client";
import { useMemo } from 'react';
import { createPortalAccessClient } from '@berryit/shared/project-access';
import { ProjectAccessWorkspace } from '@berryit/shared/ui/ProjectAccessWorkspace';
import {createPortalProjectControlClient} from '@berryit/shared/project-control';
import {useRouter} from 'next/navigation';
export function PortalProjectAccess(){const router=useRouter();const client=useMemo(()=>createPortalAccessClient(),[]);
 const control=useMemo(()=>createPortalProjectControlClient({repository:client.repository,syncIssues:async(project,integration)=>{const response=await fetch('/api/control/project-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project,integration})});const result=await response.json();if(!response.ok)throw Error(result.error??'Issuesynk nekades.');return result.data;}}),[client]);
 return <ProjectAccessWorkspace client={client} control={control} onOpenTicket={reference=>router.push(`/control/support?arende=${encodeURIComponent(reference)}`)} onOpenFactory={(project,product)=>router.push(`/control/factory?project=${encodeURIComponent(project)}&product=${encodeURIComponent(product)}`)}/>;
}
