import { useEffect, useMemo, useState } from "react";
import { Icon } from "@berryit/shared/ui/Icon";
import {
  channelLabel,
  connectionLabel,
  connectionState,
  deliveryLabel,
  filterConversations,
  lockedAddresses,
  newCursor,
  mergeMessages,
  sortByActivity,
  statusLabel,
  unreadCount,
} from "@berryit/shared/communications";
import type {
  Conversation,
  ConversationMessage,
  InboxFilter,
  SyncCursor,
} from "@berryit/shared/communications";
import { AI_REQUESTS, buildConversationAiBundle, mayShareConversation, requestLabel } from "@berryit/shared/comm-ai";
import type { AiRequestKind } from "@berryit/shared/comm-ai";
import { lastCheckedLabel } from "@berryit/shared/connectors";
import { useSession } from "@/auth/session";
import { loadRegistry, TOM_REGISTERDATA, type RegistryData } from "@/registry/data";
import {
  loadCommunications,
  loadMessages,
  markRead,
  sendMessage,
  TOM_KOMMUNIKATION,
  type CommData,
} from "@/registry/comm-data";

const FILTER: Array<{ key: InboxFilter; label: string }> = [
  { key: "alla", label: "Inkorg" },
  { key: "mina", label: "Mina konversationer" },
  { key: "otilldelade", label: "Ej tilldelade" },
  { key: "chat", label: "Livechattar" },
  { key: "email", label: "E-post" },
  { key: "internt", label: "Internt" },
];

/**
 * Gemensam inkorg: chatt, e-post och kopplade ärenden i samma vy.
 *
 * Meddelanden hämtas med en markör i stället för att läsas om från början. Det
 * är samma mekanism som används vid återhämtning efter ett avbrott, och den
 * fungerar lika bra den dag stacken får en realtidstjänst som pushar raderna.
 */
