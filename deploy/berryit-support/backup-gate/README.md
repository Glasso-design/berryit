# PASS 3B — krypterad backup och återställningsgrind

**Driftstatus: BLOCKED.** Användaren har bekräftat att ingen extern destination
är beslutad. Inga credentials eller krypteringsmottagare har provisionerats i
detta pass. Ingen produktionsbackup, överföring eller restore har körts.

Detta är en operatörsplan och ett lokalt syntetiskt test, inte en ny backupserver
eller en autonom exekverare. Gamla serverkopior av backup-/restore-/security-
skript ska inte köras. De granskade reposkripten är heller inte en komplett
krypterad extern backup: de saknar hela konfigurations- och offsitekedjan.

## 1. Beslut före körgodkännande

| Beslut | Konkret krav | Status |
|---|---|---|
| Extern lagringsplats | Separat fel-/åtkomstdomän utanför prod-node-01, beslutad region och dataskydd. Exempel på profil: separat S3-kompatibelt EU-mål med versionsskydd, eller godkänd separat backupvärd | BLOCKED, inget mål valt |
| Skrividentitet | BerryIT-ägd, begränsad till aktuell backup-prefix; ingen Delete eller klientdistribution | Saknas |
| Återläsningsidentitet | Separat verifierad List/Get, tillgänglig även om prod-värden förloras | Saknas |
| Kryptering | Verifierade mottagarfingerprints, separat förvarad återställningsnyckel och skyddad recovery-kopia. Privat dekrypteringsnyckel ska inte ligga i Desktop/Git eller krävas på prod | Saknas |
| Äkthet | Godkänd signerare, verifierad fingerprint och separat betrodd distribution av signerarkey/checksumma | Saknas |
| Återställningsmiljö | Separat godkänd isolerad stack med samma versions-/arkitekturkrav, inga prod-URL:er, externa skrivare eller verklig e-post/AI | Måste godkännas |
| Retention och driftmål | Ägare beslutar RPO, RTO, kapacitet, lagringstid och ev. immutabilitet. Inget automatiskt raderingsjobb i releasegrinden | Ej beslutat |

Ingen återanvändning av andra produkters credentials, klientnycklar eller volymer.
En lokal krypterad fil är inte offsite; lyckad upload är inte ett restorebevis.

## 2. Sammanhängande fångst — framtida godkänd åtgärd

1. Läs och godkänn exakta BerryIT-container-ID, image-digests, DB-majorversion,
   volymer, Storage-filbackend och gällande migrationsledger. Använd granskade
   filhashar; ingen generell `stack.sh up`, pull eller installation ingår.
2. Välj unik körningsidentitet och ny skyddad katalog på prod. Använd umask 077,
   katalog 0700, filer 0600, kontrollerad ägare, tillräckligt ledigt utrymme och
   verifierad krypterad lokal stagingdisk. Ingen symlink, gammal katalog eller
   okänd sökväg får accepteras. `set -euo pipefail`; inget `set -x`.
3. Lägg **enbart BerryIT** i godkänt skrivstopp. Dränera pågående anrop och
   pausa dess bakgrundsskrivare. Dokumentera tidpunkt och håll spärren genom
   DB-, Storage- och konfigfångsten. Separata pg_dump- och tar-kommandon utan
   skrivstopp ger inte en gemensam återställningspunkt.
4. Fånga full `postgres`-databas med versionsmatchad `pg_dump -Fc`, inte bara
   public-schema: Auth-användare/sessioner/MFA, Storage-metadata, ärenden,
   audit, policies, funktioner och ledger ska ingå. Fånga även nödvändiga
   roller/ägarskap/grants via granskad `pg_dumpall --globals-only` och förvara
   dessa som känsliga data. Importera inte plattformens globals blint över
   befintliga Supabase-systemroller vid restore.
5. Fånga faktiska Storage-objekt från **verifierad BerryIT-volym**, read-only,
   med sökvägar/filmetadata. Inga andra produktvolymer och inget Docker-socket
   i hjälparcontainer. Dokumentera UID/GID och säker återställningsmetod.
