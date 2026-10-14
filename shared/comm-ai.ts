/*
 * Kontrakt för AI-assisterad kommunikation.
 *
 * Fyra saker en användare kan be ONARLY AI om: en sammanfattning, ett
 * svarsförslag, ett förslag på supportärende, eller ett förslag på
 * kunskapsartikel.
 *
 * Reglerna är desamma som för incidenter (se incident-ai.ts), men här är
 * insatsen högre: en konversation innehåller kundens egna ord, adresser och
 * ibland uppgifter de inte vill ha vidare. Därför:
 *
 *   1. Ingenting skickas automatiskt. `mayShareConversation` kräver ett
 *      uttryckligt godkännande, och godkännandet gäller en konversation och en
 *      fråga – inte en gång för alla.
 *   2. Bara det användaren redan får se. Paketet byggs av rader RLS lämnat ut.
 *   3. Adresser, nycklar och interna länkar tvättas bort innan något lämnar
 *      huset. Interna meddelanden tas aldrig med i ett kundsvar.
 *   4. AI får föreslå. Den skickar aldrig ett mejl eller ett chattmeddelande –
 *      det finns ingen väg i kontraktet som gör det.
 */
import type { Conversation, ConversationMessage } from "./communications";
import { sanitize } from "./incident-ai";

export const AI_REQUESTS = ["summarize", "suggest_reply", "suggest_ticket", "suggest_article"] as const;
export type AiRequestKind = (typeof AI_REQUESTS)[number];

export function requestLabel(kind: AiRequestKind): string {
  return {
    summarize: "Sammanfatta konversationen",
    suggest_reply: "Föreslå ett svar",
    suggest_ticket: "Föreslå ett supportärende",
    suggest_article: "Föreslå en kunskapsartikel",
  }[kind];
}

export type CommAiMessage = {
  role: "customer" | "staff" | "external";
  body: string;
  at: string;
  /** Falskt betyder obekräftad avsändare – mottagaren ska veta det. */
  sender_verified: boolean;
};

export type CommAiBundle = {
  contract_version: 1;
  request: AiRequestKind;
  conversation: {
    id: string;
    channel: string;
    subject: string;
    status: string;
    message_count: number;
    opened_at: string;
  };
  context: {
    organization: string;
    ticket_reference: string | null;
  };
  messages: CommAiMessage[];
  /** Vad mottagaren inte har fått, så att ett svar inte vilar på tyst saknad data. */
  omitted: string[];
};

/**
 * Bygger paketet. Rena data in, rena data ut – inga anrop, ingen överföring.
 *
 * Interna meddelanden utelämnas alltid när frågan gäller ett kundsvar: ett
 * förslag får inte råka citera det teknikerna sagt till varandra.
 */
export function buildConversationAiBundle({
  request,
  conversation,
  messages,
  organizationName,
  ticketReference = null,
  maxMessages = 50,
}: {
  request: AiRequestKind;
  conversation: Conversation;
  messages: ConversationMessage[];
  organizationName: string;
  ticketReference?: string | null;
  maxMessages?: number;
}): CommAiBundle {
  const kundsvar = request === "suggest_reply" || request === "suggest_article";
  const omitted: string[] = [];

  let urval = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));

  if (kundsvar) {
    const fore = urval.length;
    urval = urval.filter((m) => m.direction !== "internal");
    if (urval.length < fore) {
      omitted.push(`${fore - urval.length} interna meddelanden ingår inte i underlaget för ett kundsvar.`);
    }
  }

  if (urval.length > maxMessages) {
    omitted.push(`Endast de ${maxMessages} senaste meddelandena ingår av ${urval.length}.`);
    urval = urval.slice(-maxMessages);
  }

  if (urval.some((m) => !m.sender_verified && m.direction === "inbound")) {
    omitted.push("Minst ett inkommande meddelande har obekräftad avsändare och är märkt som sådant.");
  }
  omitted.push("E-postadresser, länkar och nycklar är borttagna ur texten.");
  if (conversation.is_internal) omitted.push("Konversationen är intern och innehåller inga kundmeddelanden.");

  return {
    contract_version: 1,
    request,
    conversation: {
      id: conversation.id,
      channel: conversation.channel_key,
      // sanitizeMessage, inte sanitize: ämnesraden innehåller ofta en adress
      // ("Svar till kund@…"), och sanitize ensam tar bara länkar och nycklar.
      subject: sanitizeMessage(conversation.subject),
      status: conversation.status,
      message_count: urval.length,
      opened_at: conversation.created_at,
    },
    context: {
      organization: organizationName,
      ticket_reference: ticketReference,
    },
    messages: urval.map((m) => ({
      role: m.direction === "internal" ? "staff" : m.direction === "outbound" ? "staff" : "customer",
      body: sanitizeMessage(m.body_text),
      at: m.created_at,
      sender_verified: m.sender_verified,
    })),
    omitted,
  };
}

/** Tvättar ett meddelande: adresser, nycklar och länkar ut. */
export function sanitizeMessage(text: string): string {
  let ut = sanitize(text);
  // sanitize() tar adresser i URL-form; e-postadresser hanteras här.
  ut = ut.replace(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/g, "[dold adress]");
  return ut;
}

/** Fält som aldrig får följa med. Används av tester och av gränssnittet. */
const NEVER_SHARE = ["author_address", "external_address", "secret_ref", "token", "external_message_id"];

export function bundleLeaks(bundle: CommAiBundle): string[] {
  const text = JSON.stringify(bundle);
  const funna = NEVER_SHARE.filter((f) => text.includes(`"${f}"`));
  // En kvarlämnad e-postadress är lika allvarlig som ett fält med fel namn.
  if (/[^\s@"]+@[^\s@"]+\.[^\s@",}]{2,}/.test(text)) funna.push("e-postadress i klartext");
  return funna;
}

/**
 * Får underlaget delas?
 *
 * Godkännandet gäller en bestämd konversation och en bestämd fråga. Ett
 * godkännande för "sammanfatta" är inte ett godkännande för "föreslå svar",
 * och inte heller för nästa konversation.
 */
export function mayShareConversation(
  bundle: CommAiBundle,
  consent: { conversationId: string; request: AiRequestKind; confirmed: boolean } | null,
): { ok: boolean; reason?: string } {
  if (!consent?.confirmed) return { ok: false, reason: "Användaren har inte godkänt att konversationen delas." };
  if (consent.conversationId !== bundle.conversation.id) {
    return { ok: false, reason: "Godkännandet gäller en annan konversation." };
  }
  if (consent.request !== bundle.request) {
    return { ok: false, reason: "Godkännandet gäller en annan fråga." };
  }
  const lackor = bundleLeaks(bundle);
  if (lackor.length > 0) return { ok: false, reason: `Underlaget innehåller uppgifter som inte får delas: ${lackor.join(", ")}` };
  return { ok: true };
}

/**
 * Vad AI:n får göra med svaret.
 *
 * Förslag är förslag. Det finns ingen funktion här som skickar, och det är
 * avsiktligt: en människa ska läsa och trycka på knappen.
 */
export const AI_CAPABILITIES = Object.freeze({
  suggest: true,
  send: false,
  modifyTicket: false,
  contactCustomer: false,
});