export function Kommunikation() {
  const { supabase, access } = useSession();
  const [registret, setRegistret] = useState<RegistryData>(TOM_REGISTERDATA);
  const [data, setData] = useState<CommData>(TOM_KOMMUNIKATION);
  const [filter, setFilter] = useState<InboxFilter>("alla");
  const [vald, setVald] = useState<Conversation | null>(null);
  const [meddelanden, setMeddelanden] = useState<ConversationMessage[]>([]);
  const [cursor, setCursor] = useState<SyncCursor>(() => newCursor());
  const [utkast, setUtkast] = useState("");
  const [internt, setInternt] = useState(false);
  const [laddar, setLaddar] = useState(true);
  const [fel, setFel] = useState<string | null>(null);
  const [synkfel, setSynkfel] = useState<string | null>(null);
  const [senastSynk, setSenastSynk] = useState<string | null>(null);
  const [aiFraga, setAiFraga] = useState<AiRequestKind | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;
    Promise.all([loadRegistry(supabase), loadCommunications(supabase)])
      .then(([r, c]) => {
        if (avbruten) return;
        setRegistret(r);
        setData(c);
      })
      .catch((e: unknown) => {
        if (!avbruten) setFel(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!avbruten) setLaddar(false);
      });
    return () => {
      avbruten = true;
    };
  }, [supabase]);

  // Meddelanden för den valda konversationen, och därefter löpande påfyllning
  // från markören. Ett avbrott gör ingen skada: nästa hämtning tar allt som
  // tillkommit sedan sist, och dubbletter sållas bort på id.
  useEffect(() => {
    if (!supabase || !vald) {
      setMeddelanden([]);
      setCursor(newCursor());
      return;
    }
    let avbruten = false;
    let aktuell = newCursor();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const hamta = async () => {
      try {
        const nya = await loadMessages(supabase, vald.id, aktuell.since);
        if (avbruten) return;
        setMeddelanden((befintliga) => {
          const ut = mergeMessages(befintliga, nya, aktuell);
          aktuell = ut.cursor;
          setCursor(ut.cursor);
          return ut.messages;
        });
        setSenastSynk(new Date().toISOString());
        setSynkfel(null);
      } catch (e) {
        if (!avbruten) setSynkfel(e instanceof Error ? e.message : String(e));
      } finally {
        if (!avbruten) timer = setTimeout(hamta, 15000);
      }
    };

    setMeddelanden([]);
    void hamta();
    if (access?.userId) void markRead(supabase, vald.id, access.userId);

    return () => {
      avbruten = true;
      if (timer) clearTimeout(timer);
    };
  }, [supabase, vald, access?.userId]);

  const orgNamn = useMemo(
    () => new Map(registret.organizations.map((o) => [o.id, o.name])),
    [registret.organizations],
  );

  const synliga = useMemo(
    () => sortByActivity(filterConversations(data.conversations, filter, access?.userId ?? null)),
    [data.conversations, filter, access?.userId],
  );

  const epostAnsluten = (data.mailboxes ?? []).some((m) => m.status === "connected" && m.is_enabled);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Kommunikation</h1>
        <p className="mt-2 text-muted">
          Chatt, e-post och kopplade ärenden i samma inkorg. Allt som visas här har faktiskt
          kommit in – inget fylls i av systemet.
        </p>
      </header>

      {fel && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          Kunde inte läsa kommunikationen: {fel}
        </p>
      )}

      <EpostStatus mailboxes={data.mailboxes} ansluten={epostAnsluten} />

      <nav className="flex flex-wrap gap-2" aria-label="Inkorgsfilter">
        {FILTER.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              filter === f.key ? "border-berry bg-berry/15 text-paper" : "border-line text-muted hover:text-paper"
            }`}
          >
            {f.label}
          </button>
        ))}
      </nav>

      {laddar ? (
        <p className="text-sm text-muted">Hämtar konversationer…</p>
      ) : synliga.length === 0 ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-8 text-sm text-muted">
          Inga konversationer i den här vyn.{" "}
          {data.conversations.length === 0
            ? "Det finns inga konversationer alls ännu – varken chatt eller e-post är igång."
            : ""}
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul className="space-y-2">
            {synliga.map((c) => (
              <KonversationsRad
                key={c.id}
                conversation={c}
                orgNamn={orgNamn}
                olasta={unreadCount(
                  vald?.id === c.id ? meddelanden : [],
                  data.participants.find((p) => p.conversation_id === c.id && p.profile_id === access?.userId) ?? null,
                )}
                vald={vald?.id === c.id}
                onValj={() => {
                  setVald(c);
                  setAiFraga(null);
                }}
              />
            ))}
          </ul>

          {vald ? (
            <Konversation
              conversation={vald}
              meddelanden={meddelanden}
              orgNamn={orgNamn}
              synkfel={synkfel}
              senastSynk={senastSynk}
              utkast={utkast}
              setUtkast={setUtkast}
              internt={internt}
              setInternt={setInternt}
              aiFraga={aiFraga}
              setAiFraga={setAiFraga}
              onSkicka={async () => {
                if (!supabase || !access?.userId || !utkast.trim()) return;
                const svar = await sendMessage(supabase, {
                  conversationId: vald.id,
                  organizationId: vald.organization_id,
                  userId: access.userId,
                  body: utkast.trim(),
                  internal: internt,
                });
                if (svar.error) setSynkfel(svar.error);
                else {
                  setUtkast("");
                  const nya = await loadMessages(supabase, vald.id, cursor.since);
                  setMeddelanden((b) => mergeMessages(b, nya, cursor).messages);
                }
              }}
            />
          ) : (
            <p className="rounded-2xl border border-line bg-ink-2 px-5 py-8 text-sm text-muted">
              Välj en konversation.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EpostStatus({ mailboxes, ansluten }: { mailboxes: CommData["mailboxes"]; ansluten: boolean }) {
  if (mailboxes === null) {
    return (
      <p className="rounded-2xl border border-line bg-ink-2 px-5 py-3 text-sm text-muted">
        Du ser inte brevlådorna. Att hantera dem kräver <code className="font-mono text-xs">connectors.manage</code>{" "}
        och bekräftad tvåfaktor.
      </p>
    );
  }
  if (ansluten) return null;
  return (
    <section className="rounded-2xl border border-dashed border-field bg-ink-2 p-5">
      <p className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-xs tracking-wide text-muted uppercase">
        <Icon name="phone" className="h-4 w-4" />
        E-post ej ansluten
      </p>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Ingen brevlåda är ansluten, så inga mejl hämtas och inga kan skickas.{" "}
        {mailboxes.length === 0
          ? "Ingen brevlåda är registrerad ännu."
          : `${mailboxes.length} brevlåda(or) är registrerade men inte aktiverade.`}{" "}
        Strukturen är ändå bestämd:
      </p>
      <dl className="mt-3 max-w-2xl space-y-2 text-sm">
        {lockedAddresses().map(({ address, purpose }) => (
          <div key={address} className="flex flex-col gap-0.5">
            <dt className="font-mono text-xs text-fg">{address}</dt>
            <dd className="text-muted">
              {purpose.description}{" "}
              {purpose.autoLinkTickets ? "Knyts till ett supportärende." : null}
              {purpose.allowsIntentCategories ? "Sorteras som fråga, offert eller samarbete." : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Att koppla dem kräver en brevlåda per adress i registret, en läsidentitet i serverns secret
        store och ett beslut om att aktivera den. Adresserna kan vara egna brevlådor eller alias till
        samma konto hos leverantören – i det senare fallet hämtas posten en gång och fördelas efter
        vilken adress den kom till.
      </p>
    </section>
  );
}

function KonversationsRad({
  conversation,
  orgNamn,
  olasta,
  vald,
  onValj,
}: {
  conversation: Conversation;
  orgNamn: Map<string, string>;
  olasta: number;
  vald: boolean;
  onValj: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onValj}
        className={`w-full rounded-2xl border bg-ink-2 p-4 text-left transition ${
          vald ? "border-berry/50" : "border-line hover:border-field"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] tracking-wide text-muted uppercase">
            {channelLabel(conversation.channel_key)}
          </span>
          {conversation.is_internal && (
            <span className="rounded-full border border-grape/40 px-2 py-0.5 font-mono text-[10px] tracking-wide text-grape uppercase">
              Internt
            </span>
          )}
          {olasta > 0 && (
            <span className="ml-auto rounded-full bg-berry px-2 py-0.5 text-[10px] font-semibold text-white">
              {olasta} olästa
            </span>
          )}
        </div>
        <p className="mt-2 truncate font-medium">{conversation.subject || "(utan ämne)"}</p>
        <p className="mt-1 text-xs text-muted">
          {orgNamn.get(conversation.organization_id) ?? "okänd kund"} · {statusLabel(conversation.status)}
          {conversation.assignee_id ? "" : " · ej tilldelad"}
          {conversation.last_message_at ? ` · ${lastCheckedLabel(conversation.last_message_at)}` : ""}
        </p>
      </button>
    </li>
  );
}

