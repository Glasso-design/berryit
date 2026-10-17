import {createRoot} from 'react-dom/client';
import {OnarlyAi} from '../src/views/OnarlyAi';
import '../src/styles.css';
createRoot(document.getElementById('root')!).render(<div className="bg-ink p-5 text-paper"><OnarlyAi onOpenTicket={reference=>{document.getElementById('ticket-result')!.textContent=reference;}}/><output id="ticket-result"/></div>);
