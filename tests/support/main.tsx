// Test entry only. The same components are mounted by Desktop and Next portal.
import { createRoot } from 'react-dom/client';
import { CustomerWorkspace } from '../../shared/ui/CustomerWorkspace';
import { SupportWorkspace } from '../../shared/ui/SupportWorkspace';
import { createPortalSupportClient } from '../../shared/support-workflow';
const search=new URLSearchParams(location.search);
const client=createPortalSupportClient(fetch,'/__test/support');
createRoot(document.getElementById('root')!).render(search.get('view')==='customers'?<CustomerWorkspace client={client}/>:<SupportWorkspace client={client} userId={search.get('user')!}/>);
