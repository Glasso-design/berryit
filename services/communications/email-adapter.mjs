/*
 * Leverantörsoberoende e-postadapter.
 *
 * Adaptern vet hur ett mejl blir ett meddelande i BERRYiT. Den vet inte vilken
 * leverantör det kom från: en provider är ett litet objekt med `fetchSince` och
 * `send`, och adaptern bryr sig bara om formen på det den får tillbaka. Det gör
 * att IMAP, Microsoft Graph eller Gmail API kan bytas utan att något av det här
 * skrivs om – och att allt går att testa utan nätverk.
 *
 * Vad som gäller i den här versionen
 * ----------------------------------
 *   • Ingen riktig leverantör är ansluten och inga mejl skickas. `send` finns i
 *     kontraktet men vägrar i läsläge, vilket är det enda läget som går att
 *     konfigurera i databasen i dag.
 *   • Alla hemligheter stannar på servern. Adaptern tar emot dem som argument
 *     och lämnar dem aldrig vidare i något den returnerar.
 *
 * Fyra saker den gör noga
 * -----------------------
 *   1. Trådning via Message-ID, In-Reply-To och References.
 *   2. Dubblettskydd: samma Message-ID hämtas aldrig in två gånger.
 *   3. HTML saneras innan den sparas – aldrig körbar markup, aldrig fjärrladdade
 *      bilder, och externa länkar märks.
 *   4. Avsändaren kontrolleras mot kända kontakter. Stämmer den inte markeras
 *      meddelandet som obekräftat i stället för att tyst knytas till en kund.
 */

export class EmailAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EmailAdapterError";
    this.code = code;
  }
}

/* ------------------------------------------------------------- normalisering */

/** Message-ID utan vinkelparenteser och skiftlägesnormaliserat. */
export function normalizeMessageId(raw) {
  if (!raw) return null;
  const text = String(raw).trim().replace(/^<|>$/g, "").trim();
  if (!text || text.length > 400) return null;
  return text.toLowerCase();
}

/** References är en lista med Message-ID. Ordningen är äldst först. */
export function parseReferences(raw) {
  if (!raw) return [];
  const list = String(raw)
    .split(/\s+/)
    .map((r) => normalizeMessageId(r))
    .filter(Boolean);
  return [...new Set(list)].slice(0, 50);
}

/** Adressen ur ett From-fält, utan visningsnamn. Visningsnamn ljuger ofta. */
export function parseAddress(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const inom = text.match(/<([^>]+)>/);
  const adress = (inom ? inom[1] : text).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adress) && adress.length <= 254 ? adress : null;
}

/**
 * Trådnyckeln: det äldsta Message-ID vi känner till i tråden.
 *
 * References håller hela kedjan och är därför den bästa källan. Saknas den
 * används In-Reply-To, och i sista hand meddelandets eget id – ett nytt samtal
 * är sin egen tråd.
 */
export function threadKeyFor({ messageId, inReplyTo, references }) {
  const kedja = parseReferences(references);
  if (kedja.length > 0) return kedja[0];
  const svar = normalizeMessageId(inReplyTo);
  if (svar) return svar;
  return normalizeMessageId(messageId);
}

/* -------------------------------------------------------------- HTML-sanering */

const TILLATNA_TAGGAR = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "ul", "ol", "li", "blockquote",
  "pre", "code", "h1", "h2", "h3", "h4", "span", "div", "a", "table", "thead",
  "tbody", "tr", "td", "th", "hr",
]);

/**
 * Gör e-post-HTML ofarlig att visa.
 *
 * Vi tar bort allt som kan köra kod eller läcka att mejlet öppnats:
 * script, style, iframe, object, event-attribut, javascript:-länkar och
 * fjärrladdade bilder (spårpixlar). Kvarvarande länkar får rel-attribut och
 * märks som externa, så att mottagaren ser vart de går.
 *
 * Det här är en konservativ sanering, inte en komplett HTML-parser: allt som
 * inte uttryckligen är tillåtet tas bort.
 */