6. Fånga BerryIT Compose, Caddy, skyddad stack.env, nödvändiga JWT-/signerings-
   och tjänstekonfigurationer, versions-/digestlista och funktionernas/ACL:s
   före-bild. Skydda allt som secrets; ingen upplistning av värden i rapport.
7. Skapa **krypterat inre manifest** med kör-ID, capturetid, sourceversion,
   ledger, komponentstorlekar och SHA-256, Storage-objektens hashmanifest,
   formatversion och konsistensmetod. Lägg DB, globals, Storage och config i
   separata standardarkiv eller ett granskat paket med exakt filförteckning.
8. Kryptera varje komponent till godkända mottagare före extern överföring.
   Befintlig GPG kan användas efter separat verifiering. Ange alltid explicit
   ny, skyddad `--homedir` och `--no-options`; kör aldrig nyckellistning mot
   standardhemkatalog som påstått läsande förkontroll. Importera bara förhand-
   verifierade publika mottagarnycklar i denna prod-katalog. Ingen privat
   recovery-nyckel behövs för kryptering.
9. Alla producent-, arkiv- och krypteringskommandon måste ha exit 0; kontrollera
   också icke-tom payload och komplett manifest. Använd inte pipelines som
   ignorerar en felande pg_dump eller tar. Inga okrypterade komponenter får
   lämna skyddad stagingmiljö. Om streaming används, aktivera pipefail och
   verifiera **samtliga** exitkoder; kryptokommandots exit räcker inte.
10. Beräkna SHA-256 på ciphertext, signera checksumme-/leveransmanifest med
    godkänd signerare. Kopiera enbart ciphertext + signerad leveransmetadata
    med separat begränsad skrividentitet. Inga hemliga sökvägar/personuppgifter
    i det publika manifestet. Läs tillbaka objekten via återläsningsidentiteten
    och verifiera signatur/hash, inte bara uploadstatus eller objekt-ETag.
11. Dokumentera capturetid, avslut, storlekar, hash och destination/version-ID
    utan credentials. Öppning av skrivtrafik efter fångsten är ett separat
    operatörsbeslut. Uppgraderingen får inte börja före godkänt restorebevis.

Kommandokontrakt för **framtida granskning**, ej ett färdigt produktionsskript:

```text
pg_dump -Fc + pg_dumpall --globals-only -> skyddad staging eller granskad ström
Storage read-only tar + konfig tar + krypterat inre manifest
gpg --no-options --homedir <explicit-skyddat-hem> --batch
    --recipient <verifierad-full-fingerprint> --output <ny-fil.gpg> --encrypt <payload>
SHA-256(ciphertext) + betrodd signatur -> extern upload -> faktisk återläsning
```

Inga verkliga sökvägar, credentials eller destruktiva körkommandon ska fyllas i
utan den godkända destinationen och operatörens verifierade körmanifest.

## 3. Full restore — separat godkänd isolerad miljö

1. Läs tillbaka den externa, krypterade kopian med separat identitet. Verifiera
   signerare, hela fingerprints, ciphertext-SHA och körmanifest **före** restore.
   Fel/missing komponent → STOPP; försök inte delrestore som PASS.
2. Dekryptera endast i ny, ägarmärkt 0700-katalog på skyddad isolerad lagring,
   med privat recovery-nyckel från separat förvaring. Ingen nyckel i argv/env/logg.
   Kontrollera samtliga dekrypteringskoder och inre manifest/hashar.
3. Granska arkivmedlemmar före extraction: inga absoluta namn, `..`, symlänkar,
   hardlinks, devicefiler, okända/duplicerade filer eller ägarskapsöverskrivning.
   Exakt allowlist från betrott manifest; ingen restore över befintlig katalog.
4. Start av separat teststack kräver eget godkännande. Matcha Postgres/Supabase-
   versioner, nödvändiga extensions, roller, UID/GID och image-digests. Ha inga
   prodnätvägar, providercredentials, webhookar, riktiga mail eller AI-anrop.
5. Applicera granskade nödvändiga globals i rätt ordning utan att skriva över
   målplattformens skyddade roller. Restore till **ny isolerad databas**, med
   `pg_restore --exit-on-error` och kontrollerad ägar-/ACL-strategi. Ingen
   `--clean`/DROP mot delad databas. Varken stderr eller exit får ignoreras.
