/*
 * Tester för kommunikationens delade kontrakt.
 *
 * Det viktigaste: att synkmarkören tål avbrott utan att tappa eller dubblera
 * meddelanden, att läst/oläst räknas rätt, och att AI-underlaget varken läcker
 * adresser eller kan skickas utan ett godkännande som gäller just den frågan.
 */
import { describe, expect, it } from "vitest";
import {
  CHANNEL_KEYS,
  channelLabel,
  connectionLabel,
  connectionState,
  deliveryLabel,
  CONVERSATION_INTENTS,
  filterConversations,
  hasUnread,
  lockedAddresses,
  MAILBOX_PURPOSES,
  mailboxPurpose,
  mergeMessages,
  newCursor,
  sendableAddresses,
  sharesProviderAccount,
  sortByActivity,
  statusLabel,
  unreadCount,
} from "@berryit/shared/communications";
import type { Conversation, ConversationMessage, Mailbox } from "@berryit/shared/communications";
import {
  AI_CAPABILITIES,
  AI_REQUESTS,
  buildConversationAiBundle,
  bundleLeaks,
  mayShareConversation,
  requestLabel,
  sanitizeMessage,
} from "@berryit/shared/comm-ai";

const NU = Date.parse("2026-10-14T12:00:00Z");
const vid = (sekunderSedan: number) => new Date(NU - sekunderSedan * 1000).toISOString();

const konv = (over: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  organization_id: "org-1",
  channel_key: "email",
  mailbox_id: null,
  subject: "Skrivaren krånglar",
  ticket_id: null,
  assignee_id: null,
  status: "open",
  is_internal: false,
  external_thread_key: "a@x",
  last_message_at: vid(60),
  created_at: vid(3600),
  ...over,
});

const medd = (over: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: Math.random().toString(36).slice(2),
  organization_id: "org-1",
  conversation_id: "c1",
  author_id: null,
  author_address: "kund@example.test",
  direction: "inbound",
  body_text: "Den skriver inte ut.",
  body_safe_html: null,
  delivery_status: "received",
  delivery_error: null,
  sender_verified: true,
  created_at: vid(120),
  ...over,
});

describe("kanaler och etiketter", () => {
  it("har tre kanaler", () => {
    expect(CHANNEL_KEYS).toEqual(["chat_customer", "chat_internal", "email"]);
    expect(channelLabel("chat_internal")).toBe("Internchatt");
    expect(statusLabel("pending")).toBe("Väntar");
    expect(deliveryLabel("failed")).toBe("Misslyckades");
  });
});

