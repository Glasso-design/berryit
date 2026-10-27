# BerryIT PASS 3C — Backup & Recovery med befintlig infrastruktur

## Beslut

**Core-node-01 har tillräcklig uppmätt kapacitet och är rekommenderad kandidat.
Produktionsbackupgrinden är fortfarande BLOCKED. Ingen ny VPS eller molnlagring
behöver beställas utifrån dagens datamängd.**

| Grind | Resultat | Vad återstår |
|---|---|---|
| Core som backupdestination | **BLOCKED för drift**, lämplig kandidat | Verifierad diskhälsa, skyddad katalog/identitet, installerad och testad backupväg |
| Kapacitet, minst 30 dagar | **PASS inom redovisad budget** | Kvot/reserv och tillväxtlarm måste införas och kontrolleras |
| Kryptering/åtkomstskydd | **PASS syntetisk GPG**, **BLOCKED drift** | Restic/rest-server, append-only-negativtester, credentials och oberoende recoveryförvaring |
| Återställning | **PASS syntetisk PostgreSQL + filer + konfig** | Full cold restore med oberoende roller/secrets och riktig Auth/MFA/Storage-HTTP samt riktig produktionsbackup |
| Kostnad/säkerhetsrisker | **PASS: inget VPS-/molnköp behövs för kapacitet. BLOCKED: säkerhetsgrindar återstår** | Disk-/hostförlust och separat offlinekopia måste hanteras eller riskgodkännas |
| Riktig produktionsbackup | **BLOCKED** | Godkännanden A och B nedan; ingen överföring utförd |

## 1. Bevarad status och avgränsning

2026-10-21: lokal branch `feat/support-desk`, HEAD
`dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`. GitHub-HEAD återlästes med
`git ls-remote` och är identisk. De tio befintliga ospårade PASS 3A/3B-filerna
bevarades; tidigare leveranshashar verifierades. Inga tracked filer, historiska
migrationer eller staged filer ändrades. Ingen annan aktiv BerryIT-chatt syntes
i appens trådlista. Det är en avgränsad samordningskontroll, ingen global garanti
om alla processer på alla datorer.

PASS 3A/3B och deras manifest, backup-/restoreverktyg samt native-testmiljöns
rapport lästes. Godkända tidigare sviter kördes inte om. Detta pass tillför
servermätningar och ett verkligt PostgreSQL-komponentrestoretest.

Prod-node-01 användes **endast läsande**: READ ONLY-SQL, filmetadata/hashes,
Storage-storlek, health och Tailscale-ping. Ingen produktionsbackup skapades
eller överfördes, inget GPG-kommando kördes där och PASS 3B:s oavsiktligt skapade
GPG-katalog hanterades inte. Inga produktionsändringar, migrationer, aktiva
behörighetsändringar, inferenser, installationer, omstarter, raderingar,
commits eller pushar utfördes.

På core skapades enbart tillåtna syntetiska testartefakter i ny 0700-katalog
och en ny ägarmärkt återställningsdatabas i den **befintliga isolerade**
BerryIT-containern. Ingen befintlig fil/databas skrevs över. Ingen ny container,
ny stack, permanent tjänst eller schemaläggning skapades. Alla artefakter behölls.

## 2. Produktionens faktiska återställningsomfång

Mätning cirka 09:59 CEST; kompletterande storlekskontroll samma förmiddag.

| Komponent | Uppmätt |
|---|---:|
| PostgreSQL `postgres` | **12 520 595 byte**, cirka 11,94 MiB |
| Storage | **4 filer, 52 logiska byte**, cirka **84 KiB allokerat** inklusive kataloger |
| BerryIT Caddy-datavolym | Cirka **20 KiB allokerat** |
| Ledigt på prod-root | **56 262 352 896 byte**, cirka 52,4 GiB |
| Befintlig lokal DB-dump | `berryit-support-db-20261013T083332Z.dump`, **344 949 byte**, mode 0600 |
| Befintlig lokal Storage-backup | `berryit-support-storage-20261013T083332Z.tar.gz`, **743 byte**, mode 0600 |

Ingen ny dump togs för att mäta produktionsbackupstorleken. Den gamla dumpens
storlek är historisk, inte ett nytt fullständighetsbevis. Komprimering/deduplicering
får inte räknas hem innan en verklig backup har mätts.

