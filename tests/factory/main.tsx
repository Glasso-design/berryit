import { createRoot } from 'react-dom/client';
import { FactoryWorkspace } from '../../shared/ui/FactoryWorkspace';
import { createFactoryHttpClient } from '../../shared/factory';
const client=createFactoryHttpClient(fetch,'/synthetic/factory');
createRoot(document.getElementById('root')!).render(<FactoryWorkspace client={client}/>);
