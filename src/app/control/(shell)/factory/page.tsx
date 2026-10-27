import { PortalFactory } from '@/components/control/FactoryClient';
import { requireSession } from '@/lib/auth';
export const dynamic='force-dynamic';
export const metadata={title:'Platform Factory'};
export default async function Page(){await requireSession();return <PortalFactory/>;}
