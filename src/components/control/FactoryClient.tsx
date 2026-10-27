"use client";
import { useMemo } from 'react';
import { createFactoryHttpClient } from '@berryit/shared/factory';
import { FactoryWorkspace } from '@berryit/shared/ui/FactoryWorkspace';
export function PortalFactory(){const client=useMemo(()=>createFactoryHttpClient(),[]);return <FactoryWorkspace client={client}/>;}
