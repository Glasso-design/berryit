/*
 * Tester för e-postadaptern.
 *
 *   node services/communications/email-adapter.test.mjs
 *
 * Ingen leverantör, inget nätverk, inga mejl. Det som prövas är trådning,
 * dubblettskydd, HTML-sanering, avsändarkontroll och att läsläget håller.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EmailAdapter,
  EmailAdapterError,
  deliveredTo,
  groupByAccount,
  htmlToText,
  normalizeMessageId,
  nullProvider,
  parseAddress,
  parseReferences,
  sanitizeEmailHtml,
  replyFromFor,
  suggestIntent,
  threadKeyFor,
  verifySender,
} from "./email-adapter.mjs";

/* --------------------------------------------------------- normalisering */

test("Message-ID normaliseras", () => {
  assert.equal(normalizeMessageId("<ABC@Example.COM>"), "abc@example.com");
  assert.equal(normalizeMessageId("  <x@y.z>  "), "x@y.z");
  assert.equal(normalizeMessageId(""), null);
  assert.equal(normalizeMessageId(null), null);
  assert.equal(normalizeMessageId("<" + "a".repeat(500) + ">"), null, "orimligt långt id avvisas");
});

test("References blir en lista utan dubbletter", () => {
  assert.deepEqual(parseReferences("<a@x> <b@x>\n <a@x>"), ["a@x", "b@x"]);
  assert.deepEqual(parseReferences(null), []);
});

test("adressen plockas ur From, inte visningsnamnet", () => {
  assert.equal(parseAddress('"Kund, Viktig" <kund@example.test>'), "kund@example.test");
  assert.equal(parseAddress("kund@example.test"), "kund@example.test");
  assert.equal(parseAddress("support@berryit.se <lurendrejare@example.test>"), "lurendrejare@example.test");
  assert.equal(parseAddress("inte en adress"), null);
});

/* -------------------------------------------------------------- trådning */

test("tråden identifieras av det äldsta id:t i References", () => {
  assert.equal(
    threadKeyFor({ messageId: "<c@x>", inReplyTo: "<b@x>", references: "<a@x> <b@x>" }),
    "a@x",
  );
});

test("utan References används In-Reply-To", () => {
  assert.equal(threadKeyFor({ messageId: "<c@x>", inReplyTo: "<b@x>", references: null }), "b@x");
});

test("ett nytt samtal är sin egen tråd", () => {
  assert.equal(threadKeyFor({ messageId: "<ny@x>", inReplyTo: null, references: null }), "ny@x");
});

test("svar på ett svar hamnar i samma tråd som originalet", () => {
  const forsta = threadKeyFor({ messageId: "<1@x>" });
  const andra = threadKeyFor({ messageId: "<2@x>", inReplyTo: "<1@x>", references: "<1@x>" });
  const tredje = threadKeyFor({ messageId: "<3@x>", inReplyTo: "<2@x>", references: "<1@x> <2@x>" });
  assert.equal(forsta, "1@x");
  assert.equal(andra, "1@x");
  assert.equal(tredje, "1@x");
});

/* --------------------------------------------------------- HTML-sanering */

test("script, style och iframe försvinner med innehåll", () => {
  const ut = sanitizeEmailHtml('<p>hej</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe>');
  assert.ok(!ut.includes("alert"));
  assert.ok(!ut.toLowerCase().includes("<script"));
  assert.ok(!ut.toLowerCase().includes("<iframe"));
  assert.ok(ut.includes("hej"));
});

test("event-attribut tas bort", () => {
  const ut = sanitizeEmailHtml('<p onclick="stealEverything()">klicka</p>');
  assert.ok(!ut.includes("onclick"));
  assert.ok(ut.includes("klicka"));
});

test("javascript:-länkar blir ofarliga", () => {
  const ut = sanitizeEmailHtml('<a href="javascript:alert(1)">klicka</a>');
  assert.ok(!ut.toLowerCase().includes("javascript:"));
  assert.ok(ut.includes("<a>"));
});

