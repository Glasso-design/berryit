# BerryIT Security & CI Repair Gate — lokal verifiering 2026-10-14

Utgångspunkt: Master Integration Audit 2026-10-14 i denna arbetskonversation.
Repository `Glasso-design/berryit`, arbetsyta `C:\projects\berryit`, branch
`feat/support-desk`, HEAD `494917e90a2bc8a55bd6e1896332a21d8ea2cac7`.
Arbetsträdet var rent före ändringarna. Appens chattinventering visade ingen
annan aktiv BerryIT-agent; kontrollen upprepades vid slutgranskningen.

Ändringarna är lokala och ocommittade. Ingen push, migration mot server,
deployment, verklig e-post, fjärrsession eller serverrensning har gjorts.

## Säkerhetsfixar

En ny migration, skapad med Supabase CLI:
`supabase/migrations/20261014190857_security_ci_repair.sql`.
De tolv historiska migrationerna lämnas orörda.

| Risk | Åtgärd |
|---|---|
| Interna meddelanden i kundsynlig konversation | SELECT filtrerar `direction='internal'` till personal med rätt scope. Kunden får heller inte skapa interna meddelanden. Internchatt kräver personalbehörighet. |
| Deltagare från annan organisation | Kundåtkomst kräver aktiv profil i aktuell organisation och kunddeltagarskap. Äldre felaktiga deltagarrader ger inte läs- eller skrivrätt. |
| Manipulerade deltagar-ID/roller | Endast personal med skrivrätt inom konversationens scope kan lägga till deltagare. Trigger verifierar kundorganisation eller aktivt supportscope för personaldeltagare. Kunden kan bara uppdatera egen läsmarkering, i en fortfarande åtkomlig konversation. Identitet och konversation är oföränderliga. |
| Återkallad extern tekniker med gammalt personaldeltagarskap | Personalrollen på en deltagarrad ger ingen egen auktoritet. Efter återkallelse går det inte att falla tillbaka till kunddeltagarskap, även om profilen hör till samma organisation. |
| `active_support_grants(uuid)` exponerad anonymt | EXECUTE återkallas från PUBLIC/anon, även för rang-wrappern. Authenticated får bara egna aktiva grants för aktiv profil. Annan användares UUID eller null ger inga rader. Service-role och direkt betrodd underhålls-SQL behåller sin väg. `SET ROLE authenticated` utan claims får inget undantag. |
| Privilegierade funktioner | SECURITY DEFINER har tomt låst `search_path`; tabeller är schema-kvalificerade. Nya triggerfunktioner kan inte anropas direkt av klienten. Befintliga scope-, utgångs-, återkallelse- och MFA-flöden återanvänds. |
| Interna bilagor/ID-förväxling | Metadata måste matcha konversation, meddelande och `conversations/<conversation_id>/<fil>`. Interna meddelandens bilagor förblir interna även om metadata felaktigt säger `customer`. |
| Storage-policy saknas för Communications | Samma privata bucket återanvänds. Objektläsning kräver metadata som den aktuella användarens RLS tillåter. Interna objekt och objekt utan synlig metadata lämnas otillgängliga. Scopade tekniker får läsa interna filer inom sitt scope. |
| Extra permissiva Storage-policyer | Restriktiva SELECT/INSERT/DELETE-policyer upprätthåller kontrollerna även vid andra permissiva policyer. UPDATE/överskrivning och anonym åtkomst spärras för denna bucket. Andra buckets behåller sina egna regler. |
| Kunden försöker registrera ett befintligt föräldralöst objekt | Klientmetadata måste registreras före ny Communications-uppladdning. Trigger avvisar anspråk på en redan befintlig objektsökväg. Service-role-import är fortsatt betrodd. Ingen befintlig fil raderas. |

Inga nya administratörsroller eller parallella kund-/behörighetsmodeller skapas.
Ärendearbetets befintliga undantag från MFA bevaras; administrationens MFA-krav
verifieras av tidigare regressioner.

## Meddelanden med identisk tidsstämpel

