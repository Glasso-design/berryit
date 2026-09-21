/*
 * BERRYiT HEMMA – innehåll för privatpersoner/hemmet.
 *
 * Regler (ägarbeslut 2026-09-22):
 * - RUT beskrivs försiktigt: tjänster KAN omfattas när Skatteverkets villkor
 *   är uppfyllda. Material, resor och utrustning omfattas inte. En helt ny
 *   speldator beskrivs inte som RUT-berättigad.
 * - Sunvolt är samarbetspartner för sol/energi. BERRYiT påstår inte att vi
 *   utför elinstallationer. Ingen Sunvolt-logotyp finns godkänd i repot –
 *   namnet visas som text.
 */

export const hemma = {
  name: "BERRYiT HEMMA",
  tagline: "Hela hemmets teknik. Ett ställe.",
  lead: "Dator, Wi-Fi, skrivare, gaming, TV, ljud, smart hem och mer.",
  multi: "Flera saker som krånglar? Vi tar hand om flera tekniska uppgifter under samma besök.",
  categoryNote: "Du behöver inte välja rätt kategori. Berätta vad som behöver fungera så tar vi det därifrån.",
};

export type HomeService = { key: string; icon: string; title: string; text: string; items: string[] };

export const homeServices: HomeService[] = [
  {
    key: "dator",
    icon: "laptop",
    title: "Dator & IT",
    text: "Ny dator, långsam dator eller en som inte startar alls.",
    items: ["Installation av ny dator", "Flytt av filer och konton", "Uppdateringar och prestanda", "Backup", "Virus- och säkerhetskontroll"],
  },
  {
    key: "natverk",
    icon: "wifi",
    title: "Wi-Fi & nätverk",
    text: "Täckning i hela hemmet – inte bara bredvid routern.",
    items: ["Router och mesh", "Täckning och placering", "Gästnätverk", "Kabel där det behövs", "Säkerhet på nätverket"],
  },
  {
    key: "skrivare",
    icon: "printer",
    title: "Skrivare",
    text: "Skrivaren som slutade hitta datorn.",
    items: ["Installation", "Trådlös anslutning", "Skanning till dator och mobil", "Drivrutiner", "Felsökning"],
  },
  {
    key: "gaming",
    icon: "gaming",
    title: "Gaming",
    text: "Speldator, konsol och ett nätverk som hänger med.",
    items: ["Konsoler och uppkoppling", "Speldatorer – felsökning och uppgradering", "Lagg och nätverk", "Skärm och ljud", "Konton och inställningar"],
  },
  {
    key: "tv",
    icon: "tv",
    title: "TV & streaming",
    text: "Kanaler, appar och fjärrkontroller som fungerar ihop.",
    items: ["Smart-TV och uppkoppling", "Streamingtjänster och appar", "Mediaspelare", "Kopplingar till ljud", "Inställningar och konton"],
  },
  {
    key: "ljud",
    icon: "speaker",
    title: "Ljud",
    text: "Högtalare, soundbar och multiroom.",
    items: ["Soundbar och hemmabio", "Trådlösa högtalare", "Multiroom", "Koppling till TV och mobil", "Felsökning"],
  },
  {
    key: "mobil",
    icon: "phone",
    title: "Mobil & surfplatta",
    text: "Ny telefon, gamla bilder och konton som ska med.",
    items: ["Flytt till ny mobil", "Konton och e-post", "Säkerhetskopiering", "Appar och inställningar", "Hjälp att komma igång"],
  },
  {
    key: "smarthem",
    icon: "smarthome",
    title: "Smart hem",
    text: "Uppkopplade prylar som faktiskt pratar med varandra.",
    items: ["Hubbar och appar", "Smarta högtalare", "Uppkopplade enheter", "Automationer", "Felsökning av anslutning"],
  },
  {
    key: "installation",
    icon: "install",
    title: "Installation & konfiguration",
    text: "Nytt hemma? Vi kopplar in och ställer in.",
    items: ["Uppackning och inkoppling", "Programvara och konton", "Inställningar", "Genomgång när allt är klart"],
  },
  {
    key: "felsokning",
    icon: "troubleshoot",
    title: "Felsökning",
    text: "Vet du inte vad som är fel? Det är okej.",
    items: ["Vi letar reda på orsaken", "Förklarar vad vi hittat", "Löser det – eller föreslår en rimlig väg"],
  },
];

/** Exempel på ett besök där flera saker löses samtidigt. */
export const visitScenario = [
  "Installera den nya datorn",
  "Koppla in skrivaren",
  "Förbättra Wi-Fi i hela huset",
  "Ställa in TV:n och streamingapparna",
  "Ansluta spelkonsolen",
  "Få smarta hemmet att hitta nätverket",
];

export const visitSteps = [
  { title: "Berätta", text: "Lista allt som krånglar eller ska installeras – stort som smått." },
  { title: "Vi planerar besöket", text: "Vi går igenom listan med dig och ser vad som behövs på plats." },
  { title: "Allt på samma besök", text: "Vi tar uppgifterna i tur och ordning hemma hos dig." },
  { title: "Genomgång", text: "Du får veta vad vi gjort och hur det fungerar." },
];

export const smartHome = {
  areas: [
    { title: "Wi-Fi & mesh", text: "Grunden för allt uppkopplat – täckning i hela hemmet." },
    { title: "Uppkopplad media", text: "TV, mediaspelare och streaming som hittar varandra." },
    { title: "Högtalare", text: "Smarta högtalare och multiroom-ljud." },
    { title: "Hubbar", text: "Installation och inställning av hubbar som stöds av dina enheter." },
    { title: "Appar & konton", text: "Rätt app, rätt konto och delning i familjen." },
    { title: "Uppkopplade enheter", text: "Lampor, uttag, sensorer och annan ansluten teknik." },
    { title: "Installation", text: "Vi packar upp, ansluter och ställer in." },
    { title: "Felsökning", text: "När något tappar anslutningen eller slutar svara." },
  ],
  together:
    "Det svåra är sällan en enskild pryl. Det är att få allt att fungera tillsammans – nätverket, apparna, högtalarna och TV:n.",
};

export const rut = {
  short: "RUT-avdrag kan gälla",
  statement:
    "Många av våra IT- och tekniktjänster i hemmet kan omfattas av RUT-avdrag. När arbetet uppfyller Skatteverkets villkor kan du få avdrag på arbetskostnaden.",
  skatteverketUrl: "https://www.skatteverket.se/rotochrut",
};

export const sunvolt = {
  heading: "Smartare hem. Smartare energi.",
  lead: "BERRYiT samarbetar med Sunvolt kring solenergi och energilösningar för hemmet.",
  berryit: ["Nätverk och uppkoppling", "Appar och konton", "Digital integration i hemmets teknik", "Felsökning av anslutna enheter"],
  sunvoltScope: ["Solenergi", "Energilösningar", "Installationer inom Sunvolts område"],
};