test("externa länkar märks och får rel-attribut", () => {
  const ut = sanitizeEmailHtml('<a href="https://example.test/x">länk</a>');
  assert.ok(ut.includes('href="https://example.test/x"'));
  assert.ok(ut.includes('rel="noopener noreferrer nofollow"'));
  assert.ok(ut.includes('data-external="true"'));
});

test("bilder tas bort – en fjärrladdad bild är en spårpixel", () => {
  const ut = sanitizeEmailHtml('<p>hej</p><img src="https://spårning.test/p.gif" width="1">');
  assert.ok(!ut.toLowerCase().includes("<img"));
  assert.ok(ut.includes("[bild borttagen]"));
});

test("okända taggar försvinner men texten blir kvar", () => {
  const ut = sanitizeEmailHtml("<marquee>rör sig</marquee><custom-tag>text</custom-tag>");
  assert.ok(!ut.includes("marquee"));
  assert.ok(!ut.includes("custom-tag"));
  assert.ok(ut.includes("rör sig") && ut.includes("text"));
});

test("kommentarer med villkorlig markup försvinner", () => {
  const ut = sanitizeEmailHtml("<!--[if IE]><script>x()</script><![endif]--><p>ok</p>");
  assert.ok(!ut.includes("script"));
  assert.ok(ut.includes("ok"));
});

test("text plockas ur HTML", () => {
  assert.equal(htmlToText("<p>rad ett</p><p>rad två</p>"), "rad ett\nrad två");
  assert.equal(htmlToText("<p>a&nbsp;&amp;&nbsp;b</p>"), "a & b");
});

/* ---------------------------------------------------- avsändarkontroll */

test("känd avsändare bekräftas", () => {
  const ut = verifySender({
    fromHeader: "Kund <kund@example.test>",
    envelopeFrom: "kund@example.test",
    knownAddresses: ["kund@example.test"],
  });
  assert.equal(ut.verified, true);
  assert.equal(ut.address, "kund@example.test");
});

test("okänd avsändare blir obekräftad, inte avvisad", () => {
  const ut = verifySender({ fromHeader: "nyn@example.test", knownAddresses: ["kund@example.test"] });
  assert.equal(ut.verified, false);
  assert.match(ut.reason, /kända kontakter/);
  assert.equal(ut.address, "nyn@example.test", "adressen sparas ändå");
});

test("kuvert som inte matchar From är ett spoofingförsök", () => {
  const ut = verifySender({
    fromHeader: "vd@example.test",
    envelopeFrom: "angripare@example.invalid",
    knownAddresses: ["vd@example.test"],
  });
  assert.equal(ut.verified, false);
  assert.match(ut.reason, /Kuvertets avsändare/);
});

/* ----------------------------------------------------------- adaptern */

function fakeStore({ existing = new Set(), conversations = [] } = {}) {
  const skrivet = { messages: [], conversations: [], participants: [], events: [], mailbox: [] };
  return {
    skrivet,
    async knownAddresses() {
      return ["kund@example.test"];
    },
    async messageExists(org, messageId) {
      return existing.has(messageId);
    },
    async findConversationByThread(org, key) {
      return conversations.find((c) => c.external_thread_key === key) ?? null;
    },
    async createConversation(rad) {
      const c = { id: `conv-${conversations.length + 1}`, ...rad };
      conversations.push(c);
      skrivet.conversations.push(c);
      return c;
    },
    async addParticipant(rad) {
      skrivet.participants.push(rad);
    },
    async insertMessage(rad) {
      skrivet.messages.push(rad);
      existing.add(rad.external_message_id);
    },
    async recordEvent(rad) {
      skrivet.events.push(rad);
    },
    async touchMailbox(id, patch) {
      skrivet.mailbox.push({ id, ...patch });
    },
  };
}

