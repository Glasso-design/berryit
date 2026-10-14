/*
 * Läser kommunikationsdata till desktopklienten.
 *
 * Som allt annat går det genom PostgREST med användarens egen JWT. Klienten har
 * inga e-postcredentials, ingen service-role-nyckel och ingen direkt väg till
 * någon brevlåda – den läser det RLS lämnar ut och skriver bara sina egna
 * meddelanden.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMM_LIMIT, COMM_SELECT, COMM_TABLE } from "@berryit/shared/communications";
import type {
  Conversation,
  ConversationMessage,
  Mailbox,
  Participant,
} from "@berryit/shared/communications";

export type CommData = {
  conversations: Conversation[];
  participants: Participant[];
  /** Null när användaren saknar behörighet att se brevlådorna. */
  mailboxes: Mailbox[] | null;
};

export const TOM_KOMMUNIKATION: CommData = {
  conversations: [],
  participants: [],
  mailboxes: null,
};

export async function loadCommunications(supabase: SupabaseClient): Promise<CommData> {
  const [convRes, partRes, mailRes] = await Promise.all([
    supabase
      .from(COMM_TABLE.conversations)
      .select(COMM_SELECT.conversation)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(COMM_LIMIT.conversations),
    supabase.from(COMM_TABLE.participants).select(COMM_SELECT.participant).limit(COMM_LIMIT.participants),
    supabase.from(COMM_TABLE.mailboxes).select(COMM_SELECT.mailbox),
  ]);

  return {
    conversations: (convRes.data ?? []) as Conversation[],
    participants: (partRes.data ?? []) as Participant[],
    mailboxes: mailRes.error ? null : ((mailRes.data ?? []) as Mailbox[]),
  };
}

/**
 * Meddelanden i en konversation, eventuellt bara de som tillkommit sedan en
 * markör. Samma anrop används vid första laddningen och vid återhämtning efter
 * ett avbrott – skillnaden är bara markören.
 */
export async function loadMessages(
  supabase: SupabaseClient,
  conversationId: string,
  since: string | null = null,
): Promise<ConversationMessage[]> {
  // Keep PostgreSQL's full sub-millisecond precision in the PostgREST cursor.
  // Only a restricted timestamp/UUID grammar may enter an .or expression.
  const timestamp = (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
  const uuid = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
  if (since && !timestamp(since)) throw new Error("Ogiltig synkmarkör. Försök ladda konversationen igen.");
  const messages: ConversationMessage[] = [];
  let after: ConversationMessage | undefined;
  const positions = new Set<string>();
  for (;;) {
    let fraga = supabase.from(COMM_TABLE.messages).select(COMM_SELECT.message)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(COMM_LIMIT.messages);
    // Inclusive across polls: a newly inserted ID at the same timestamp may
    // sort BEFORE a previously seen ID. mergeMessages deduplicates the overlap.
    if (since) fraga = fraga.gte("created_at", since);
    if (after) fraga = fraga.or(
      `created_at.gt."${after.created_at}",and(created_at.eq."${after.created_at}",id.gt.${after.id})`,
    );
    const { data, error } = await fraga;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ConversationMessage[];
    if (!page.length) return messages;
    const last = page[page.length - 1];
    const position = `${last.created_at}/${last.id}`;
    if (!timestamp(last.created_at) || !uuid(last.id) || positions.has(position)) {
      throw new Error("Ofullständig meddelandehämtning. Försök ladda konversationen igen.");
    }
    positions.add(position);
    messages.push(...page);
    // Ask for the next page even after a short page: the API may have a lower
    // configured maximum than the requested limit. Only an empty page is final.
    after = last;
  }
}

/** Markerar konversationen som läst för den inloggade. */
export async function markRead(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<void> {
  await supabase
    .from(COMM_TABLE.participants)
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("profile_id", userId);
}

/**
 * Skickar ett meddelande i en konversation.
 *
 * Klienten sätter aldrig leveransstatus själv utöver kö: det är serverns sak
 * att avgöra om något verkligen gick fram.
 */
export async function sendMessage(
  supabase: SupabaseClient,
  {
    conversationId,
    organizationId,
    userId,
    body,
    internal = false,
  }: {
    conversationId: string;
    organizationId: string;
    userId: string;
    body: string;
    internal?: boolean;
  },
): Promise<{ error?: string }> {
  const { error } = await supabase.from(COMM_TABLE.messages).insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    author_id: userId,
    direction: internal ? "internal" : "outbound",
    body_text: body,
    delivery_status: "queued",
  });
  return error ? { error: error.message } : {};
}