Full återställning kräver följande från
`/home/ubuntu/berryit-support/deploy/berryit-support`:

- Hela databasen inklusive Auth/MFA/sessioner, Storage-metadata, public-tabeller,
  audit, ledger, funktioner, ACL och policies. Separat granskade globals/ägarskap
  och nödvändiga credential-/rollberoenden.
- Faktiska filer i `berryit-support-storage-data`, tillsammans med DB-snapshoten.
- `compose.yaml`, `gateway/Caddyfile`, `db/init/00-berryit-roles.sql`,
  `db/init/99-berryit-jwt.sql`, skyddad `secrets/stack.env`, de sex tillämpade
  migrationsfilerna, granskade verktyg och exakta image-digests.
- BerryITs egen `berryit-support-gateway-data` där persistent Caddy-state behövs.
  Inga andra produkters volymer, SSH-privatnycklar eller Tailscale-identiteter.
- Nödvändiga JWT-/Auth-/Storage-secrets i krypterat återställningsmaterial, aldrig
  i rapport, Git, Desktop eller publikt hashmanifest. `stack.env` är 901 byte,
  mode 0600; innehållet redovisas inte.

Skrivstopp/dränering eller en verifierad konsistent snapshotmetod krävs för att
DB, Storage och konfiguration ska representera samma punkt. DB-backup innehåller
inte själva Storage-objekten; se
[Supabase backups](https://supabase.com/docs/guides/platform/backups).

### Produktionsblockerare återkontrollerade

- Exakt samma **sex** migrationer ligger i ledgern; de tio väntande är inte körda.
- Helperns body-MD5 är fortsatt `7046b3ef55adcf0b7ec7a454d43c106c`;
  anon EXECUTE finns fortfarande på helper och rank-wrapper. Hotfixen är inte körd.
- En skyddad global ägargrant och en aktiv legacy-teknikerprofil; ingen ny global
  teknikergrant. Tidigare scopebeslut återstår inför migration 9.
- Compose/Caddy och de äldre driftverktygens SHA-256 matchar PASS 3A. De äldre
  osäkra serverskripten kördes inte och ska fortfarande inte köras.
- `/health`, Auth-health och Storage-status ger 200; `/ai/v1/health` ger fortsatt
  404. Ingen inferens gjordes.
- Extern backup/recoveryidentitet finns inte verifierad. Vercel-avstängning,
  privat Next-runtime, AI-transport/image och beroendegrindar från PASS 3A/3B
  är inte stängda genom detta pass. Vercel-inställningar granskades inte på nytt.

## 3. Core-node-01: kapacitet och hälsa

| Resurs | Observation |
|---|---|
| Monterat root-filsystem | 105 089 261 568 byte totalt; **45 100 326 912 byte ledigt = 42,00 GiB**, 55 % använt |
| Fysisk disk | Cirka 1 TB; root-LV är 100 GiB. Oallokerat/ej monterat utrymme räknas **inte** som tillgänglig backupkapacitet |
| RAM | 8,24 GB totalt, cirka **5,69 GB tillgängligt** vid mätningen |
| Swap | 4,01 GB totalt, cirka 3,30 GB ledigt |
| Load 1/5/15 min | 0,37 / 0,38 / 0,43; detta är load, inte en CPU-procent |
| Docker | **21 körande, 47 ej körande**, totalt 68 |
| Befintlig teststack | Sju körande `berryit-iso-83a2f62f`-containrar; DB/Auth/AI-adapter healthy, gateway/Auth/Storage-health 200 |
| SSH/Tailscale | Båda servrar nås med befintlig strikt SSH. Tailscale Running/online; ping prod → core lyckades direkt |
| Backupverktyg | GPG, OpenSSL, tar, sha256sum, rsync och Docker finns. **Restic och Borg saknas på båda värdarna**. PG-verktyg används i befintlig DB-container |

**Diskhälsa: BLOCKED.** `smartmontools.service` är failed och journalen visar
DEVICESCAN-relaterat problem. Scan hittade ingen enhet. Riktad läsning med
`smartctl -d sat -H -A /dev/sda` nekades av filbehörighet; befintlig `sudo -n`
nekade också åtkomst. LVM-metadata kunde inte läsas med denna behörighet.
Ingen SMART-PASS eller faktisk diskkrasch kan därför påstås. Ingen övervakning
inaktiverades, ingen sudo-konfiguration ändrades och inget lösenord begärdes.
Behörig operatör behöver utföra den läsande SMART-kontrollen och vid behov
utreda USB-bryggans stöd innan destinationen godkänns.

### Föreslagen skyddad plats

`/srv/berryit-backup/` **finns inte och skapades inte**. `/srv` är rootägd 0755.
Förslag efter godkännande: dedikerad tjänsteägare, katalog 0700, repo under
`/srv/berryit-backup/berryit-prod/`, ny separat begränsad backupidentitet och
separat administrativ maintenance-/restoreidentitet. Ingen av dessa ska tillhöra
Docker-gruppen eller få shell/sudo. En särskild administratör behövs för
maintenance; produktionsnyckeln får inte vara den administratören.

Den befintliga `/home/glasso/backups` är 0775 och ligger på samma root-filsystem;
den accepteras inte som färdig skyddad destination i nuvarande skick.

### Minst 30 dagars retention

Planeringsbudget, **inte uppmätt produktionsdump**: högst **100 MiB per full
daglig uppsättning** för dagens cirka 12,6 MB DB+Storage och konfiguration.

| Scenario utan någon dedupliceringsvinst | Storlek |
|---|---:|
| 30 fulla dagliga kopior à 100 MiB | **3 145 728 000 byte**, 2,93 GiB |
| 35 dagars säkerhetsmarginal | **3 670 016 000 byte**, 3,42 GiB |
| Föreslagen initial repokvot | **8 GiB** |
| Föreslaget hårt avgränsat backupfilsystem | **10 GiB**, inkluderar repot |
| Föreslagen minsta hostreserv | **25 GiB ledigt**, utöver backuputrymmet |

42 GiB ledigt räcker numeriskt till ett totalt 10 GiB backupfilsystem och 25 GiB
hostreserv, med cirka 7 GiB marginal för liten staging/återställning under dagens
budget. Kvoter/reservationer är **inte konfigurerade**. Föreslagen hård gräns är
ett separat filsystem i en **ny, förallokerad 10 GiB imagefil**, monterat på den
nya backupplatsen efter godkännande. Inga befintliga partitioner/LVM-volymer ska
formateras eller utökas. Saknad montering ska stoppa backupservern; underliggande
mountpoint ska vara rootägd och oskrivbar för tjänsteanvändaren.

Rest-servers per-repo-gräns ersätter inte denna totala gräns, särskilt om en
klient kan skapa underrepositories. Negativtesta även detta och total full-disk-
hantering. Om en sådan avgränsning inte kan införas utan påverkan får backupen
inte aktiveras på det delade root-filsystemet. Kontrollera faktiskt utrymme före
varje körning och stoppa vid för liten marginal.

Långsiktig tillväxt är inte mätt. DB-storleken matchar PASS 3A:s tidigare
observation, vilket inte räcker för en tillväxtprognos. Registrera DB, Storage,
repository, senaste lyckade kopia och hostens lediga byte dagligen. Vid budget-
eller kvotavvikelse: larma/stoppa nästa skrivning, **radera inte skyddade äldre
kopior automatiskt för att skapa plats**. Om 100 MiB överskrids ska kapacitets-
planen räknas om före fortsatt godkännande.

## 4. Restic och Borg — rekommendation

| Alternativ | Säkerhets-/driftegenskap | Bedömning här |
|---|---|---|
| Restic över vanlig SFTP | Krypterar och versionerar; vanlig skrivbar SFTP ger inte i sig append-only | Kräver särskilt skydd på mottagaren |
| **Restic + rest-server append-only** | Mottagaren kan neka DELETE/överskrivning av befintliga backupobjekt; separat lokal maintenanceväg | **Rekommenderas** för tydligt raderingsskydd och verifierbara negativa tester |
| Borg över SSH med `borg serve --append-only` | Native SSH, kryptering/dedup. Append-only bevarar underliggande segment; logisk delete/prune kan fortfarande påverka synliga arkiv | Bra alternativ men kräver återställning av tidigare transaktioner och strikt separat compactionhantering |

Se primärkällorna för
[Restics append-only-modell](https://restic.readthedocs.io/en/stable/060_forget.html#security-considerations-in-append-only-mode),
[rest-server](https://github.com/restic/rest-server),
[Borg serve](https://borgbackup.readthedocs.io/en/stable/usage/serve.html) och
[Borgs append-only-/transaktionsåterställning](https://borgbackup.readthedocs.io/en/stable/usage/notes.html#append-only-mode-forbid-compaction).

Rekommenderad väg: Restic krypterar på prod **före** överföring. Trafiken går
genom begränsad SSH-forward över Tailscale till rest-server på cores loopback.
Repositorylösenord lagras i skyddad servercredential/0600-fil och separat
recoveryförvaring; aldrig i URL, argv, Git eller klient. Recoverynyckel och
åtkomstinformation måste kunna hämtas utan prod-värden. Restic kan ha flera
repositorynycklar; se [nyckelhantering](https://restic.readthedocs.io/en/stable/070_encryption.html).

### Föreslagen konfiguration — INTE KÖRD

- Versionslås Restic och rest-server med kontrollerade checksummor före installation.
  Installation på båda värdarna och en ny tjänst på core kräver separat godkännande.
- Kör rest-server som egen icke-privilegierad användare med snäv katalogåtkomst.
  Inga Docker-/produktvolymmonteringar. Separat konfigkatalog 0700; credentials 0600.
- Planerad bindning `127.0.0.1:8644`, endast efter kollisionskontroll. Avsedda
  flaggor: `--append-only`, `--private-repos`, explicit `--path`,
  `--htpasswd-file` och `--max-size 8589934592`. Kontrollera vald versions
  `--help` innan exakt unit fastställs. Ingen publik lyssnare eller Tailscale Serve-ändring.
- Ny SSH-identitet för prod → core. Endast lokal forwarding till denna loopback-
  port, inga fjärrforwards, shell, PTY, agent-/X11-forwarding eller sudo. Separata
  SSH Match/keyregler ska syntax-/negativtestas utan att störa befintlig SSH.
  Den nu använda operatörens adminnyckel får inte kopieras till prod.
- HTTP-identiteten får bara tillhöra BerryITs repo. Ingen lokal filväg/SFTP-
  skrivåtkomst till repot för produktionsidentiteten. Maintenance når repot via
  separat skyddad lokal administrationsväg på core, aldrig via prod.
- Efter installation: negativa tester med **produktionslik backupidentitet**
  måste neka DELETE, overwrite, andra repo, shell och andra forwardingmål;
  bekräfta att en gammal verifierad kopia fortfarande kan återläsas.

### Daglig drift, retention och larm

Föreslå 02:15 Europe/Stockholm med lås som förhindrar överlapp, begränsade CPU/IO/
RAM-resurser, tidsgräns och retries som inte raderar någonting. Daglig fångst
behöver en godkänd konsistensmetod för BerryIT-skrivarna; ingen automatisk
containeromstart ingår. Backupen ska innehålla samtliga komponenter i avsnitt 2,
hashmanifest och verifierat Restic-snapshot-ID. `restic check` kompletteras med
verklig återläsning; arkivstatus ensam räcker inte.

Retention föreslås till minst 35 dagar med separat core-ägd maintenance och
granskad `--keep-within`-policy. Prod får aldrig prune-/raderingsrätt. Snapshot-
tidsstämplar från en komprometterad klient är inte betrodda: core ska registrera
eget mottagningstillfälle och verifierat snapshot-ID, stoppa gallring vid avvikelse
och bevara senaste oberoende verifierade återställningspunkt. Inled med dry-run;
gallringsaktivering kräver eget godkännande. Ingen gallring konfigureras här.

Larm behövs både vid exitfel/timeout och **utebliven** backup: kontroll från core
av senaste verifierade kopia, kvot/disk, `check`-resultat och restoreålder.
Föreslaget mål: daglig backup/RPO 24 h, larm senast vid 25 h utan verifierad kopia.
Mål och larmmottagare behöver beslutas. BerryIT Monitoring är inte driftsatt i
den nuvarande sexmigrationsbasen och kan inte antas leverera larmen redan idag.
Ingen verklig e-post, Discord-notifikation eller annat meddelande skickades.

### Komprometterad prod / förlust av core

- En begränsad append-only-identitet ska inte kunna radera äldre kopior. Den
  kan fortfarande tillföra felaktiga kopior, fylla sin kvot och läcka data som
  dess nyckel kan läsa. Kvot, oberoende larm och behållen känd god kopia behövs.
- Kontrollera före GO att prod inte har andra credentials som ger administrativ
  åtkomst till core; begränsningen på en ny backupnyckel räcker inte annars.
- Core-admin/root eller ett fullständigt hostintrång kan radera det lokala repot.
  Core kör andra produkter och är ingen immutable vault. Separat Unix-användare
  och kryptering eliminerar inte denna risk.
- Vid total förlust av core försvinner enda backuphistoriken om ingen ytterligare
  kopia finns. Överlevande prod kan ge en ny backup men återskapar inte historik.
  Vid förlust av båda utan tredje kopia saknas återställningsväg.
- Minsta komplettering: en krypterad, frikopplingsbar kopia på redan ägd Windows-/
  USB-lagring, förvarad separat från core, med recoverymaterial separat. Sådan
  lagring är inte inventerad eller beslutad. Alternativt krävs uttryckligt
  accepterad kvarvarande hostförlustrisk. Ingen VPS/molntjänst behöver beställas
  för att först undersöka denna möjlighet.

## 5. Faktiskt testat — riktig PostgreSQL, ingen PGlite

Källa: befintlig `berryit-iso-83a2f62f`, sju containrar med restart-policy no,
PostgreSQL 17.6 och samma DB-image som produktionen. Testdatabasen hade 52
syntetiska konton inom tillåtna testdomäner, noll oklassificerade och inga andra
aktiva frågor vid kontrollen. Domänkontrollen kompletterar att detta är den
tidigare dokumenterat syntetiska teststacken; det är inte en generell metod
för att klassificera okänd produktionsdata.

Skriptet `deploy/berryit-support/backup-gate/isolated-postgres-recovery.py` vägrar
annan miljö/host, externa DB-variabler, ändrat container-ID/nätverk, okänd källa
och kollision med befintlig restore-DB. Det installerar eller raderar ingenting.

Run-ID: `5ebfe50634ca45c7b2260cefef4261c3`.

- Skyddad testkatalog:
  `/home/glasso/berryit-iso-83a2f62f/recovery-5ebfe50634ca45c7b2260cefef4261c3`.
- Ny DB: `berryit_3c_5ebfe50634ca45c7`, med körningsspecifik ägarkommentar.
- `pg_dump -Fc`, granskad globals-export **utan rollösenord**, faktisk Storage-
  volym, konfigfiler och ett nytt syntetiskt konfigsecret fångades. Inga proddata.
- Explicit egen GPG-homedir, syntetisk engångsnyckel, kryptering/signatur och
  SHA-256 för varje komponent. Det är inte produktionens recovery-nyckelhantering.
- Avbruten simulerad transportprocess gav **exit 23**, partiell fil och ingen
  COMPLETE-markör. Hashkontroll avvisade partial och bekräftade oförändrad god
  ciphertext. Det är ett felhanteringstest, inte en bruten WAN-/prod→core-session.
- Manipulerad ciphertext avvisades av signaturkontroll.
- Verifierat paket dekrypterades till ny katalog. `pg_restore --exit-on-error
  --single-transaction` gav **exit 0** i ny databas. **81 public/Auth/Storage-
  tabeller** jämfördes med källan, inklusive ledger och audit; RLS/policies och
  helperns kropp/EXECUTE-ACL matchade. **Två faktiska Storage-filer** och
  konfiguration matchade byte för byte. Källa/Storage förblev stabila.

| Mätning | Faktiskt resultat |
|---|---:|
| Ny syntetisk GPG-nyckel | 0,364 s |
| Fångst och kryptering | **0,972 s** |
| pg_restore | **1,443 s** |
| Dekryptering, återläsning och kontroller | **17,223 s** |
| Syntetisk DB-dump | 798 252 byte |
| Syntetisk krypterad bundle | 176 872 byte |
| Genomförda komponent-/negativ-/påverkanskontroller | **7/7 PASS** |
| Lokal Python-syntax och negativa miljö/cleanup/hostfall | **PASS, 3 negativa fall** |

**Bevisgräns:** källan hade 16 migrationer; detta är inte ett dump-/restorebevis
för produktionens sexmigrationsdatabas. Återställningen delar befintliga
clusterroller, globals exporterades men återställdes inte över dem. Riktiga
JWT-/Auth-secrets ersattes inte i någon tjänst. Ingen Auth/MFA/Storage-HTTP-
tjänst pekades om till restore-DB:n. Restic/Borg, append-only, separat backup-
identitet och prod→core-backuptransport är **inte testade**, eftersom installation
och permanent konfiguration inte är godkända. Tidigare PGlite-resultat används
inte som bevis för detta verkliga PostgreSQL-test.

Full drift-RTO kan inte härledas från 17 sekunders lokalt test. Föreslagen
planeringsbudget är **30–60 minuter** för dagens lilla datamängd inklusive
operatör, nyckelåtkomst, ny isolerad runtime och Auth/MFA/Storage-verifiering;
detta är en uppskattning som måste mätas med riktig backup innan RTO godkänns.

### Skyddade tjänster efter testet

Alla **68** befintliga containrar hade samma ID, state, starttid och restart count
före/efter. De **26** tidigare pausade containrarna i de fyra kända Compose-
miljöerna var fortfarande stoppade med faktisk restart-policy no. Övriga 21
stoppade containrar återstartades inte heller.

FLIQS-app healthy och HTTP 200; bot running. AuroraPark och Allstars befintliga
healthchecks var healthy. Auth-restart count 2 respektive 4 är äldre oförändrade
värden, inga nya omstarter i passet. SSH fungerade och Tailscale var Running/online.
Inga Compose-filer eller andra produkters konfiguration ändrades.

## 6. Nästa exakta godkännanden och körordning

### A — destination, verktyg och syntetiskt säkerhetstest

Begär ett avgränsat godkännande för att:

1. Låta behörig operatör verifiera diskhälsa med befintligt smartctl; utreda
   brygg-/diskfel vid behov. Ingen avstängning av övervakning som genväg.
2. Versionslåsa/installera Restic på prod och core samt rest-server på core,
   skapa exakt skyddad BerryIT-katalog/identiteter, nytt avgränsat 10 GiB
   filsystem enligt ovan, hårda gränser och begränsad
   SSH-väg. Bevara SSH-/unitförebilder; syntaxvalidera före aktivering. Ingen
   annan tjänst får påverkas. Detta innefattar produktionskonfigurationsändring
   och får därför inte genomföras med detta PASS 3C-godkännande.
3. Initiera endast rätt repo med ownerbeslutad recoveryförvaring. Testa faktisk
   mottagaråtkomst och recovery från separat identitet, inklusive nekat delete/
   overwrite/annan repo/shell, avbrott och full syntetisk återställning via den
   valda Restic-vägen. Sätt inga riktiga kunddata i detta test.
4. Besluta 35 dagars retention, kvot/reserv, oberoende mottagningsjournal och
   larmmottagare. Godkänn daglig scheduler separat efter en manuell lyckad körning;
   maintenance/gallring ska ha eget godkännande och separat credential.
5. Besluta tredje frikopplade kopia eller dokumenterat accepterad kvarvarande
   coreförlustrisk. Verifiera recovery utan att prod är tillgänglig.

Vid godkänt A ska konfiguration och rättigheter kunna återställas från exakt
före-bild. Ingen rollback får radera repodata, starta pausade containrar eller
återställa en databas över befintlig produktion. Ta inte bort en fungerande
skyddsregel automatiskt efter fel; håll nästa grind stängd.

### B — första riktiga krypterade produktionsbackup och isolerad restore

**Får begäras först efter verifierat A.** Exakt godkännande ska omfatta:

> Ett avtalat BerryIT-skrivstopp/dräneringsfönster på prod-node-01 för full
> DB+roller+Storage+konfig-fångst enligt avsnitt 2; kryptering före överföring till
> godkänt append-only-repo på core-node-01; oberoende återläsning och dekryptering
> till nya skyddade BerryIT-ägda återställningsresurser på core. Detta innebär
> uttrycklig tillåtelse att hantera verkliga Auth-/kund-/konfigdata där.
> Ingen migration/hotfix, inferens, radering, ändring av andra produkter eller
> omstart av befintliga tjänster ingår.

Körordning efter B:

1. Läs om host, exakt ledger/hashes, container-/volym-ID, kapacitet och skydd.
   Avvikelse eller misslyckat append-only-/recoverytest → STOPP.
2. Nytt kör-ID och skyddad staging; håll godkänd konsistensspärr genom full
   pg_dump/globals, Storage och konfig. Kontrollera **alla** exitkoder och
   komponenthashar. Inga äldre backup-/security-/cleanupskript.
3. Restic krypterar och överför till append-only-repot. Registrera snapshot-ID
   och cores oberoende mottagning. Verifiera genom faktisk återläsning med
   separat identitet; ett lyckat uploadmeddelande stänger inte grinden.
4. Full restore till nya namngivna resurser. Nya isolerade runtimecontainrar,
   portar och nät måste ingå i godkännandet och får inte ersätta nuvarande
   teststack. Ingen annan miljö eller någon tidigare pausad container startas.
   Ingen publik exponering och ingen egress till riktiga providers/webhookar/mail.
5. Återställ granskade globals/ägarskap, DB, faktiska blobs och skyddade secrets;
   verifiera konsistens, RLS/ACL, audit, objektfiler och riktig Auth/login/TOTP,
   live-session, PostgREST/RPC och interna/kundsynliga Storage-anrop. Nya och
   återkallade rättigheter ska gälla. Gamla basens kända läcka bevaras av en
   trogen restore; miljön ska därför förbli strikt isolerad.
6. Dokumentera verklig capturetid, RPO/RTO, hashmanifest, snapshot-ID, test-
   och åtkomstresultat utan hemligheter. Godkänn backupgrinden först efter
   operatörsgranskad PASS. Fel ger stopp och bevarade skyddade artefakter.

### C och D — efter backupgrinden

- **C:** separat godkännande för redan testad `active_support_grants`-hotfix,
  exakt sexmigrationsbas och hotfixens README/manifest. Verifiera riktiga HTTP-
  nekanden, egen lookup, beroenden och audit. Ingen automatisk återgång till
  läckande kropp/anon-ACL.
- **D:** först därefter separat godkännande för PASS 3A:s tio migrationer, i
  dokumenterad ordning. Legacy-scope, MFA, övriga driftblockerare och rollback-
  bevis måste vara klara. Detta pass ger inget sådant godkännande.

## 7. Kostnad, leverans och stopp

Ingen VPS/molnlagring beställdes och ingen ny löpande infrastrukturtjänst behövs
utifrån kapaciteten. Restic/Borg har fria BSD-licenser; se
[Restic LICENSE](https://github.com/restic/restic/blob/master/LICENSE) och
[Borg LICENSE](https://github.com/borgbackup/borg/blob/1.4-maint/LICENSE).
Installation, förvaltning, el och eventuell separat offlineenhet kan medföra
arbete/kostnad som inte är prissatt här. Ingen hårdvaruförändring motiveras
innan diskhälsan och redan ägd offlinekapacitet har klarlagts.

Om disken visar verkligt fel ska den inte bli enda backupdestination. Minsta
alternativ är en annan redan ägd frisk disk för den skyddade destinationen,
plus separat återställningskopia. Finns ingen sådan krävs ett nytt ägarbeslut
om lagringsmedium; detta pass beställer inget och antar inte att hårdvara finns.

Nya lokala filer: denna rapport, `backup-recovery-pass3c-manifest.json` och
`deploy/berryit-support/backup-gate/isolated-postgres-recovery.py`. Tidigare tio
granskningsfiler är bevarade; totalt 13 ospårade filer, tom tracked/staged diff.
Mätningar och redigerade testresultat ligger ignorerade i `test-results/pass3c`.
Manifestet innehåller leveranshashar och spårbar status, inga nycklar eller PII.

**Stopp:** befintliga servrar räcker kapacitetsmässigt. Destinationen är inte
säkrad för drift ännu. Ingen riktig produktionsbackup eller driftändring får
utföras innan A/B uttryckligen har godkänts och respektive föregående grind är PASS.