function Konversation({
  conversation,
  meddelanden,
  orgNamn,
  synkfel,
  senastSynk,
  utkast,
  setUtkast,
  internt,
  setInternt,
  aiFraga,
  setAiFraga,
  onSkicka,
}: {
  conversation: Conversation;
  meddelanden: ConversationMessage[];
  orgNamn: Map<string, string>;
  synkfel: string | null;
  senastSynk: string | null;
  utkast: string;
  setUtkast: (v: string) => void;
  internt: boolean;
  setInternt: (v: boolean) => void;
  aiFraga: AiRequestKind | null;
  setAiFraga: (v: AiRequestKind | null) => void;
  onSkicka: () => void;
}) {
  const anslutning = connectionState(senastSynk, synkfel);

  return (
    <section className="rounded-2xl border border-line bg-ink-2 p-5">
      <header className="flex flex-wrap items-center gap-3 border-b border-line pb-4">
        <h2 className="font-display text-lg font-semibold">{conversation.subject || "(utan ämne)"}</h2>
        <span className="text-xs text-muted">{orgNamn.get(conversation.organization_id) ?? "okänd kund"}</span>
        {conversation.ticket_id && (
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal uppercase">
            Kopplat ärende
          </span>
        )}
        <span
          className={`ml-auto rounded-full border px-3 py-1 font-mono text-[10px] tracking-wide uppercase ${
            anslutning === "live"
              ? "border-signal/40 text-signal"
              : anslutning === "error"
                ? "border-berry/50 text-berry"
                : "border-line text-muted"
          }`}
        >
          {connectionLabel(anslutning)}
        </span>
      </header>

      {synkfel && (
        <p role="alert" className="mt-4 rounded-xl border border-berry/40 bg-berry/10 px-3 py-2 text-xs">
          {synkfel} — hämtningen försöker igen automatiskt.
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {meddelanden.length === 0 ? (
          <li className="text-sm text-muted">Inga meddelanden ännu.</li>
        ) : (
          meddelanden.map((m) => (
            <li
              key={m.id}
              className={`rounded-xl border px-4 py-3 ${
                m.direction === "internal" ? "border-grape/30 bg-grape/[0.06]" : "border-line/60"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{m.direction === "inbound" ? "Kund" : m.direction === "internal" ? "Internt" : "BERRYiT"}</span>
                <span>{lastCheckedLabel(m.created_at)}</span>
                <span>{deliveryLabel(m.delivery_status)}</span>
                {m.direction === "inbound" && !m.sender_verified && (
                  <span className="rounded-full border border-berry-2/50 px-2 py-0.5 text-berry-2">
                    obekräftad avsändare
                  </span>
                )}
              </div>
              {/* Brödtexten visas som text. Sanerad HTML sparas men renderas inte
                  i den här versionen – text är alltid ofarligt. */}
              <p className="mt-2 text-sm whitespace-pre-wrap">{m.body_text}</p>
            </li>
          ))
        )}
      </ul>

      <div className="mt-5 border-t border-line pt-4">
        <label className="block">
          <span className="sr-only">Skriv ett svar</span>
          <textarea
            value={utkast}
            onChange={(e) => setUtkast(e.target.value)}
            rows={3}
            placeholder={internt ? "Intern anteckning till teamet…" : "Svara kunden…"}
            className="w-full rounded-xl border border-field bg-ink px-4 py-3 text-sm text-paper placeholder:text-muted focus:border-berry focus:outline-none"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={internt} onChange={(e) => setInternt(e.target.checked)} />
            Intern anteckning
          </label>
          <button
            type="button"
            onClick={onSkicka}
            disabled={!utkast.trim()}
            className="ml-auto rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white transition hover:bg-berry-deep disabled:opacity-50"
          >
            {internt ? "Spara anteckning" : "Skicka svar"}
          </button>
        </div>
      </div>

      <AiUnderlag
        conversation={conversation}
        meddelanden={meddelanden}
        organisation={orgNamn.get(conversation.organization_id) ?? "okänd kund"}
        fraga={aiFraga}
        setFraga={setAiFraga}
      />
    </section>
  );
}

/**
 * Underlaget för ONARLY AI. Byggs lokalt och visas som det är. Ingenting
 * skickas: godkännandet gäller en konversation och en fråga, och gränssnittet
 * ger det inte ännu.
 */
function AiUnderlag({
  conversation,
  meddelanden,
  organisation,
  fraga,
  setFraga,
}: {
  conversation: Conversation;
  meddelanden: ConversationMessage[];
  organisation: string;
  fraga: AiRequestKind | null;
  setFraga: (v: AiRequestKind | null) => void;
}) {
  const bundle = fraga
    ? buildConversationAiBundle({
        request: fraga,
        conversation,
        messages: meddelanden,
        organizationName: organisation,
      })
    : null;
  const kontroll = bundle ? mayShareConversation(bundle, null) : null;

  return (
    <section className="mt-6 rounded-2xl border border-dashed border-field p-5">
      <h3 className="font-display text-base font-semibold">Fråga ONARLY AI</h3>
      <p className="mt-1 text-sm text-muted">
        Välj en fråga för att se exakt vad som skulle delas. Ingenting skickas härifrån.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {AI_REQUESTS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setFraga(fraga === r ? null : r)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              fraga === r ? "border-berry text-paper" : "border-line text-muted hover:text-paper"
            }`}
          >
            {requestLabel(r)}
          </button>
        ))}
      </div>

      {bundle && (
        <div className="mt-4 space-y-2 text-xs">
          <p className="text-muted">{kontroll?.reason}</p>
          <p className="text-muted">
            Underlaget innehåller {bundle.messages.length} meddelanden.
          </p>
          <ul className="space-y-1 text-muted">
            {bundle.omitted.map((o) => (
              <li key={o}>• {o}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