export function sanitizeEmailHtml(html) {
  if (!html) return "";
  let ut = String(html);

  // Hela element med innehåll som aldrig ska visas.
  ut = ut.replace(/<(script|style|iframe|object|embed|applet|form|noscript)\b[\s\S]*?<\/\1\s*>/gi, "");
  // Samma taggar utan stängning.
  ut = ut.replace(/<\/?(script|style|iframe|object|embed|applet|form|noscript)\b[^>]*>/gi, "");
  // Kommentarer kan dölja villkorlig markup.
  ut = ut.replace(/<!--[\s\S]*?-->/g, "");
  // Bilder tas bort helt: en fjärrladdad bild berättar för avsändaren att
  // mejlet öppnats, och säger inget om innehållet.
  ut = ut.replace(/<img\b[^>]*>/gi, "[bild borttagen]");

  // Attribut: ta bort allt som kan köra kod eller peka utanför.
  ut = ut.replace(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (hela, tagg, attribut) => {
    const namn = tagg.toLowerCase();
    if (!TILLATNA_TAGGAR.has(namn)) return "";
    if (namn !== "a") return `<${namn}>`;

    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attribut);
    const adress = (href?.[2] ?? href?.[3] ?? href?.[4] ?? "").trim();
    if (!/^https?:\/\//i.test(adress)) return "<a>";
    const sakker = adress.replace(/"/g, "&quot;").slice(0, 2000);
    return `<a href="${sakker}" rel="noopener noreferrer nofollow" target="_blank" data-external="true">`;
  });

  // Stängande taggar som inte är tillåtna försvinner också.
  ut = ut.replace(/<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>/g, (hela, tagg) =>
    TILLATNA_TAGGAR.has(tagg.toLowerCase()) ? `</${tagg.toLowerCase()}>` : "",
  );

  return ut.slice(0, 400000);
}

/** Ren text ur HTML, för sökning och för den som hellre läser text. */
export function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 100000);
}

/* ------------------------------------------------------------ avsändarkontroll */

/**
 * Kan avsändaren knytas till en känd kontakt?
 *
 * Ett mejl bevisar inte vem som skrev det. Vi jämför kuvertets avsändare med
 * From-huvudet och mot kända kontakter i organisationen. Stämmer allt märks
 * meddelandet som bekräftat; annars som obekräftat – aldrig som falskt, för vi
 * vet inte det heller.
 */
export function verifySender({ fromHeader, envelopeFrom, knownAddresses = [] }) {
  const from = parseAddress(fromHeader);
  const envelope = parseAddress(envelopeFrom);
  const kanda = new Set(knownAddresses.map((a) => String(a).toLowerCase()));

  if (!from) return { address: null, verified: false, reason: "Avsändaradressen gick inte att tolka." };
  if (envelope && envelope !== from) {
    return {
      address: from,
      verified: false,
      reason: `Kuvertets avsändare (${envelope}) skiljer sig från From-huvudet.`,
    };
  }
  if (!kanda.has(from)) {
    return { address: from, verified: false, reason: "Avsändaren finns inte bland organisationens kända kontakter." };
  }
  return { address: from, verified: true, reason: null };
}

/* ------------------------------------------------------- adresser och roller */

/**
 * Vilken av våra adresser mejlet kom till.
 *
 * Ett mejl till support@ och ett till info@ kan landa i samma fysiska brevlåda.
 * Rollen avgörs av adressen det skickades till, inte av vilket konto vi råkade
 * hämta det från. Delivered-To väger tyngst, därefter To och Cc.
 */
export function deliveredTo(mail, addresses = []) {
  const kanda = new Map(addresses.map((a) => [String(a).toLowerCase(), a]));
  const kandidater = [mail?.deliveredTo, mail?.to, mail?.cc]
    .flat()
    .filter(Boolean)
    .flatMap((f) => String(f).split(","))
    .map((f) => parseAddress(f))
    .filter(Boolean);

  for (const adress of kandidater) {
    if (kanda.has(adress)) return kanda.get(adress);
  }
  return null;
}

/**
 * Grupperar brevlådor efter fysiskt konto.
 *
 * Alias delar provider_account_key och hämtas en gång. Utan det här skulle ett
 * mejl till ett alias hämtas en gång per adress, och dubblettskyddet skulle få
 * städa upp efter oss – det fungerar, men att hämta samma post två gånger är
 * slöseri och gör loggarna svårlästa.
 */
export function groupByAccount(mailboxes = []) {
  const grupper = new Map();
  for (const mb of mailboxes) {
    const nyckel = mb.provider_account_key ? `konto:${mb.provider_account_key}` : `brevlada:${mb.id}`;
    if (!grupper.has(nyckel)) grupper.set(nyckel, []);
    grupper.get(nyckel).push(mb);
  }
  return [...grupper.entries()].map(([key, boxes]) => ({ accountKey: key, mailboxes: boxes }));
}

/**
 * Avsändaradress för ett svar.
 *
 * Leverantören avgör vilka adresser vi får skriva från. Saknas den
 * behörigheten vägrar vi i stället för att skicka från något annat – ett svar
 * från fel avsändare är värre än inget svar.
 */