const brevlada = (over = {}) => ({
  id: "mb-1",
  organization_id: "org-1",
  address: "support@berryit.se",
  display_name: "BERRYiT Support",
  purpose: "support",
  provider_account_key: null,
  can_send_from: false,
  is_enabled: true,
  access_mode: "read_only",
  ...over,
});

const infoBrevlada = (over = {}) =>
  brevlada({ id: "mb-2", address: "info@berryit.se", purpose: "info", display_name: "BERRYiT", ...over });

const mejl = (over = {}) => ({
  messageId: "<1@example.test>",
  from: "Kund <kund@example.test>",
  envelopeFrom: "kund@example.test",
  subject: "Skrivaren krånglar",
  text: "Den skriver inte ut.",
  html: null,
  ...over,
});

test("ett inkommande mejl blir en konversation och ett meddelande", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({ provider: { fetchSince: async () => [mejl()] }, store, mailbox: brevlada() });
  const ut = await adapter.sync();

  assert.equal(ut.imported, 1);
  assert.equal(ut.conversations, 1);
  assert.equal(store.skrivet.messages[0].direction, "inbound");
  assert.equal(store.skrivet.messages[0].sender_verified, true);
  assert.equal(store.skrivet.conversations[0].channel_key, "email");
  assert.equal(store.skrivet.events[0].event_type, "message_received");
});

test("samma mejl två gånger ger en konversation och inget dubbelmeddelande", async () => {
  const store = fakeStore();
  const provider = { fetchSince: async () => [mejl()] };
  const adapter = new EmailAdapter({ provider, store, mailbox: brevlada() });
  await adapter.sync();
  const andra = await adapter.sync();

  assert.equal(andra.imported, 0);
  assert.equal(andra.duplicates, 1);
  assert.equal(store.skrivet.messages.length, 1);
  assert.equal(store.skrivet.conversations.length, 1);
});

test("ett svar hamnar i den befintliga tråden", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: {
      fetchSince: async () => [
        mejl(),
        mejl({ messageId: "<2@example.test>", inReplyTo: "<1@example.test>", references: "<1@example.test>" }),
      ],
    },
    store,
    mailbox: brevlada(),
  });
  const ut = await adapter.sync();

  assert.equal(ut.imported, 2);
  assert.equal(ut.conversations, 1, "bara en konversation skapades");
  assert.equal(store.skrivet.messages[0].conversation_id, store.skrivet.messages[1].conversation_id);
});

test("mejl utan Message-ID hoppas över i stället för att skapa skräp", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: { fetchSince: async () => [mejl({ messageId: null })] },
    store,
    mailbox: brevlada(),
  });
  const ut = await adapter.sync();
  assert.equal(ut.imported, 0);
  assert.equal(ut.rejected, 1);
  assert.equal(store.skrivet.messages.length, 0);
});

test("okänd avsändare sparas som obekräftad", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: { fetchSince: async () => [mejl({ from: "okand@example.invalid", envelopeFrom: "okand@example.invalid" })] },
    store,
    mailbox: brevlada(),
  });
  await adapter.sync();
  assert.equal(store.skrivet.messages[0].sender_verified, false);
  assert.match(store.skrivet.events[0].detail.note, /kända kontakter/);
});

test("HTML saneras innan den sparas", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: {
      fetchSince: async () => [mejl({ text: null, html: '<p>hej</p><script>alert(1)</script>' })],
    },
    store,
    mailbox: brevlada(),
  });
  await adapter.sync();
  assert.ok(!store.skrivet.messages[0].body_safe_html.includes("script"));
  assert.equal(store.skrivet.messages[0].body_text, "hej");
});

test("en avstängd brevlåda hämtar ingenting", async () => {
  const store = fakeStore();
  let anropad = false;
  const adapter = new EmailAdapter({
    provider: {
      fetchSince: async () => {
        anropad = true;
        return [mejl()];
      },
    },
    store,
    mailbox: brevlada({ is_enabled: false }),
  });
  const ut = await adapter.sync();
  assert.equal(ut.skipped, true);
  assert.equal(anropad, false);
});

