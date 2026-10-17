import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortalAccessClient } from '../../shared/project-access';
import { ProjectAccessWorkspace } from '../../shared/ui/ProjectAccessWorkspace';
import '../../desktop/src/styles.css';
createRoot(document.getElementById('root')!).render(<div className="h-full overflow-auto bg-ink p-6 text-paper"><ProjectAccessWorkspace client={createPortalAccessClient()}/></div>);