describe("synk och återhämtning", () => {
  it("lägger till nya meddelanden och flyttar markören", () => {
    const a = medd({ id: "m1", created_at: vid(300) });
    const b = medd({ id: "m2", created_at: vid(200) });
    const ut = mergeMessages([a], [b], newCursor());
    expect(ut.added).toBe(1);
    expect(ut.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(ut.cursor.since).toBe(b.created_at);
  });

  it("samma meddelande två gånger visas en gång", () => {
    const a = medd({ id: "m1", created_at: vid(300) });
    const forsta = mergeMessages([], [a], newCursor());
    const andra = mergeMessages(forsta.messages, [a], forsta.cursor);
    expect(andra.added).toBe(0);
    expect(andra.messages).toHaveLength(1);
  });

  it("ett avbrott tappar ingenting – allt sedan markören kommer med", () => {
    const start = mergeMessages([], [medd({ id: "m1", created_at: vid(300) })], newCursor());
    // Anslutningen bryts. Två meddelanden tillkommer medan klienten är borta.
    const efter = mergeMessages(
      start.messages,
      [medd({ id: "m2", created_at: vid(200) }), medd({ id: "m3", created_at: vid(100) })],
      start.cursor,
    );
    expect(efter.added).toBe(2);
    expect(efter.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("ett meddelande som kommer sent hamnar ändå i rätt ordning", () => {
    const start = mergeMessages([], [medd({ id: "sen", created_at: vid(100) })], newCursor());
    const ut = mergeMessages(start.messages, [medd({ id: "tidig", created_at: vid(500) })], start.cursor);
    expect(ut.messages.map((m) => m.id)).toEqual(["tidig", "sen"]);
  });
});

describe("anslutningsläge", () => {
  it("nyss synkad är ansluten", () => {
    expect(connectionState(vid(10), null, NU)).toBe("live");
  });
  it("tyst för länge är återansluter", () => {
    expect(connectionState(vid(300), null, NU)).toBe("reconnecting");
    expect(connectionLabel("reconnecting")).toBe("Återansluter…");
  });
  it("ett fel är ett fel, inte tystnad", () => {
    expect(connectionState(vid(10), "imap nere", NU)).toBe("error");
  });
  it("utan synk alls är läget okänt", () => {
    expect(connectionState(null, null, NU)).toBe("unknown");
  });
});

describe("läst och oläst", () => {
  const deltagare = { profile_id: "u1", last_read_at: vid(150) };

  it("räknar bara det som kommit efter senaste läsning", () => {
    const m = [medd({ created_at: vid(300) }), medd({ created_at: vid(100) }), medd({ created_at: vid(50) })];
    expect(unreadCount(m, deltagare)).toBe(2);
    expect(hasUnread(m, deltagare)).toBe(true);
  });

  it("det man själv skrivit är aldrig oläst", () => {
    const m = [medd({ created_at: vid(50), author_id: "u1", direction: "outbound" })];
    expect(unreadCount(m, deltagare)).toBe(0);
  });

  it("en ny deltagare utan lästidpunkt har allt oläst", () => {
    const m = [medd({ created_at: vid(300) }), medd({ created_at: vid(50) })];
    expect(unreadCount(m, { profile_id: "u2", last_read_at: null })).toBe(2);
  });

  it("utan deltagarskap finns inget oläst att räkna", () => {
    expect(unreadCount([medd()], null)).toBe(0);
  });
});

describe("inkorgsfilter", () => {
  const alla = [
    konv({ id: "a", assignee_id: "u1", channel_key: "email" }),
    konv({ id: "b", assignee_id: null, channel_key: "chat_customer" }),
    konv({ id: "c", assignee_id: null, status: "closed", channel_key: "email" }),
    konv({ id: "d", assignee_id: "u2", channel_key: "chat_internal", is_internal: true }),
  ];

  it("mina visar bara de jag äger", () => {
    expect(filterConversations(alla, "mina", "u1").map((c) => c.id)).toEqual(["a"]);
  });

  it("ej tilldelade utelämnar stängda", () => {
    expect(filterConversations(alla, "otilldelade", "u1").map((c) => c.id)).toEqual(["b"]);
  });

  it("kanalfiltren håller isär chatt, e-post och internt", () => {
    expect(filterConversations(alla, "chat", "u1").map((c) => c.id)).toEqual(["b"]);
    expect(filterConversations(alla, "email", "u1").map((c) => c.id)).toEqual(["a", "c"]);
    expect(filterConversations(alla, "internt", "u1").map((c) => c.id)).toEqual(["d"]);
  });

  it("sorterar efter senaste aktivitet", () => {
    const ut = sortByActivity([
      konv({ id: "gammal", last_message_at: vid(5000) }),
      konv({ id: "ny", last_message_at: vid(10) }),
    ]);
    expect(ut.map((c) => c.id)).toEqual(["ny", "gammal"]);
  });
});

describe("AI-underlag", () => {
  const meddelanden = [
    medd({ id: "m1", body_text: "Hej, skrivaren på kontoret svarar inte.", created_at: vid(500) }),
    medd({
      id: "m2",
      direction: "internal",
      author_id: "u1",
      author_address: null,
      body_text: "Kunden har betalningsanmärkning, ta det försiktigt.",
      created_at: vid(400),
    }),
    medd({
      id: "m3",
      direction: "outbound",
      author_id: "u1",
      author_address: null,
      body_text: "Vi tittar på det.",
      created_at: vid(300),
    }),
  ];

  it("en sammanfattning får med allt, även internt", () => {
    const b = buildConversationAiBundle({
      request: "summarize",
      conversation: konv(),
      messages: meddelanden,
      organizationName: "Kund A AB",
    });
    expect(b.messages).toHaveLength(3);
  });

  it("ett kundsvar får ALDRIG med interna meddelanden", () => {
    const b = buildConversationAiBundle({
      request: "suggest_reply",
      conversation: konv(),
      messages: meddelanden,
      organizationName: "Kund A AB",
    });
    expect(b.messages).toHaveLength(2);
    expect(JSON.stringify(b)).not.toContain("betalningsanmärkning");
    expect(b.omitted.some((o) => o.includes("interna meddelanden"))).toBe(true);
  });

  it("adresser och nycklar tvättas ur texten", () => {
    expect(sanitizeMessage("skriv till kund@example.test")).toBe("skriv till [dold adress]");
    expect(sanitizeMessage("se https://intern.test/x")).toBe("se [dold adress]");
    expect(sanitizeMessage("nyckeln ghp_0123456789abcdefghij")).toBe("nyckeln [dold nyckel]");
  });

  it("underlaget läcker inga adresser", () => {
    const b = buildConversationAiBundle({
      request: "summarize",
      conversation: konv({ subject: "Svar till kund@example.test" }),
      messages: [medd({ body_text: "Hör av dig till chef@example.test" })],
      organizationName: "Kund A AB",
    });
    expect(bundleLeaks(b)).toEqual([]);
  });

  it("obekräftade avsändare märks i underlaget", () => {
    const b = buildConversationAiBundle({
      request: "summarize",
      conversation: konv(),
      messages: [medd({ sender_verified: false })],
      organizationName: "Kund A AB",
    });
    expect(b.messages[0].sender_verified).toBe(false);
    expect(b.omitted.some((o) => o.includes("obekräftad"))).toBe(true);
  });

  it("delning kräver ett godkännande", () => {
    const b = buildConversationAiBundle({
      request: "summarize",
      conversation: konv(),
      messages: meddelanden,
      organizationName: "Kund A AB",
    });
    expect(mayShareConversation(b, null).ok).toBe(false);
    expect(mayShareConversation(b, { conversationId: "c1", request: "summarize", confirmed: true }).ok).toBe(true);
  });

  it("ett godkännande gäller en konversation och en fråga", () => {
    const b = buildConversationAiBundle({
      request: "summarize",
      conversation: konv(),
      messages: meddelanden,
      organizationName: "Kund A AB",
    });
    const annanKonversation = mayShareConversation(b, {
      conversationId: "c9",
      request: "summarize",
      confirmed: true,
    });
    expect(annanKonversation.ok).toBe(false);
    expect(annanKonversation.reason).toMatch(/annan konversation/);

    const annanFraga = mayShareConversation(b, { conversationId: "c1", request: "suggest_reply", confirmed: true });
    expect(annanFraga.ok).toBe(false);
    expect(annanFraga.reason).toMatch(/annan fråga/);
  });

  it("AI får föreslå men aldrig skicka", () => {
    expect(AI_CAPABILITIES).toEqual({ suggest: true, send: false, modifyTicket: false, contactCustomer: false });
    expect(AI_REQUESTS).toEqual(["summarize", "suggest_reply", "suggest_ticket", "suggest_article"]);
    expect(requestLabel("suggest_ticket")).toBe("Föreslå ett supportärende");
  });
});

/*
 * Den låsta e-poststrukturen.
 *
 * Två adresser, två olika sorters post. Det som prövas här är att skillnaden
 * står i kontraktet och inte i en mening i gränssnittet, och att aliasfallet –
 * båda adresserna på samma konto hos leverantören – går att se skillnad på.
 */
describe("e-poststrukturen", () => {
  const brevlada = (over: Partial<Mailbox> = {}): Mailbox => ({
    id: "mb-1",
    organization_id: "org-1",
    address: "support@berryit.se",
    provider_kind: "none",
    secret_ref: "mailbox_support_berryit",
    access_mode: "read_only",
    is_enabled: true,
    purpose: "support",
    provider_account_key: null,
    can_send_from: false,
    status: "not_configured",
    last_synced_at: null,
    last_error: null,
    ...over,
  });

  it("support är supportadressen och knyts till ärenden", () => {
    const p = mailboxPurpose("support");
    expect(p.defaultAddress).toBe("support@berryit.se");
    expect(p.autoLinkTickets).toBe(true);
    expect(p.allowsIntentCategories).toBe(false);
  });

  it("info är den allmänna adressen och får kategoriseras", () => {
    const p = mailboxPurpose("info");
    expect(p.defaultAddress).toBe("info@berryit.se");
    expect(p.autoLinkTickets).toBe(false);
    expect(p.allowsIntentCategories).toBe(true);
  });

  it("de två låsta adresserna är precis två, i rätt ordning", () => {
    expect(lockedAddresses().map((l) => l.address)).toEqual(["support@berryit.se", "info@berryit.se"]);
  });

  it("en okänd roll faller tillbaka på övrigt i stället för att krascha", () => {
    // @ts-expect-error – avsiktligt fel värde, som om databasen fått en ny roll
    expect(mailboxPurpose("marknad").key).toBe("other");
  });

  it("kategorierna är de fyra vi bestämt", () => {
    expect(CONVERSATION_INTENTS).toEqual(["support", "general", "quote", "partnership"]);
  });

  it("inget i kontraktet nämner en leverantör", () => {
    const text = JSON.stringify(MAILBOX_PURPOSES).toLowerCase();
    for (const namn of ["imap", "smtp", "gmail", "outlook", "graph", "exchange", "sendgrid"]) {
      expect(text).not.toContain(namn);
    }
  });

  it("samma konto hos leverantören betyder alias", () => {
    const support = brevlada({ provider_account_key: "konto-1" });
    const info = brevlada({ id: "mb-2", address: "info@berryit.se", purpose: "info", provider_account_key: "konto-1" });
    expect(sharesProviderAccount(support, info)).toBe(true);
  });

  it("okänt konto gissas aldrig till alias", () => {
    const a = brevlada({ provider_account_key: null });
    const b = brevlada({ id: "mb-2", address: "info@berryit.se", provider_account_key: null });
    expect(sharesProviderAccount(a, b)).toBe(false);
  });

  it("olika konton är två brevlådor", () => {
    const a = brevlada({ provider_account_key: "konto-1" });
    const b = brevlada({ id: "mb-2", address: "info@berryit.se", provider_account_key: "konto-2" });
    expect(sharesProviderAccount(a, b)).toBe(false);
  });

  it("bara adresser med bekräftad sändrätt får stå som avsändare", () => {
    const support = brevlada({ can_send_from: true });
    const info = brevlada({ id: "mb-2", address: "info@berryit.se", purpose: "info", can_send_from: false });
    expect(sendableAddresses([support, info])).toEqual(["support@berryit.se"]);
  });

  it("en avstängd brevlåda får inte skicka ens med sändrätt", () => {
    const support = brevlada({ can_send_from: true, is_enabled: false });
    expect(sendableAddresses([support])).toEqual([]);
  });
});
