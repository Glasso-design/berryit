/*
 * Communications – delat kontrakt.
 *
 * Används av desktopklienten, e-postadaptern och testerna.
 *
 * Om realtid
 * ----------
 * Modellen är byggd för att kunna bli realtid utan att skrivas om: klienten
 * håller en markör (tidsstämpeln för det senaste meddelandet den sett) och
 * hämtar allt som tillkommit sedan dess. Den fungerar lika bra som en
 * prenumeration som pushar nya rader. I den här versionen hämtar den själv,
 * eftersom stacken inte har någon realtidstjänst och passet inte får öppna
 * nya publika tjänster.
 *
 * Samma markör är också återhämtningen: tappar klienten anslutningen hämtar
 * den allt sedan markören när den kommer tillbaka, utan att något går förlorat
 * och utan att något visas två gånger.
 */

export const CHANNEL_KEYS = ["chat_customer", "chat_internal", "email"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const CONVERSATION_STATUSES = ["open", "pending", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const DELIVERY_STATUSES = ["draft", "queued", "sent", "delivered", "failed", "received"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type Conversation = {
  id: string;
  organization_id: string;
  channel_key: ChannelKey;
  mailbox_id: string | null;
  subject: string;
  ticket_id: string | null;
  assignee_id: string | null;
  status: ConversationStatus;
  is_internal: boolean;
  external_thread_key: string | null;
  last_message_at: string | null;
  created_at: string;
};

export type ConversationMessage = {
  id: string;
  organization_id: string;
  conversation_id: string;
  author_id: string | null;
  author_address: string | null;
  direction: "inbound" | "outbound" | "internal";
  body_text: string;
  body_safe_html: string | null;
  delivery_status: DeliveryStatus;
  delivery_error: string | null;
  sender_verified: boolean;
  created_at: string;
};

export type Participant = {
  id: string;
  conversation_id: string;
  profile_id: string | null;
  external_address: string | null;
  participant_role: "customer" | "staff" | "external";
  last_read_at: string | null;
};

export type Mailbox = {
  id: string;
  organization_id: string;
  address: string;
  provider_kind: string;
  secret_ref: string | null;
  access_mode: string;
  is_enabled: boolean;
  /** Vad posten till adressen blir. Speglar comm_mailbox_purposes.key. */
  purpose: MailboxPurposeKey;
  /**
   * Vilket konto hos leverantören adressen ligger på. Två adresser med samma
   * nyckel är alias till samma fysiska brevlåda och hämtas bara en gång.
   */
  provider_account_key: string | null;
  /** Satt först när leverantören bekräftat att adressen får skicka. */
  can_send_from: boolean;
  status: "not_configured" | "configured" | "connected" | "error" | "disabled";
  last_synced_at: string | null;
  last_error: string | null;
};

/* ----------------------------------------------------- den låsta strukturen */

/*
 * BERRYiT har två adresser, och skillnaden mellan dem är inte kosmetisk:
 *
 *   support@berryit.se  all post blir support och ska knytas till ett ärende.
 *   info@berryit.se     allmän företagskontakt: en fråga, en offertförfrågan
 *                       eller ett samarbete. Den ska kunna sorteras, inte
 *                       automatiskt bli ett ärende.
 *
 * Databasen äger strukturen (comm_mailbox_purposes). Det här är klientens
 * spegling av samma sak, så att gränssnittet kan säga vad som gäller innan en
 * enda brevlåda är ansluten. Adresserna står här – leverantören gör det inte,
 * och ska inte göra det: vilken leverantör som används är ett driftbeslut.
 */
export const MAILBOX_PURPOSE_KEYS = ["support", "info", "other"] as const;
export type MailboxPurposeKey = (typeof MAILBOX_PURPOSE_KEYS)[number];

/** Avsikten bakom ett inkommande mejl. `support` är det post till supportadressen blir. */
export const CONVERSATION_INTENTS = ["support", "general", "quote", "partnership"] as const;
export type ConversationIntent = (typeof CONVERSATION_INTENTS)[number];

export type MailboxPurpose = {
  key: MailboxPurposeKey;
  label: string;
  description: string;
  /** Adressen rollen är avsedd för. Null för `other`, som inte är låst. */
  defaultAddress: string | null;
  /** Posten ska knytas till ett supportärende. */
  autoLinkTickets: boolean;
  /** Posten får kategoriseras som allmän fråga, offert eller samarbete. */
  allowsIntentCategories: boolean;
};

export const MAILBOX_PURPOSES: readonly MailboxPurpose[] = Object.freeze([
  Object.freeze({
    key: "support" as const,
    label: "Support",
    description: "Primär supportadress. Post hit blir supportärenden.",
    defaultAddress: "support@berryit.se",
    autoLinkTickets: true,
    allowsIntentCategories: false,
  }),
  Object.freeze({
    key: "info" as const,
    label: "Information",
    description: "Allmän företagskontakt: frågor, offertförfrågningar och samarbeten.",
    defaultAddress: "info@berryit.se",
    autoLinkTickets: false,
    allowsIntentCategories: true,
  }),
  Object.freeze({
    key: "other" as const,
    label: "Övrigt",
    description: "Övriga adresser. Varken ärendekoppling eller kategorisering.",
    defaultAddress: null,
    autoLinkTickets: false,
    allowsIntentCategories: false,
  }),
]);

export function mailboxPurpose(key: MailboxPurposeKey): MailboxPurpose {
  return MAILBOX_PURPOSES.find((p) => p.key === key) ?? MAILBOX_PURPOSES[2];
}

/** De två låsta adresserna, i den ordning de ska visas. */
export function lockedAddresses(): { address: string; purpose: MailboxPurpose }[] {
  return MAILBOX_PURPOSES.filter((p) => p.defaultAddress !== null).map((p) => ({
    address: p.defaultAddress as string,
    purpose: p,
  }));
}

/**
 * Är de två adresserna alias till samma fysiska brevlåda?
 *
 * Svaret avgör om hämtningen ska ske en gång eller två. Utan känt konto hos
 * leverantören är svaret nej – vi gissar inte, och hellre två hämtningar än
 * tappad post.
 */
export function sharesProviderAccount(a: Pick<Mailbox, "provider_account_key">, b: Pick<Mailbox, "provider_account_key">): boolean {
  return a.provider_account_key !== null && a.provider_account_key === b.provider_account_key;
}

/**
 * Vilka adresser får stå som avsändare?
 *
 * Bara de leverantören bekräftat. En adress som inte får skicka kan ändå ta
 * emot – det är det vanliga fallet för ett alias.
 */
export function sendableAddresses(mailboxes: Mailbox[]): string[] {
  return mailboxes.filter((m) => m.can_send_from && m.is_enabled).map((m) => m.address);
}

/* ------------------------------------------------------------ presentation */

export function channelLabel(key: ChannelKey): string {
  return { chat_customer: "Kundchatt", chat_internal: "Internchatt", email: "E-post" }[key] ?? key;
}

export function statusLabel(status: ConversationStatus): string {
  return { open: "Öppen", pending: "Väntar", closed: "Stängd" }[status] ?? status;
}

export function deliveryLabel(status: DeliveryStatus): string {
  return {
    draft: "Utkast",
    queued: "I kö",
    sent: "Skickat",
    delivered: "Levererat",
    failed: "Misslyckades",
    received: "Mottaget",
  }[status] ?? status;
}

/* ---------------------------------------------------------- läst och oläst */

/**
 * Olästa meddelanden för en deltagare.
 *
 * Egna meddelanden räknas aldrig som olästa – man har läst det man själv
 * skrivit. Utan `last_read_at` är allt oläst, vilket är rätt för en ny deltagare.
 */
export function unreadCount(
  messages: ConversationMessage[],
  participant: Pick<Participant, "last_read_at" | "profile_id"> | null,
): number {
  if (!participant) return 0;
  const sedan = participant.last_read_at ? Date.parse(participant.last_read_at) : 0;
  return messages.filter((m) => {
    if (participant.profile_id && m.author_id === participant.profile_id) return false;
    const t = Date.parse(m.created_at);
    return Number.isFinite(t) && t > sedan;
  }).length;
}

export function hasUnread(
  messages: ConversationMessage[],
  participant: Pick<Participant, "last_read_at" | "profile_id"> | null,
): boolean {
  return unreadCount(messages, participant) > 0;
}

/* ------------------------------------------------- synk, markör, återhämtning */

export type SyncCursor = { since: string | null; seen: Set<string> };

export function newCursor(): SyncCursor {
  return { since: null, seen: new Set() };
}

/**
 * Lägger in nyhämtade meddelanden i listan.
 *
 * Idempotent på id: samma meddelande kan komma två gånger efter en
 * återanslutning utan att visas dubbelt. Listan hålls sorterad i tidsordning,
 * eftersom ett meddelande som kommer sent ändå hör hemma där det hör hemma.
 */
export function mergeMessages(
  befintliga: ConversationMessage[],
  nya: ConversationMessage[],
  cursor: SyncCursor,
): { messages: ConversationMessage[]; cursor: SyncCursor; added: number } {
  const seen = new Set(cursor.seen);
  for (const m of befintliga) seen.add(m.id);

  const tillagda: ConversationMessage[] = [];
  for (const m of nya) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    tillagda.push(m);
  }

  const alla = [...befintliga, ...tillagda].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const senaste = alla.length > 0 ? alla[alla.length - 1].created_at : cursor.since;

  return { messages: alla, cursor: { since: senaste, seen }, added: tillagda.length };
}

/**
 * Hur länge en anslutning får vara tyst innan den räknas som bruten.
 * Används för att visa "återansluter…" i stället för att låtsas som ingenting.
 */
export const CONNECTION_TIMEOUT_SECONDS = 90;

export function connectionState(
  lastSyncAt: string | null,
  lastError: string | null,
  now = Date.now(),
): "live" | "reconnecting" | "error" | "unknown" {
  if (lastError) return "error";
  if (!lastSyncAt) return "unknown";
  const t = Date.parse(lastSyncAt);
  if (Number.isNaN(t)) return "unknown";
  return now - t > CONNECTION_TIMEOUT_SECONDS * 1000 ? "reconnecting" : "live";
}

export function connectionLabel(state: ReturnType<typeof connectionState>): string {
  return {
    live: "Ansluten",
    reconnecting: "Återansluter…",
    error: "Anslutningsfel",
    unknown: "Okänd",
  }[state];
}

/* ------------------------------------------------------------- inkorgsvyer */

export type InboxFilter = "alla" | "mina" | "otilldelade" | "chat" | "email" | "internt";

export function filterConversations(
  conversations: Conversation[],
  filter: InboxFilter,
  userId: string | null,
): Conversation[] {
  switch (filter) {
    case "mina":
      return conversations.filter((c) => c.assignee_id === userId);
    case "otilldelade":
      return conversations.filter((c) => !c.assignee_id && c.status !== "closed");
    case "chat":
      return conversations.filter((c) => c.channel_key === "chat_customer");
    case "email":
      return conversations.filter((c) => c.channel_key === "email");
    case "internt":
      return conversations.filter((c) => c.channel_key === "chat_internal");
    default:
      return conversations;
  }
}

/** Inkorgen sorteras efter senaste aktivitet, nyast först. */
export function sortByActivity(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) =>
    (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at),
  );
}

/* ------------------------------------------------------------ API-kontrakt */

export const COMM_TABLE = {
  channels: "comm_channels",
  mailboxes: "comm_mailboxes",
  conversations: "comm_conversations",
  participants: "comm_participants",
  messages: "comm_messages",
  attachments: "comm_attachments",
  events: "comm_events",
} as const;

export const COMM_SELECT = {
  conversation:
    "id, organization_id, channel_key, mailbox_id, subject, ticket_id, assignee_id, status, is_internal, external_thread_key, last_message_at, created_at",
  message:
    "id, organization_id, conversation_id, author_id, author_address, direction, body_text, body_safe_html, delivery_status, delivery_error, sender_verified, created_at",
  participant: "id, conversation_id, profile_id, external_address, participant_role, last_read_at",
  mailbox:
    "id, organization_id, address, provider_kind, secret_ref, access_mode, is_enabled, status, last_synced_at, last_error",
} as const;

export const COMM_LIMIT = {
  conversations: 200,
  messages: 500,
  participants: 200,
} as const;