test("ett fel hos leverantören stoppar inte systemet men noteras", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: {
      fetchSince: async () => {
        throw new Error("imap nere");
      },
    },
    store,
    mailbox: brevlada(),
  });
  const ut = await adapter.sync();
  assert.equal(ut.imported, 0);
  assert.equal(ut.errors[0].code, "FETCH_FAILED");
});

test("ett trasigt mejl stoppar inte de andra", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: { fetchSince: async () => [mejl({ messageId: null }), mejl({ messageId: "<ok@example.test>" })] },
    store,
    mailbox: brevlada(),
  });
  const ut = await adapter.sync();
  assert.equal(ut.imported, 1);
  assert.equal(ut.rejected, 1);
});

test("läsläge vägrar skicka", async () => {
  const adapter = new EmailAdapter({
    provider: { fetchSince: async () => [], send: async () => ({ messageId: "<x@y>" }) },
    store: fakeStore(),
    mailbox: brevlada(),
  });
  await assert.rejects(adapter.send({ to: "kund@example.test" }), (e) => e.code === "SEND_REFUSED");
});

test("utan ansluten leverantör händer ingenting, och sändning vägras", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({ provider: nullProvider, store, mailbox: brevlada() });
  const ut = await adapter.sync();
  assert.equal(ut.imported, 0);
  // Avsändaren kontrolleras före leverantören: vi vill veta vilka vi är innan
  // vi försöker säga något.
  await assert.rejects(
    new EmailAdapter({
      provider: nullProvider,
      store,
      mailbox: brevlada({ access_mode: "read_send", can_send_from: true }),
    }).send({}),
    (e) => e instanceof EmailAdapterError && e.code === "NOT_CONNECTED",
  );
});

test("brevlådans status uppdateras efter körningen", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({ provider: { fetchSince: async () => [mejl()] }, store, mailbox: brevlada() });
  await adapter.sync();
  assert.equal(store.skrivet.mailbox[0].status, "connected");
  assert.equal(store.skrivet.mailbox[0].last_error, null);
});

/* ------------------------------------------------- support och info */

test("rollen avgör vad posten blir", () => {
  assert.equal(suggestIntent({ subject: "Hjälp" }, "support"), "support");
  // Infopost kategoriseras bara när signalen är tydlig – annars får en
  // människa avgöra.
  assert.equal(suggestIntent({ subject: "Hej" }, "info"), null);
  assert.equal(suggestIntent({ subject: "Begäran om offert" }, "info"), "quote");
  assert.equal(suggestIntent({ subject: "Förslag på samarbete" }, "info"), "partnership");
  assert.equal(suggestIntent({ subject: "Offert" }, "other"), null);
});

test("adressen posten kom till avgör brevlådan", () => {
  const adresser = ["support@berryit.se", "info@berryit.se"];
  assert.equal(deliveredTo({ deliveredTo: "info@berryit.se" }, adresser), "info@berryit.se");
  assert.equal(deliveredTo({ to: "Support <support@berryit.se>" }, adresser), "support@berryit.se");
  assert.equal(deliveredTo({ to: "nagon@example.test, info@berryit.se" }, adresser), "info@berryit.se");
  assert.equal(deliveredTo({ cc: "info@berryit.se" }, adresser), "info@berryit.se");
  assert.equal(deliveredTo({ to: "fel@example.test" }, adresser), null);
});

test("alias till samma konto hämtas en gång", () => {
  const grupper = groupByAccount([
    brevlada({ id: "a", address: "support@berryit.se", provider_account_key: "berryit-main" }),
    brevlada({ id: "b", address: "info@berryit.se", provider_account_key: "berryit-main" }),
    brevlada({ id: "c", address: "egen@example.test", provider_account_key: null }),
  ]);
  assert.equal(grupper.length, 2, "två konton, inte tre adresser");
  assert.equal(grupper.find((g) => g.accountKey === "konto:berryit-main").mailboxes.length, 2);
});