6. Återställ Storage-filer och konfiguration från **samma** capture. Kontrollera
   objektmetadata mot blobs och samtliga hashvärden. DB-backup ensam återställer
   inte filobjekten. Rikta återställda konfigurationer till isolerade värden;
   bevara Auth-kryptografiskt material som behövs för att validera restore, men
   tillåt aldrig testmiljön att kontakta riktiga integrationsmål.
7. Kontrollera schema, constraints, RLS, funktions-ACL, ledger, kund-/ärende-
   relationer, interna anteckningar, audit och Storage-referenser. Troget restore
   av den gamla basen återställer även dess kända brister; håll miljön isolerad
   och applicera bara godkänd hotfix/uppgradering före öppning.
8. Kör riktig GoTrue login/TOTP, live-session/MFA, PostgREST/RPC med rätt/fel
   identitet och organisation/projekt, återkallad grant samt Storage upload,
   download och signed URL för interna/kundsynliga bilagor. Använd endast
   syntetisk data tills särskilt godkännande för produktionsdatakopia finns.
9. Dokumentera start/slut, observerad datatid, faktisk RPO/RTO, alla exitkoder,
   negativa tester, avvikelser och signerat restorebevis. Stäng grinden först
   när den **externa** kopian och oberoende nyckelåtkomst har återställts.

## 4. Rensning, misslyckanden och rollback

- Ingen automatisk gallring, EXIT-delete, databasdrop, volume-prune eller
  produktionsstädning som del av backup eller restore. Ett misslyckande ska
  bevara skyddade diagnostik-/körartefakter och stoppa nästa fas.
- Rensning är ett separat godkänt arbete med explicit kör-ID, filförteckning,
  verifierat ägarskap, absolut sökvägsavgränsning och godkänd retention. Inga
  wildcard- eller ämnesbaserade raderingar. Inga kunddata eller befintliga
  volymer får raderas av denna grind.
- Misslyckad uppgradering: behåll underhållsspärr; återställ sammanhängande
  DB+Storage+konfiguration till **nya** godkända resurser, verifiera före växling.
  Bevara originalresurser. Ingen automatisk down-migration eller restore över
  levande produktion. Andra produkter påverkas inte.

## 5. Lokalt test och dess bevisgräns

```powershell
node deploy/berryit-support/backup-gate/synthetic-restore.test.mjs --environment=isolated-pglite
```

Använder bara befintlig GPG, Windows tar och PGlite. Ingen installation eller
nätverkskontakt. Externa databasvariabler vägras. Ny kort kör-ID-katalog i
`test-results/pass3b/sb-*`, Windows-ACL med endast aktuell användare och egen
GPG-homedir; syntetisk engångsnyckel utan passphrase **endast i detta test**.
Detta är inte lämplig produktionens privata recovery-nyckelhantering.
Testartefakterna är ignorerade av Git och lämnas skyddade; ingen automatisk
filrensning. Endast de nya lokala GPG-agenternas processer avslutas.

Testet skapar riktig SQL-bas/fixture, PGlite-snapshot, ett syntetiskt Storage-
objekt, konfig, inre hashmanifest, tar, GPG-kryptering och betrodd signatur.
Återläsning verifierar ciphertext/signatur, dekryptering, arkivallowlist,
ny destination, komponenthashar, DB-rader/audit/RLS/ACL och filreferenser.
Negativa fall: manipulerad hash/signatur, saknad privatnyckel, saknad komponent,
path traversal, länk, befintlig/extern destination och komponentdrift.

**PGlite-dataformat är inte pg_dump/pg_restore.** Offsitekatalogen är en lokal
simulering. Inget riktigt PostgreSQL CLI-, externt nät-/credentials-, Supabase
HTTP-, Auth/MFA- eller Storage-service-restore-PASS påstås. Dessa är BLOCKED
tills separat miljö och destination har godkänts. Ingen ny serverstack startas.

Se [Supabase: backups](https://supabase.com/docs/guides/platform/backups) om
skillnaden mellan databasbackup och faktiska Storage-objekt.
