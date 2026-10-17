"use client";
import { useMemo } from 'react';
import { createPortalAccessClient } from '@berryit/shared/project-access';
import { ProjectAccessWorkspace } from '@berryit/shared/ui/ProjectAccessWorkspace';
export function PortalProjectAccess(){const client=useMemo(()=>createPortalAccessClient(),[]);return <ProjectAccessWorkspace client={client}/>;}