test("ett mejl till ett alias hamnar i rätt brevlåda och får rätt avsikt", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: {
      fetchSince: async () => [
        mejl({ messageId: "<s1@example.test>", deliveredTo: "support@berryit.se", subject: "Skrivaren" }),
        mejl({ messageId: "<i1@example.test>", deliveredTo: "info@berryit.se", subject: "Begäran om offert" }),
      ],
    },
    store,
    mailbox: brevlada({ provider_account_key: "berryit-main" }),
    aliases: [infoBrevlada({ provider_account_key: "berryit-main" })],
  });
  const ut = await adapter.sync();

  assert.equal(ut.imported, 2);
  assert.equal(ut.conversations, 2);
  const support = store.skrivet.conversations.find((c) => c.mailbox_id === "mb-1");
  const info = store.skrivet.conversations.find((c) => c.mailbox_id === "mb-2");
  assert.equal(support.intent, "support", "supportpost blir ett supportärende");
  assert.equal(info.intent, "quote", "offertförfrågan känns igen");
});

test("samma mejl via två alias importeras bara en gång", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: {
      fetchSince: async () => [
        mejl({ messageId: "<delat@example.test>", deliveredTo: "support@berryit.se" }),
        // Samma fysiska brevlåda lämnar ut samma mejl igen, adresserat till aliaset.
        mejl({ messageId: "<delat@example.test>", deliveredTo: "info@berryit.se" }),
      ],
    },
    store,
    mailbox: brevlada({ provider_account_key: "berryit-main" }),
    aliases: [infoBrevlada({ provider_account_key: "berryit-main" })],
  });
  const ut = await adapter.sync();

  assert.equal(ut.imported, 1);
  assert.equal(ut.duplicates, 1);
  assert.equal(store.skrivet.conversations.length, 1);
});

test("okänd mottagaradress hamnar i brevlådan vi hämtade från", async () => {
  const store = fakeStore();
  const adapter = new EmailAdapter({
    provider: { fetchSince: async () => [mejl({ deliveredTo: "nagon.annan@example.test" })] },
    store,
    mailbox: brevlada(),
  });
  await adapter.sync();
  assert.equal(store.skrivet.conversations[0].mailbox_id, "mb-1");
});

test("avsändaradress kräver verifierad behörighet hos leverantören", () => {
  assert.throws(() => replyFromFor(brevlada()), (e) => e.code === "SENDER_NOT_VERIFIED");
  assert.equal(
    replyFromFor(brevlada({ can_send_from: true })),
    "BERRYiT Support <support@berryit.se>",
  );
  assert.equal(
    replyFromFor(brevlada({ can_send_from: true, display_name: "" })),
    "support@berryit.se",
  );
});

test("sändning vägras från en overifierad adress även i sändläge", async () => {
  const adapter = new EmailAdapter({
    provider: { fetchSince: async () => [], send: async () => ({ messageId: "<x@y>" }) },
    store: fakeStore(),
    mailbox: brevlada({ access_mode: "read_send", can_send_from: false }),
  });
  await assert.rejects(adapter.send({ to: "kund@example.test" }), (e) => e.code === "SENDER_NOT_VERIFIED");
});

test("i sändläge med verifierad adress sätts From av adaptern", async () => {
  let skickat = null;
  const adapter = new EmailAdapter({
    provider: {
      fetchSince: async () => [],
      send: async (m) => {
        skickat = m;
        return { messageId: "<x@y>" };
      },
    },
    store: fakeStore(),
    mailbox: brevlada({ access_mode: "read_send", can_send_from: true }),
  });
  await adapter.send({ to: "kund@example.test", text: "svar" });
  assert.equal(skickat.from, "BERRYiT Support <support@berryit.se>");
});
