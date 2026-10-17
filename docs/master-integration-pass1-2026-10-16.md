# BerryIT Master Integration PASS 1 — 2026-10-16

Senare lokalt tillägg: [projekt och dynamiska roller](project-access-master-2026-10-16.md).
Den rapporten omfattar en ytterligare framåtriktad migration (15 totalt,
9 efter tidigare verifierad driftsbas). Resultaten nedan avser ursprungliga PASS 1.

## Resultat och gränser

**Lokala uppgraderings-, register-, connector- och regressionstester: PASS.**
**Riktiga isolerade Supabase HTTP/JWT/Auth/Storage-tester och native
Windows-inloggning/MFA mot samma stack: BLOCKED**, enligt användarens beslut.
Windows saknar Docker, Podman, PostgreSQL och WSL; inget installerades.
PGlite och browsertransport med syntetisk Auth räknas inte som dessa tester.

Bas: `feat/support-desk`, HEAD `0357a64e7d0284a30259cbf7b78b6c7a1e155b91`.
Föregående Desktop 0.1.1-ändringar bevarades. Ingen commit/push, inga
produktionsmigrationer eller deployments, inga serverfiler eller tjänster
ändrades. Endast avgränsade läsningar gjordes på core-node-01/prod-node-01.

## Exakt uppgraderingskedja

Den driftsatta ledgern lästes på nytt i `BEGIN READ ONLY`: exakt sex poster till
och med `20261013091000_support_authority_hardening.sql`. Ingen driftförändring
sedan föregående rapport hittades i ledgern. Följande åtta återstår, i ordning:

| Ordning | Migration | Viktiga beroenden |
|---:|---|---|
| 1 | `20261013110000_support_mfa_enforcement.sql` | Sex basmigrationer; befintliga roller/grants/profiler och GoTrue-sessioner |
| 2 | `20261013120000_onarly_ai_assistant.sql` | MFA-behörighetsmodell; befintliga kunder/tickets. Skapar `support_projects` |
| 3 | `20261013130000_connector_engine.sql` | `support_projects` från AI-migrationen samt `requires_mfa`; skapar register och incidents |
| 4 | `20261013140000_infrastructure_monitoring.sql` | Connector-registrets noder/tjänster/incidenter och behörigheter |
| 5 | `20261013150000_communications.sql` | Tickets, kund-/organisationsmodell, behörigheter och Storage-grund |
| 6 | `20261014110000_onarly_desk_integration.sql` | Tickets, befintliga entitlements och scoped/tidsstyrda grants; lägger till konsultfält |
| 7 | `20261014190857_security_ci_repair.sql` | Communications-tabeller/policies, Storage och befintliga behörighetsfunktioner; skapar privata hjälpare |
| 8 | `20261014235633_complete_support_workflow.sql` | Privata hjälpare från Security Repair samt DESK:s konsultfält och supporttabeller |

Filerna kördes i denna ordning ovanpå baslinjen i en NY PGlite-instans.
Predecessor i manifestet är den konservativa körordningen; tabellen anger även
de direkta semantiska beroendena. Ingen historisk migrationsfil ändrades och
ingen ny applikationsmigration skapades.

[Versions- och SHA-256-manifest](master-integration-pass1-migrations.json)
innehåller alla 14 repositoryfiler. Hasharna beskriver repositoryinnehållet;
den äldre produktionsledgern bevisar inte historiska exekveringschecksummor.
`supabase/upgrade-plan.mjs` producerar endast metadata. Okända, dubblerade,
omkastade eller saknade ledgerposter stoppar planeringen.

## Vad som återanvändes och färdigställdes lokalt

