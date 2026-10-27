"use client";
import {useMemo} from 'react';
import {useRouter} from 'next/navigation';
import {TaskWorkspace} from '@berryit/shared/ui/TaskWorkspace';
import {createPortalProjectControlClient} from '@berryit/shared/project-control';
export function TasksClient(){const router=useRouter(),client=useMemo(()=>createPortalProjectControlClient(),[]);return <TaskWorkspace client={client} onOpenTicket={reference=>router.push(`/control/support?arende=${encodeURIComponent(reference)}`)}/>;}
