import { useMemo } from 'react';
import { createFactoryClient } from '@berryit/shared/factory';
import { FactoryWorkspace } from '@berryit/shared/ui/FactoryWorkspace';
import { useSession } from '@/auth/session';
export function Factory({project,product}:{project?:string;product?:string}){const {supabase}=useSession();const client=useMemo(()=>supabase?createFactoryClient(supabase):null,[supabase]);return client?<FactoryWorkspace client={client} initialProject={project} initialProduct={product}/>:null;}