| Del | Redan implementerat | Verifierat/ändrat i PASS 1 | Återstår i PASS 2 |
|---|---|---|---|
| Kund-/projektregister | organizations, profiles, support_projects | Ingen ny kundmodell. Pilot passar befintliga tenant-FK och RLS | Matcha verklig intern BerryIT-organisation och befintliga registerrader |
| Infrastruktur | infra_nodes, infra_services | Pilot med en nod och åtta tjänster passar riktiga constraints | Godkänd import, ägare och driftansvar |
| Connector Engine | Sex adaptrar, eget REST-store, status och audit | Exakta scopes/planerade stopp, fortsatt GET-only mot produkter | Produktionsrunner, schema, secret store och egress-allowlist |
| Monitoring | Agentkontrakt, mätvärden, trösklar, incidentmotor | Stoppade containrars gamla health orsakar inte aktuella unhealthy-larm; inga fabricerade nollor | Verklig collector, autentiserad mottagning/replayhantering, transport och lagring |
| Desktop | Befintliga projekt-, infra-, monitoring- och integrationsvyer | 138 enhetstester, produktionfrontend/browsertester och build | Native inloggning/MFA mot riktig teststack; tydlig presentation av schema-/behörighetsfel |
| ONARLY DESK | Manuellt ärende-/samtyckesflöde; adapter utan sessions-API | Regression bevarad; inga sessions-API:er hittas på | Samma godkända migrations-/driftsgrind, aldrig automatisk fjärrstyrning |
| AI/Communications | Befintliga serveradaptrar och scope | Service- och RLS-regressioner | Godkänd serverkonfiguration; externa provider-/e-postflöden kräver separata tester |

Detta pass aktiverar ingen connector och skriver inga pilotrader till drift.
`buildCorePilot` är en ren utkastgenerator, inte en importör eller ny databas.

## Pilotträd och observationer

```text
Befintlig intern BerryIT-organisation (ID måste verifieras)
├── infra_nodes: core-node-01
├── support_projects: FLIQS
│   ├── web → core-node-01 → anonym HTTP-health
│   └── bot → core-node-01 → exakt Docker-namn, processstatus
└── support_projects: AuroraPark
    ├── web → core-node-01 → HTTP-health via befintlig gateway
    └── api/rest/auth/db/proxy → core-node-01 → exakta Docker-namn
```

En nodintegration plus åtta tjänsteintegrationer: samtliga `is_enabled=false`,
`access_mode=read_only`, `secret_ref=null`, `status=not_configured` i förslaget.
Ingen identitet skapas och inga SSH-/Docker-rättigheter ges till Desktop.
Botens körande process är inte bevis för ett fungerande Discord-flöde.

Läsande snapshot: **61 containrar, 14 körande, 47 stoppade**. Alla 26 tidigare
godkända stopp matchade exakta namn, `exited` och faktisk restart-policy `no`.
Den befintliga Dockeradaptern utvärderades lokalt mot denna normaliserade
snapshot: 26 planerade stopp, **21 andra stopp fortfarande oklassificerade**.
Nodresultatet är därför ärligt `degraded`, inte grönt genom bred exkludering.
Härledda mätvärden: 14 running, 0 aktuellt unhealthy.

FLIQS och AuroraPark gav riktiga HTTP 200 med läsaren placerad på core-node-01,
via befintlig SSH enbart för läsning. Windows direkt till FLIQS port 4174 gav
`UND_ERR_SOCKET`; AuroraPark port 3401 gav 200. Detta är ett lägesberoende
nätverksresultat, inte en fingerad frisk connectortransport. Befintlig FLIQS
proxy ändrades inte. Råa säkra resultat/tid finns i
`test-results/master-pass1-live-observations.json` (git-ignorerad).

## Genomförda tester

| Kontroll | Faktiskt resultat |
|---|---|
| Ny full 6→14-uppgradering | **29/29 PASS**; åtta steg, bevarade originalkolumner/rader i 13 tabeller, pilot-FK/RLS, SQL-MFA, helper-ACL, ledger och rollback av felande transaktion |
| Befintlig MFA-upgradefixture | **22 kontroller PASS**, samma fixture delad via `supabase/tests/fixtures/deployed-baseline.sql` |
| RLS/MFA/DESK från ren PGlite | **271 kontroller PASS** |
| Security Repair | **22/22 PASS** |
| Testmiljöskydd | **5/5 PASS** |
| Connector/Monitoring/Pilot + HTTP-preflight/manifest + AI/Communications | **116/116 PASS** |
| Desktop | **138/138 PASS**, typecheck PASS |
| Rust/Credential Manager | **8/8 PASS**, befintliga syntetiska testposter, offline, ingen installation |
| Befintlig isolerad supporthelresa | **3/3 PASS**, PGlite + syntetisk browsertransport |
| Byggd anslutningsfrontend | **3/3 PASS**, syntetisk Auth-health, inga riktiga konton |
| Shell-säkerhet | PASS: mockad Docker/SQL, felande restore, atomisk ledger, backupchecksumma och ingen implicit gallring; tidigare cleanup-säkerhetssvit PASS |
| Lint, webb-typecheck | PASS |
| Next.js Webpack / Desktop Vite produktion | PASS |
| Riktiga isolerade Supabase HTTP/JWT/Auth/Storage + native Windows MFA | **BLOCKED**, ingen separat miljö finns. Inga tester ersattes med påhittade PASS |