export function replyFromFor(mailbox) {
  if (!mailbox) throw new EmailAdapterError("NO_MAILBOX", "Ingen brevlåda angiven");
  if (!mailbox.can_send_from) {
    throw new EmailAdapterError(
      "SENDER_NOT_VERIFIED",
      `${mailbox.address} är inte verifierad som avsändare hos leverantören.`,
    );
  }
  return mailbox.display_name ? `${mailbox.display_name} <${mailbox.address}>` : mailbox.address;
}

/**
 * Förslag på vad ett infomejl handlar om.
 *
 * Ett förslag, inte ett beslut: funktionen svarar bara när signalen är tydlig
 * och lämnar annars null. Att gissa fel kategori är sämre än att låta en
 * människa välja.
 */
// \b duger inte här: i JavaScript räknas å, ä och ö som ordgränser, så
// "återförsäljare" efter ett mellanslag skulle aldrig matcha. Lookaround på
// bokstav gör rätt i både svenska och engelska.
const OFFERTORD =
  /(?<!\p{L})(offert|offerter|offerten|prisförslag|prisforslag|quote|quotes|quotation|kostnadsförslag|kostnadsforslag)(?!\p{L})/u;
const SAMARBETSORD =
  /(?<!\p{L})(samarbete|samarbeten|partner|partners|partnerskap|partnership|återförsäljare|aterforsaljare)(?!\p{L})/u;

export function suggestIntent(mail, purpose) {
  if (purpose === "support") return "support";
  if (purpose !== "info") return null;

  const text = `${mail?.subject ?? ""} ${mail?.text ?? ""}`.toLowerCase();
  if (OFFERTORD.test(text)) return "quote";
  if (SAMARBETSORD.test(text)) return "partnership";
  return null;
}

/* ----------------------------------------------------------------- adaptern */

export class EmailAdapter {
  /**
   * @param {object} options
   * @param {object} options.provider  { fetchSince(since), send(message) }
   * @param {object} options.store     läs/skriv mot BERRYiT:s egen databas
   * @param {object} options.mailbox   raden ur comm_mailboxes
   * @param {Function} [options.clock]
   */
  constructor({ provider, store, mailbox, aliases = [], clock = () => new Date() }) {
    if (!provider) throw new EmailAdapterError("NO_PROVIDER", "Ingen leverantör angiven");
    if (!store) throw new EmailAdapterError("NO_STORE", "Ingen store angiven");
    if (!mailbox) throw new EmailAdapterError("NO_MAILBOX", "Ingen brevlåda angiven");
    this.provider = provider;
    this.store = store;
    this.mailbox = mailbox;
    // Adresser som delar fysiskt konto med `mailbox`. Posten hämtas en gång och
    // fördelas på rätt brevlåda utifrån vilken adress den skickades till.
    this.aliases = aliases;
    this.clock = clock;
  }

  /** Alla adresser det här kontot tar emot post för. */
  get addresses() {
    return [this.mailbox, ...this.aliases];
  }