Desktop hämtar samtliga sidor med stabil ordning `(created_at,id)` och
sammansatt nyckelmarkör inom hämtningen. Mellan pollningar används inkluderande
tidsgräns och befintlig deduplicering på meddelande-ID. Därmed återhämtas även
ett sent infört lägre UUID på samma tidsstämpel. Mikrosekunder behålls som text;
markören omvandlas inte till JavaScript Dates millisekundprecision.
Tidsvärden citeras enligt [PostgREST:s filtergrammatik](https://docs.postgrest.org/en/stable/references/api/tables_views.html#logical-operators).
Markörens timestamp/UUID valideras innan den får ingå i logiska filter.

Det finns inget tyst sidtak. En kort sida kan bero på API:ts eget lägre tak;
hämtningen fortsätter tills sidan är tom. API-fel och stillastående markörer
avvisar hela hämtningen; den befintliga synkfelvyn visar felet och försöker igen.
Listan sorteras även på ID när tidsstämplarna är lika.

Detta är ingen generell garanti för historisk backfill: ett importerat eller
sent committat meddelande med tidsstämpel *före* senaste synkgränsen kräver full
omladdning. En strategi för sådan återhämtning återstår om bakåtdaterad import
ska stödjas. Den verifierade förlusten vid identiska tidsstämplar är åtgärdad.

## CI och resultat

`pretypecheck` kör `next typegen` före `tsc --noEmit`. CI kör samma kommando,
samt den nya `db:repair-test`. Inga befintliga CI-steg har tagits bort.
`npm run build` är fortfarande `next build --webpack`. Den dokumenterade
Windows/Turbopack-begränsningen finns kvar i `pass-2g-build-verification.md`.
Ingen design-, font- eller paketversionsändring har använts för bygget.

Lokalt: Windows, Node 24.19.0, npm 11.17.0. Båda låsfilerna oförändrade.
Root och Desktop installerades om med `npm ci`.

| Kontroll | Resultat |
|---|---|
| `npm ci`, `npm ci --prefix desktop` | PASS, exit 0; säkerhetsvarningar nedan |
| `npm run db:safety-test` | PASS, 5/5; okänd/produktionsklassad miljö, externa DB-variabler och cleanup-argument nekas |
| `bash deploy/berryit-support/security-gate-safety.test.sh` | PASS; mockad Docker/SQL/admin, negativa mål/ID/fel/samtidiga körningar och restore-kollision |
| `npm run db:test` | PASS, 271/271; tom databas, alla 13 migrationer, 45 publika tabeller med RLS, låst search_path |
| `npm run db:upgrade-test` | PASS, 22/22; tidigare MFA-uppgradering/rollback/återapplicering |
| `npm run db:repair-test` | PASS, 21 namngivna deltester + föräldratest, Node rapporterar 22/22 |
| Connector/Monitoring/Communications/AI-tjänstetester, samma fyra filer som CI | PASS, 102/102 |
| `node supabase/tests/onarly_ai_assistant_test.mjs` | PASS, 11/11 extra AI/RLS-kontroller |
| `npm test --prefix desktop` | PASS, 119/119 i sju filer; tio nya klient-/pagineringstester |
| `npm run lint` | PASS, exit 0 |
| `npm run typecheck` från borttagna Next-artefakter | PASS, exit 0; typgenerering + tsc utan tidigare next-env/route-typer |
| `npm run build` från rent genererat läge | PASS, exit 0; Next 16.3.5 Webpack, 30 statiska sidor + dynamiska Control-routes |
| `npm run typecheck --prefix desktop` | PASS, exit 0 |
| `npm run build --prefix desktop` | PASS, exit 0; tsc + Vite 7.3.7. Icke-blockerande chunkstorleks-/tredjepartsannotationsvarningar |

Databastesterna använder nya PGlite-minnesdatabaser utan server-URL eller
produktionsnycklar. Reparationssviten applicerar först gamla migrationer,
skapar syntetiska historiska felkopplingar, applicerar korrigeringen och
verifierar både skydd och bevarade deltagarrader. Storage-testet använder en
syntetisk katalog, men PostgreSQL:s riktiga RLS — även med medvetet breda
permissiva policyer som annars skulle öppna åtkomst.

Klienttesten använder riktiga Supabase SDK och Desktop-funktioner med en
in-memory transport till SQL under authenticated/RLS. 1 001 meddelanden delar
exakt samma mikrosekundstämpel. Dessutom prövas 26 001 rader över 54 API-anrop
med syntetisk SDK-transport, API-sidtak under begärt tak, fel på senare sida,
stillastående markör, markörinjektion och manipulerade organisations-/profil-ID.
Ett tidigare försök med 26 001 rader direkt i WASM avbröts på grund av lång
fixturuppbyggnad; det redovisas inte som ett godkänt SQL-storskalighetstest.

Sandlådan blockerade först loopback för fyra AI-HTTP-tester (EACCES) och ett
webbbygge vid skrivning till `.next` (EPERM). Samma tester/byggväg passerade
med de nödvändiga lokala fil-/loopback-/fontnäträttigheterna. Inga spärrar i
applikationskoden försvagades. GitHub Actions för denna ocommittade ändring har
inte körts; resultatet ovan är den lokala motsvarigheten till hela kedjan.

## Serverkopian — läst, inte körd eller ändrad

Server `prod-node-01`, fil:
`/home/ubuntu/berryit-support/deploy/berryit-support/security-gate.sh`.
Läst med SSH `cat`, `sha256sum`, `ls -l`. Ägare `ubuntu:ubuntu`, mode 0755,
8 258 byte. Ingen `security-gate-safety.sh` fanns bland serverns gate-filer.

| Källa | SHA-256 |
|---|---|
| Serverns äldre gate | `968563bc77e89744b336c4989048b6d8b10065ed74a877bb941568732f45ab18` |
| Git HEAD:s pushade `security-gate.sh` | `9f2f59366ec36edd3dc338c9831431ef917d2771649db56a9a08569d960aab52` |
| Git HEAD:s pushade `security-gate-safety.sh` | `7871d6d72e827e3d11df8d284a7c7e41ee5e94211b47168c785a6455a1acc677` |

Serverkopian använder produktionsstackens nyckelfil och fasta container/port,
saknar isoleringsidentifiering och har `trap cleanup EXIT` med
`delete from public.tickets where subject like 'E2E-test%'`. Den är fortsatt
osäker att köra. Git-versionen kräver isolerat Compose-projekt, separat port,
separata testnycklar och matchande databasmarkör. Den använder körnings-UUID,
skapade ID och upprepad ägarkontroll; ingen exit-trap raderar data.

Mocksviten har ändrats så att den inte ens exekverar gate-entrypointen på en
förväntad avvisningsväg. Guardens negativa fall testas med mockar; en strikt
kontroll av den exekverbara inledningen bevisar att målspärren ligger före
nyckelläsning och andra effekter. Gate-filen läses som text med Node.

### Exakt plan för senare ersättning — kräver separat godkännande

1. Välj godkänd commit efter detta pass. Exportera `security-gate.sh`,
   `security-gate-safety.sh` och `security-gate-safety.test.sh` från Git som LF,
   och skapa SHA-256-manifest för just denna version. Kopiera inga nycklar.
2. Kör mocksviten och granska paketet lokalt. Verifiera HTTP/JWT/Storage/MFA
   i en separat isolerad teststack med egen databas, egna nycklar, port och
   identitetsmarkör. Använd inte serverns produktionsstack eller backupdata.
3. Under separat godkänt underhållsfönster: kontrollera pågående processer,
   timers/cron/CI-anrop och jämför serverhashen med ovan. Stoppa vid annan hash
   eller pågående körning. Blockera den gamla exekverbara ingången innan bytet;
   kör inte den gamla filen för att kontrollera ett felutfall.
4. Bevara gammal fil som låst, icke-exekverbart granskningsunderlag utanför
   aktiva skriptvägar. Lägg nya filer i en temporär katalog på samma filsystem
   som destinationen. Verifiera manifest, ägare och rättigheter där.
5. Installera hjälpfunktionen först (endast läsbar för avsedd driftidentitet),
   ersätt entrypointen sist med atomisk namnändring och mode 0750. Ingen period
   med ny gate utan rätt hjälpfunktion får uppstå. Verifiera hash och `bash -n`
   utan att exekvera grinden. Avvikelse lämnar grinden blockerad; återaktivera
   inte den osäkra gamla filen som fallback.
6. Bekräfta att framtida jobb använder granskad version och uttrycklig isolerad
   teststack. Inga databasmigrationer, testkörningar, cleanup eller omstarter mot
   produktion ingår i själva filbytet. Dokumentera version och slutliga hashvärden.

Ingen del av denna ersättningsplan har utförts på VPS:en.

## Återstående risker och separata grindar

- **Drift:** den äldre servergrinden är fortfarande osäker och får inte köras.
  Ersättningsplanen ovan är förberedd men inte utförd. Gamla scratchpad-seed-filer
  är fortsatt otillgängliga; deras historiska risk är inte verifierad som löst.
- **Full Supabase E2E:** faktisk GoTrue/JWT, PostgREST-filterparsning, Storage
  HTTP/uppladdning och signed URLs behöver testas mot en ny isolerad stack före
  produktionsmigration. PGlite/SDK-transport bevisar inte hela tjänstekedjan.
  Befintliga signed URLs kan fortsätta gälla till sin utgång; RLS är ingen
  återkallelse av en redan utfärdad URL.
- **Paket:** `npm audit` exit 1 rapporterar åtta berörda root-paket (sju high,
  ett critical), bland annat Next 16.3.5 med `GHSA-vcvr-r3jv-pc5j`, sharp,
  source-map-js och ESLint/glob-kedjan. Desktop rapporterar tre berörda paket
  (två critical och ett moderate), tinypool/vitest/@vitest/mocker. Detta är
  paket-/advisoryträffar, inte bevis för exploatering av produktens routes.
  Inga paketversioner eller låsfiler har ändrats. Säkerhetsuppgradering och
  tillämplighetsgranskning behövs som separat arbete före produktionsbeslut.
- **Restore:** befintliga `restore-test.sh` sväljer fortfarande pg_restore-fel
  genom `|| true`. Detta pass körde bara mockad skapningskollision, ingen verklig
  restore. Backup-/restoreberedskap ska inte betraktas som godkänd här.
- **Backfill:** äldre tidsstämplar än synkgränsen kräver full omladdning enligt
  begränsningen ovan. Ingen generell kontinuerlig historiksynk har införts.

Slutsats: de avgränsade säkerhetsreparationerna och den lokala CI-kedjan är
verifierade. Produktionsberedskap är inte godkänd av detta pass. Ändringarna
lämnas ocommittade för granskning; invänta godkännande före commit/push.