Nya testfall visar att en verkligt unhealthy körande container fortfarande
larmar, andra stopp inte döljs, planerad container som startar eller saknas
syns, och ogiltiga/wildcard-policies avvisas. Agentrapporter får inte mata in
dubbla motstridiga containersiffror. Saknad inventering är inte noll friska fel.

Sandboxens loopbackrestriktion gav först fyra servicefel; samma lokala tester
passerade 45/45 i vanlig Windows-kontext. Git Bash nekades först MSYS-objekt i
sandboxen och passerade sedan normalt. Windows saknar Linux POSIX-filmoder:
umask/chmod-anrop verifierades här; faktisk 0600-verifiering är kvar i Linux-
testgrinden. Den första nya MFA-assertionen antog felaktigt att `session.aal`
var auktoriteten. Testet korrigerades mot befintligt kontrakt: verifierad
JWT:s aal2 plus levande/icke utgången session. Ingen behörighetsfunktion ändrades.

CI är lokalt uppdaterad för de nya testerna. Desktop-browserjobbet bygger med
syntetiska publika förval. **GitHub Actions har inte körts** eftersom inget
committats/pushats. Befintliga Zod-/chunkstorleksvarningar kvarstår.
Den befintliga Windows-installeraren 0.1.1 har inte ändrats eller installerats:
SHA-256 `537fd6f3e7881962ce2465ec248b574d7d12740ccfa28b7d76f298dd7c0f4329`.
Den tidigare Windows-tunneln återkontrollerades med Auth HTTP 200; ingen ny
tunnel startades. Källkodskontrollen hittade inte den faktiska service-role-
nyckeln i någon modifierad eller ny versionshanteringsbar fil.

Git vid slutkontroll: **25 modifierade spårade filer, 17 nya filer**, inklusive
de bevarade Desktop-ändringarna från föregående pass. Inga raderade filer och
ingen diff i `supabase/migrations`. HEAD är oförändrat; inget är committat eller
pushat i detta pass. Kontrollera hela arbetsytan före ett framtida commit-gate.

## Lokalt härdade driftverktyg — inte installerade på servern

- `migrate.sh`: migrations-SQL och ledgerpost använder samma transaktion.
  Ledgern får RLS och ingen åtkomst för PUBLIC/anon/authenticated.
- `restore-test.sh`: fel från `pg_restore` avbryter; ingen `--clean` mot den
  nyskapade databasen. Endast körningens ägarmärkta testdatabas får städas.
- `backup.sh`: umask 077, explicita filmoder, SHA-256 för DB och storage,
  ingen automatisk retention/radering av gamla backupfiler.

Dessa testas med mockar och syntetiska filer. Det är INTE bevis för en verklig
pg_dump-/blob-restore eller konsistens mellan databas och fillagring.

## Stabil Desktop-anslutning utan administrativa klientnycklar

Nuvarande verifierade transport är Windows-loopback → krypterad SSH via
Tailscale → befintlig BerryIT-gateway på prod-node-01:127.0.0.1:8700.
Den befintliga hjälpen använder strikt värdnyckelkontroll, batchläge och
keepalive. Privat SSH-identitet stannar utanför Desktop/installeraren.
Ingen ny tunnel, autostart eller schemalagd uppgift skapades i PASS 1.

PASS 2 rekommenderas ett eget tailnet-begränsat HTTPS-endpoint framför samma
gateway: välj och verifiera en ledig port/path, behåll alla befintliga routes,
ingen Funnel och ingen publik exponering. Begränsa åtkomsten med befintlig
Tailscale-identitet/ACL och verifiera TLS i native HTTP-klienten. Publik
anon/publishable key och användarens JWT är de enda klientuppgifterna; service-
role och externa systemnycklar förblir server-side. Inga sådana nätverks- eller
serverändringar görs nu.