  /**
   * Hämtar in nya mejl och gör dem till meddelanden.
   *
   * Idempotent: ett mejl som redan finns hoppas över på Message-ID. Körningen
   * kan alltså göras om utan att inkorgen fylls med dubbletter.
   */
  async sync({ since = null } = {}) {
    if (this.mailbox.is_enabled === false) {
      return { skipped: true, reason: "Brevlådan är inte aktiverad", imported: 0, duplicates: 0 };
    }

    const resultat = { imported: 0, duplicates: 0, rejected: 0, conversations: 0, errors: [] };
    let mejl;
    try {
      mejl = await this.provider.fetchSince(since);
    } catch (fel) {
      resultat.errors.push({ code: "FETCH_FAILED", message: String(fel?.message ?? fel) });
      return resultat;
    }

    const kanda = await this.store.knownAddresses(this.mailbox.organization_id);

    for (const rad of mejl ?? []) {
      try {
        const messageId = normalizeMessageId(rad.messageId);
        if (!messageId) {
          resultat.rejected += 1;
          resultat.errors.push({ code: "NO_MESSAGE_ID", message: "Mejl utan Message-ID hoppades över" });
          continue;
        }

        if (await this.store.messageExists(this.mailbox.organization_id, messageId)) {
          resultat.duplicates += 1;
          continue;
        }

        // Vilken av våra adresser mejlet kom till avgör rollen. Hittar vi
        // ingen av dem används brevlådan vi hämtade från.
        const mottagande = deliveredTo(rad, this.addresses.map((m) => m.address)) ?? null;
        const brevlada =
          this.addresses.find((m) => m.address.toLowerCase() === String(mottagande).toLowerCase()) ?? this.mailbox;

        const tradnyckel = threadKeyFor({
          messageId,
          inReplyTo: rad.inReplyTo,
          references: rad.references,
        });

        const avsandare = verifySender({
          fromHeader: rad.from,
          envelopeFrom: rad.envelopeFrom,
          knownAddresses: kanda,
        });

        let konversation = await this.store.findConversationByThread(
          this.mailbox.organization_id,
          tradnyckel,
        );
        if (!konversation) {
          konversation = await this.store.createConversation({
            organization_id: this.mailbox.organization_id,
            channel_key: "email",
            mailbox_id: brevlada.id,
            subject: String(rad.subject ?? "").slice(0, 300),
            external_thread_key: tradnyckel,
            status: "open",
            intent: suggestIntent(rad, brevlada.purpose),
          });
          resultat.conversations += 1;
          if (avsandare.address) {
            await this.store.addParticipant({
              organization_id: this.mailbox.organization_id,
              conversation_id: konversation.id,
              external_address: avsandare.address,
              participant_role: "external",
            });
          }
        }

        const safeHtml = sanitizeEmailHtml(rad.html);
        const text = rad.text ? String(rad.text).slice(0, 100000) : htmlToText(rad.html);

        await this.store.insertMessage({
          organization_id: this.mailbox.organization_id,
          conversation_id: konversation.id,
          author_address: avsandare.address,
          direction: "inbound",
          body_text: text || "(tomt meddelande)",
          body_safe_html: safeHtml || null,
          external_message_id: messageId,
          in_reply_to: normalizeMessageId(rad.inReplyTo),
          reference_ids: parseReferences(rad.references),
          delivery_status: "received",
          sender_verified: avsandare.verified,
        });

        await this.store.recordEvent({
          organization_id: this.mailbox.organization_id,
          conversation_id: konversation.id,
          actor_kind: "connector",
          event_type: "message_received",
          detail: {
            message_id: messageId,
            sender_verified: avsandare.verified,
            mailbox: brevlada.address,
            purpose: brevlada.purpose ?? "other",
            ...(avsandare.reason ? { note: avsandare.reason } : {}),
          },
        });

        resultat.imported += 1;
      } catch (fel) {
        resultat.rejected += 1;
        resultat.errors.push({ code: fel?.code ?? "IMPORT_FAILED", message: String(fel?.message ?? fel) });
      }
    }

    await this.store.touchMailbox(this.mailbox.id, {
      last_synced_at: this.clock().toISOString(),
      status: resultat.errors.length > 0 ? "error" : "connected",
      last_error: resultat.errors[0] ? `${resultat.errors[0].code}: ${resultat.errors[0].message}` : null,
    });

    return resultat;
  }

  /**
   * Skickar ett svar.
   *
   * Vägrar i läsläge, vilket är det enda läget som går att konfigurera i den
   * här versionen. Spärren sitter här och inte bara i databasen, så att ett
   * misstag i en policy inte räcker för att få ut ett mejl.
   */
  async send(draft) {
    if (this.mailbox.access_mode !== "read_send") {
      throw new EmailAdapterError(
        "SEND_REFUSED",
        "Brevlådan är i läsläge. Att skicka kräver access_mode read_send och ett eget beslut.",
      );
    }
    if (typeof this.provider.send !== "function") {
      throw new EmailAdapterError("NO_SEND_SUPPORT", "Leverantören saknar stöd för att skicka");
    }
    // Kastar om adressen inte är verifierad hos leverantören.
    const from = replyFromFor(draft?.fromMailbox ?? this.mailbox);
    return this.provider.send({ ...draft, from });
  }
}

/* ------------------------------------------------------------- leverantörer */

/**
 * Leverantören som inte gör något. Används när ingen brevlåda är ansluten, så
 * att resten av systemet kan köras och visa "ej ansluten" i stället för att
 * fela.
 */
export const nullProvider = {
  kind: "none",
  async fetchSince() {
    return [];
  },
  async send() {
    throw new EmailAdapterError("NOT_CONNECTED", "Ingen e-postleverantör är ansluten");
  },
};

/**
 * Formen en leverantör ska ha. Dokumentationen ligger i koden för att det är
 * här den kommer att läsas när någon skriver nästa adapter.
 *
 *   fetchSince(since) → [{
 *     messageId, inReplyTo, references, from, envelopeFrom, to, subject,
 *     text, html, receivedAt, attachments: [{ filename, mimeType, size }]
 *   }]
 *   send({ to, subject, text, inReplyTo }) → { messageId }
 */
export const PROVIDER_CONTRACT = Object.freeze({
  required: ["fetchSince"],
  optional: ["send"],
  secretsStayOnServer: true,
});
