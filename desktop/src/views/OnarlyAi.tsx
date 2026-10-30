import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiContext,
  AiConversation,
  AiMessage,
  AiStructuredResponse,
} from "@berryit/shared/ai";
import { useSession } from "@/auth/session";
import { AiClientError, createAiClient } from "@/ai/client";
import { DiagnosticPanel } from '@/ai/DiagnosticPanel';
import { KnowledgeBase } from "@/ai/KnowledgeBase";

function errorText(error: unknown): string {
  return error instanceof AiClientError
    ? error.message
    : error instanceof Error
      ? error.message
      : "Ett oväntat fel inträffade.";
}

// One attempt = one question in one chat context. Its ids are generated once on
// the client and reused for every retry of that attempt (gateway down, timeout,
// lost response, failed history reload): the adapter deduplicates on them, so a
// retry continues the same conversation and stores the question only once.
type AskAttempt = { draft: string; conversationId: string; text: string; messageId: string };
type DiagnosticAttempt = { draft: string; conversationId: string };
const newAttemptId = () => crypto.randomUUID();

function ResponseSections({ response }: { response: AiStructuredResponse }) {
  return (
    <div className="mt-4 space-y-4 text-sm">
      {response.verifiedFacts.length > 0 && (
        <section aria-labelledby="ai-facts">
          <h4 id="ai-facts" className="font-mono text-[10px] tracking-wider text-signal uppercase">
            Verifierade fakta
          </h4>
          <ul className="mt-2 space-y-2">
            {response.verifiedFacts.map((fact, index) => (
              <li key={index} className="rounded-xl border border-signal/30 bg-signal/5 px-3 py-2">
                {fact.text}
                <span className="mt-1 block font-mono text-[10px] text-muted">
                  {fact.sourceIds.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {response.hypotheses.length > 0 && (
        <section aria-labelledby="ai-hypotheses">
          <h4 id="ai-hypotheses" className="font-mono text-[10px] tracking-wider text-amber-300 uppercase">
            Hypoteser
          </h4>
          <ul className="mt-2 space-y-2">
            {response.hypotheses.map((hypothesis, index) => (
              <li key={index} className="rounded-xl border border-amber-300/25 bg-amber-300/5 px-3 py-2">
                {hypothesis.text}
                <span className="ml-2 font-mono text-[10px] text-muted">
                  {hypothesis.confidence === "high"
                    ? "hög sannolikhet"
                    : hypothesis.confidence === "medium"
                      ? "medel"
                      : "låg"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {response.recommendedActions.length > 0 && (
        <section aria-labelledby="ai-actions">
          <h4 id="ai-actions" className="font-mono text-[10px] tracking-wider text-berry-2 uppercase">
            Föreslagna åtgärder
          </h4>
          <ol className="mt-2 space-y-2">
            {response.recommendedActions.map((action, index) => (
              <li key={index} className="rounded-xl border border-line bg-ink px-3 py-2">
                <span className="mr-2 text-muted">{index + 1}.</span>
                {action.text}
                {action.risk === "approval-required" && (
                  <span className="mt-1 block text-xs text-amber-300">
                    Kräver separat godkännande innan utförande.
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {response.missingInformation.length > 0 && (
        <section aria-labelledby="ai-missing">
          <h4 id="ai-missing" className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Saknad information / nästa diagnostik
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {response.missingInformation.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}

      {response.sources.length > 0 && (
        <section aria-labelledby="ai-sources">
          <h4 id="ai-sources" className="font-mono text-[10px] tracking-wider text-muted uppercase">
            Källor
          </h4>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {response.sources.map((source) => (
              <li key={source.id}>
                <span className="font-mono text-berry-2">{source.id}</span> · {source.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: AiMessage }) {
  const assistant = message.role === "assistant";
  return (
    <article
      className={`rounded-2xl border p-4 ${assistant ? "border-berry/30 bg-berry/5" : "border-line bg-ink-2"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] tracking-wider text-muted uppercase">
          {assistant ? "ONARLY AI" : "Du"}
        </span>
        <time className="text-[11px] text-muted">{new Date(message.created_at).toLocaleString("sv-SE")}</time>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
      {assistant && message.structured_response && (
        <ResponseSections response={message.structured_response} />
      )}
    </article>
  );
}

export function OnarlyAi({ onOpenTicket }: { onOpenTicket: (reference: string) => void }) {
  const { access, config, session, supabase } = useSession();
  const client = useMemo(
    () => (config && session ? createAiClient(config, session) : null),
    [config, session],
  );
  const [context, setContext] = useState<AiContext | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [incidentId,setIncidentId]=useState('');
  const [serviceKey, setServiceKey] = useState("");
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why the AI service itself could not be reached (adapter not deployed, down, refused).
  const [contextError, setContextError] = useState<string | null>(null);
  const [knowledgeVersion, setKnowledgeVersion] = useState(0);
  const askAttempt = useRef<AskAttempt | null>(null);
  const diagnosticAttempt = useRef<DiagnosticAttempt | null>(null);

  // Select a conversation the adapter just returned without a second network
  // call: a failed history reload must never make the retry lose it.
  const rememberConversation = useCallback((conversation: AiConversation) => {
    setConversations((rows) => [conversation, ...rows.filter((row) => row.id !== conversation.id)]);
    setConversationId(conversation.id);
  }, []);

  const loadConversations = useCallback(
    async (org: string) => {
      if (!client || !org) {
        setConversations([]);
        return;
      }
      const rows = await client.conversations(org);
      setConversations(rows);
      setConversationId((current) => {
        if (current && !rows.some((row) => row.id === current)) {
          setMessages([]);
          return "";
        }
        return current;
      });
    },
    [client],
  );

  useEffect(() => {
    if (!client || !access?.isStaff) return;
    let cancelled = false;
    client
      .context()
      .then((next) => {
        if (cancelled) return;
        setContextError(null);
        setContext(next);
        setOrganizationId((current) => current || next.organizations[0]?.id || "");
      })
      .catch((caught) => {
        if (!cancelled) setContextError(errorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [client, access?.isStaff]);

  useEffect(() => {
    setProjectId("");
    setIncidentId('');
    setConversationId("");
    setMessages([]);
    if (!organizationId) return;
    void loadConversations(organizationId).catch((caught) => setError(errorText(caught)));
  }, [organizationId, loadConversations]);

  useEffect(() => {
    if (!client || !conversationId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    client
      .messages(conversationId)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [client, conversationId]);

  const selectedConversation = conversations.find((row) => row.id === conversationId) ?? null;
  const projects = (context?.projects ?? []).filter(
    (project) => project.organization_id === organizationId,
  );
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant") ?? null;
  const latestQuestion = [...messages].reverse().find((message) => message.role === "user")?.body ?? "";
  // Honest availability: only a server-configured gateway can answer. Without it
  // nothing is sent and no answer is created (the adapter refuses with GATEWAY_DISABLED).
  const aiAvailable = Boolean(context?.gateway.available);
  const unavailableReason = contextError
    ? `BerryIT:s AI-tjänst svarar inte: ${contextError}`
    : context && !context.gateway.available
      ? context.gateway.reason ?? "ONARLY AI Gateway saknar serverkonfiguration."
      : null;

  const ask = async () => {
    const text = question.trim();
    if (!client || !organizationId || !text) return;
    setBusy("ask");
    setError(null);
    setNotice(null);
    // Same chat context + same question = the same attempt (same ids). The
    // conversation id is kept for a new chat even if the selection was lost.
    const draft = [organizationId, projectId, incidentId, serviceKey].join("|");
    const previous = askAttempt.current;
    const conversationKey =
      selectedConversation?.id ??
      (previous && previous.draft === draft ? previous.conversationId : newAttemptId());
    const attempt: AskAttempt = {
      draft,
      conversationId: conversationKey,
      text,
      messageId:
        previous && previous.conversationId === conversationKey && previous.text === text
          ? previous.messageId
          : newAttemptId(),
    };
    askAttempt.current = attempt;
    let active = selectedConversation;
    try {
      if (!active) {
        active = await client.createConversation({
          id: attempt.conversationId,
          organizationId,
          projectId: projectId || null,
          incidentId: incidentId || null,
          serviceKey: serviceKey || null,
          title: text.slice(0, 160),
        });
        attempt.conversationId = active.id;
        rememberConversation(active);
      }
      await client.ask(active.id, text, approved, attempt.messageId);
      askAttempt.current = null;
      setQuestion("");
      setApproved(false);
      // The answer is stored; refreshing the views must not turn it into an error.
      const answered = active.id;
      await Promise.all([
        client.messages(answered).then(setMessages).catch(() => undefined),
        loadConversations(organizationId).catch(() => undefined),
      ]);
    } catch (caught) {
      setError(errorText(caught));
      // The adapter stores the question before calling the gateway: show it, so
      // the history matches what was saved and a retry continues the same chat.
      if (active) {
        const conversation = active.id;
        await client.messages(conversation).then(setMessages).catch(() => undefined);
      }
    } finally {
      setBusy(null);
    }
  };

  const createTicket = async () => {
    if (!client || !selectedConversation) return;
    if (!window.confirm("Skapa ett riktigt supportärende från denna konversation?")) return;
    setBusy("ticket");
    setError(null);
    try {
      const ticket = await client.createTicket(selectedConversation.id);
      setNotice(`Ärende ${ticket.reference} skapades.`);
      onOpenTicket(ticket.reference);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const saveKnowledge = async () => {
    if (!client || !selectedConversation || !latestAssistant?.structured_response) return;
    if (
      !window.confirm(
        "Bekräfta att lösningen har verifierats i verkligheten innan den sparas i kunskapsbasen.",
      )
    ) {
      return;
    }
    const solution = latestAssistant.structured_response.recommendedActions
      .map((action, index) => `${index + 1}. ${action.text}`)
      .join("\n");
    if (!solution) {
      setError("Svaret innehåller ingen föreslagen lösning att verifiera.");
      return;
    }
    setBusy("knowledge");
    setError(null);
    try {
      const entry = await client.promoteKnowledge(selectedConversation.id, {
        assistantMessageId: latestAssistant.id,
        title: selectedConversation.title,
        problem: latestQuestion || selectedConversation.title,
        verifiedSolution: solution,
      });
      setNotice(`”${entry.title}” sparades som verifierad lösning.`);
      setKnowledgeVersion((value) => value + 1);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  if (!access?.isStaff) {
    return (
      <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
        Ask ONARLY AI kräver en aktiv supportbehörighet.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.18em] text-signal uppercase">
            BerryIT Support
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
            Ask ONARLY AI
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Felsök buggar, kod och drift med kundisolerad kontext. Förslag utför aldrig
            produktionsändringar automatiskt.
          </p>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs ${
            context?.gateway.available
              ? "border-signal/40 text-signal"
              : "border-amber-300/40 text-amber-300"
          }`}
        >
          {context?.gateway.available ? "Gateway serverkonfigurerad – kontakt ej verifierad" : "Gateway ej ansluten"}
        </span>
      </header>

      {unavailableReason && (
        <section
          role="status"
          aria-label="ONARLY AI är inte tillgänglig"
          className="rounded-2xl border border-amber-300/40 bg-amber-300/5 p-4 text-sm"
        >
          <h2 className="font-display text-lg font-semibold text-amber-300">ONARLY AI är inte tillgänglig</h2>
          <p className="mt-2">{unavailableReason}</p>
          <p className="mt-2 text-muted">
            Inga frågor skickas och inga AI-svar skapas. Sparad historik och kunskapsbasen går att läsa, och
            Sök felet kan förhandsgranska underlag.
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-signal">
          {notice}
        </p>
      )}

      <section className="grid gap-3 rounded-2xl border border-line bg-ink-2 p-4 md:grid-cols-3">
        <label className="text-sm">
          <span className="text-muted">Kund</span>
          <select
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-field bg-ink px-3 py-2 text-paper"
          >
            {(context?.organizations ?? []).map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Projekt</span>
          <select
            value={projectId}
            onChange={(event) => {setProjectId(event.target.value);setIncidentId('');}}
            disabled={Boolean(selectedConversation)}
            className="mt-2 w-full rounded-xl border border-field bg-ink px-3 py-2 text-paper disabled:opacity-50"
          >
            <option value="">Allmänt / inget projekt</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-muted">Tjänst</span>
          <select
            value={serviceKey}
            onChange={(event) => setServiceKey(event.target.value)}
            disabled={Boolean(selectedConversation)}
            className="mt-2 w-full rounded-xl border border-field bg-ink px-3 py-2 text-paper disabled:opacity-50"
          >
            <option value="">Alla tjänster</option>
            {(context?.services ?? []).map((service) => (
              <option key={service.key} value={service.key}>
                {service.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border border-line p-4">
       <label className="block text-sm">Incident
        <select value={incidentId} disabled={Boolean(selectedConversation)} onChange={e=>{
         const incident=context?.incidents?.find(i=>i.id===e.target.value);
         setIncidentId(incident?.id??'');if(incident)setProjectId(incident.project_id??'');
        }} className="mt-2 block w-full rounded-xl border border-field bg-ink px-3 py-2">
         <option value="">Ingen vald incident / hela projektet</option>
         {(context?.incidents??[]).filter(i=>i.organization_id===organizationId&&(!projectId||i.project_id===projectId)).map(i=><option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
       </label>
       {!selectedConversation&&(projectId||incidentId)&&<button type="button" disabled={busy!==null} onClick={()=>{
        if(!client)return;setBusy('diagnostic');setError(null);
        // Same target = same attempt id, so a retry never creates a second conversation.
        const draft=[organizationId,projectId,incidentId].join('|');
        const attempt=diagnosticAttempt.current?.draft===draft?diagnosticAttempt.current:{draft,conversationId:newAttemptId()};
        diagnosticAttempt.current=attempt;
        void client.createConversation({id:attempt.conversationId,organizationId,projectId:projectId||null,incidentId:incidentId||null,serviceKey:null,title:'Sök felet'}).then(async conversation=>{
         rememberConversation(conversation);diagnosticAttempt.current=null;
         await loadConversations(organizationId).catch(()=>undefined);
        }).catch(e=>setError(errorText(e))).finally(()=>setBusy(null));
       }} className="rounded-full border border-line px-4 py-2 text-sm">Sök felet för valt mål</button>}
       {client&&selectedConversation&&(selectedConversation.project_id||selectedConversation.incident_id)&&<DiagnosticPanel
        key={selectedConversation.id} client={client} conversationId={selectedConversation.id} gatewayConfigured={Boolean(context?.gateway.available)}
        onComplete={async()=>{setMessages(await client.messages(selectedConversation.id));await loadConversations(organizationId);}}/>}
      </section>

      <div className="grid min-h-[520px] gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-line bg-ink-2 p-3">
          <div className="flex items-center justify-between px-2 py-2">
            <h2 className="font-display font-semibold">Historik</h2>
            <button
              type="button"
              onClick={() => {
                // An explicit new chat is a new attempt, never a retry.
                askAttempt.current = null;
                diagnosticAttempt.current = null;
                setConversationId("");
                setMessages([]);
              }}
              className="text-xs text-berry-2 hover:underline"
            >
              Ny chatt
            </button>
          </div>
          <div className="mt-2 space-y-1">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => {
                  setConversationId(conversation.id);
                  setProjectId(conversation.project_id ?? "");
                  setIncidentId(conversation.incident_id??'');
                  setServiceKey(conversation.service_key ?? "");
                }}
                className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${
                  conversation.id === conversationId
                    ? "bg-berry/15 text-paper"
                    : "text-muted hover:bg-fog/[0.04] hover:text-paper"
                }`}
              >
                <span className="block truncate">{conversation.title}</span>
                <span className="mt-1 block text-[10px]">
                  {new Date(conversation.updated_at).toLocaleDateString("sv-SE")}
                </span>
              </button>
            ))}
            {conversations.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted">Ingen sparad konversation.</p>
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-ink p-4">
          <div className="app-scroll flex-1 space-y-3 pr-1">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
            {messages.length === 0 && (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <p className="font-display text-lg">Beskriv problemet konkret</p>
                  <p className="mt-2 max-w-md text-sm text-muted">
                    Lägg gärna med felmeddelande, tidpunkt och vad som redan har kontrollerats.
                    ONARLY AI markerar vad som är belagt och vad som fortfarande är en hypotes.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              maxLength={8000}
              disabled={!aiAvailable}
              placeholder="Fråga om ett fel, kod, drift eller ett supportärende…"
              className="w-full resize-y rounded-xl border border-field bg-ink-2 px-4 py-3 text-sm text-paper placeholder:text-muted focus:border-berry focus:outline-none disabled:opacity-50"
            />
            <label className="mt-3 flex items-start gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={approved}
                disabled={!aiAvailable}
                onChange={(event) => setApproved(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Jag har granskat texten och godkänner att frågan och den valda, behörighetskontrollerade
                kontexten skickas via ONARLY AI Gateway.
              </span>
            </label>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void ask()}
                disabled={
                  busy !== null ||
                  !question.trim() ||
                  !organizationId ||
                  !approved ||
                  !aiAvailable
                }
                className="rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white hover:bg-berry-deep disabled:opacity-50"
              >
                {busy === "ask" ? "Analyserar…" : "Fråga ONARLY AI"}
              </button>
              <button
                type="button"
                onClick={() => void createTicket()}
                disabled={busy !== null || !selectedConversation || messages.length === 0}
                className="rounded-full border border-line px-5 py-2 text-sm hover:border-field disabled:opacity-50"
              >
                {busy === "ticket" ? "Skapar…" : "Skapa supportärende"}
              </button>
              <button
                type="button"
                onClick={() => void saveKnowledge()}
                disabled={busy !== null || !latestAssistant?.structured_response}
                className="rounded-full border border-line px-5 py-2 text-sm hover:border-field disabled:opacity-50"
              >
                {busy === "knowledge" ? "Sparar…" : "Spara verifierad lösning"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {supabase && organizationId && (
        <KnowledgeBase supabase={supabase} organizationId={organizationId} version={knowledgeVersion} />
      )}
    </div>
  );
}