Alternativet med SSH måste använda separat, begränsad forward-only-identitet
och övervakad återanslutning utanför Desktop efter eget godkännande; dagens
manuella hjälp är inte en färdig hanterad transport för alla tekniker.

## Genomförbar PASS 2-plan och backup-/restore-grind

1. **Frys granskat paket.** Ny granskning/commit-godkännande först. Läs om
   produktionsledgern, jämför manifest/checksummor och avbryt vid drift. Gamla
   migrationer körs inte om. Serverns verktyg ersätts endast efter separat
   godkännande; lokala ändringar är ännu inte driftsatta.
2. **Separat teststack på befintlig Linuxvärd efter godkännande.** Välj värd
   efter resurskontroll, utan serverflytt. Eget UUID-projekt, nya projektägda
   nätverk/volymer, egna verifierat lediga loopbackportar och nya syntetiska
   nycklar. Inga fasta produktions-container-/volymnamn, befintliga DB-URL:er,
   produktionsdata eller produktmounts. Märk databas och resurser med samma
   run-ID och `isolated`. Ingen implicit cleanup; endast egna verifierade ID.
   Avsiktligt pausade containrar och alla befintliga tjänster lämnas orörda.
3. **Riktig tjänstegrind.** Samma versionsbundna PostgreSQL/Auth/PostgREST/
   Storage/Caddy-images som BerryIT. Starta sexmigrationsbas + befintlig fixture,
   använd riktiga GoTrue-konton/token och ta en testbackup. Uppgradera i ordning.
   Testa signup-spärr, login, TOTP enroll/challenge/verify, aal1/aal2, manipulerad
   JWT, utgång/återkallelse, RPC-ACL, organisationsisolering, interna meddelanden
   och bilagor samt upload/download/signed URL via HTTP. Kontrollera riktiga
   Storage-migreringar/grants; använd inte PGlite-bootstrap i en riktig stack.
4. **Native Desktop-grind.** Desktop 0.1.1 mot endast teststackens publika
   profil. Separat Windows-testidentitet eller verifierat avskild Credential
   Manager-namnrymd så verklig konfiguration/session inte återanvänds eller
   raderas. Verifiera riktig login/MFA, refresh/logout, återanslutning och
   supporthelresa. Ingen registrering, e-post eller fjärrsession i produktion.
5. **Backup-/restore-grind före produktionsbeslut.** Bestäm krypterat offsite-
   mål och åtkomst. Skapa explicit skrivstopp/snapshot för ENBART BerryIT så
   DB-dump och storagefiler beskriver samma tidpunkt; påverka inga andra appar.
   Använd unik backupkatalog, restriktiva rättigheter, checksumma för alla
   artefakter och krypterad kopia av nödvändiga serversecrets. Återställ från
   offsite till separat ägarmärkt stack. Verifiera pg_restore-exit, constraints,
   roller/RLS, Auth/MFA, ärenden/audit och blobinnehåll/hashar via riktiga HTTP-
   anrop. Nuvarande generiska restore-script kontrollerar inte allt detta.
   Spara undertecknat resultat, RPO/RTO och vald återställningspunkt. Ingen
   backupgallring får vara en bieffekt av releasegrinden.
6. **Först därefter produktionsgodkännande.** Explicit godkännande av de åtta
   migrationerna och driftpaketet; inga beslut verkställs av Command Center.
   Återställning betyder validerad DB+Storage+konfigurationssnapshot till samma
   godkända BerryIT-mål. Den gamla MFA-rollbackfilen är inte en komplett rollback
   för hela åttamigrationskedjan. Dataloss efter vald snapshot måste beslutas,
   aldrig döljas genom att automatiskt köra destruktiva down-migrationer.
7. **Pilotaktivering efter separat godkännande.** Matcha intern organisation,
   projekt och tjänster, bekräfta ägare och de 21 övriga stoppen. Verifiera en
   API-begränsad läsare/agent och autentiserad mottagning, secrets och schemat.
   Aktivera en connector i taget och kontrollera status/audit och skyddade
   tjänster. Skrivningar sker bara i BerryITs register, aldrig produktapparnas
   databaser. Inga automatiska restart-, deploy-, shell- eller skrivkommandon.

**Stoppunkt:** allt ovan efter lokal verifiering är plan, inte utfört arbete.
Inga nya arbetspass, installationer, produktionsändringar eller aktiveringar
startas av denna leverans.
