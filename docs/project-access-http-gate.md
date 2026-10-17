# Återstående isolerad HTTP-/MFA-grind — förberedd, inte körd

Denna fil är en körplan. Den provisionerar ingenting och innehåller inga
produktionstokens. Nuvarande Windowsmiljö saknar komplett Supabase-stack.
`npm run db:http-preflight` gav BLOCKED, exit 2. SQL/PGlite-resultat i
`project-access-master-2026-10-16.md` får inte räknas som denna grind.

## Förutsättningar efter separat godkännande

1. Godkänd Linuxvärd, ny testkatalog/databas, eget UUID run-ID, verifierat lediga
   loopbackportar och dedikerade containrar/nätverk/volymer. Inga befintliga
   produktions-/stagingvolymer, kunddatadumpar, nycklar eller databas-URL:er.
2. Läs och jämför container-ID, etiketter, mountmål, databasnamn och en DB-marker
   mot samma run-ID. Okänd/produktionsklassad eller återanvänd miljö avbryter
   FÖRE första skrivning. Enbart ett miljövariabelnamn är inte en miljöattest.
3. Versionsbundna PostgreSQL/GoTrue/PostgREST/Storage/gateway-komponenter enligt
   BerryITs befintliga stack. E-post skickas aldrig till riktiga mottagare.
4. Verifiera äldre sexmigrationsbas med syntetisk fixture, ta testbackup och
   applicera de åtta tidigare stegen följt av nya projekt-/rollmigrationen.
   Använd riktiga leverantörsscheman, INTE local_bootstrap/local_storage_bootstrap
   från PGlite i en riktig Supabase-stack.
5. Använd samma runtime-SDK-version som repo. Skapa syntetiska testkonton med
   isolerad Auth-admin; generera separata testnycklar. Hemligheter stannar i
   testprocessen/den uttryckligen isolerade serverns secret store, aldrig i
   Desktop, logs, kod eller kommandorad.

## Testmatris — riktiga HTTP-anrop

| Test | Anrop/flöde | Förväntad kontroll |
|---|---|---|
| Konto + login | GoTrue SDK signInWithPassword; riktiga access-/refresh-token | Aktivt testkonto fungerar; fel inloggning nekas |
| Spärrad registrering | Befintlig kundregistreringsroute och Auth-trigger | Ingen e-post, ingen inloggning innan separat aktivering |
| MFA | SDK auth.mfa.enroll(TOTP), challenge, verify med testgenererad kod | aal1 kan inte administrera; giltig aal2 med levande egen session kan |
| Tokenmanipulation | PostgREST med ändrad sub/aal/role, trasig signatur, utgången token | Nekas av Auth/PostgREST, inte bara av UI |
| Liveness | Logga ut/radera endast testidentitetens session; återanvänd gammal JWT | Privilegierad begäran nekas omedelbart |
| Kontoinaktivering | set_support_user_active; använd gamla testtoken | Alla appdata och skriverättigheter nekas av aktuell RLS |
| Katalog/mall | Rollkatalog + save_support_role via skyddat API/RPC | Okända permissions, systemflagga, rank och systemrollsredigering nekas |
| Delegering | IT SUPPORT/DEVELOPER/ADMIN, eget/annat tenant-/projektscope | Ingen själv-/ägarhöjning, inget högre eller bredare delegationsscope |
| Flera roller | Tilldela två explicit avgränsade mallar | Union inom rätt scope, aldrig permission/rank lånad från annat tenant |
| Revocation | Ändra/inaktivera mall och återkalla grants under samma session | Nästa faktiska HTTP-kontroll använder aktuell DB-status |
| Projekt | Skapa utan integration, redigera med revision, arkivera/återaktivera | Samma register; inga underliggande resurser raderas |
| Resurs-ID | Org A/B, projekt A/B, manipulerad server/tjänst/kontakt/ärende | Tenant-FK och resurspermission stoppar förväxling |
| Ärenden | Projektbegränsad IT SUPPORT skapar/svarar/noterar/laddar upp | Bara rätt projekt; tickets.write ger inte tickets.reassign |
| Kundportal | Kund och org-kontakt mot egna/fremmande ärenden | Samma kundidentitet bevarad; inga interna anteckningar/bilagor |
| Storage | Riktiga upload/download/signed URL, alias och manipulerade paths | Giltig ticket/message/tenant-bindning, inga interna objekt till kund |
| Communications/MFA | Befintlig säkerhetsmatris via riktiga REST/Storage-anrop | Interna meddelanden och deltagarscope kan inte kringgås |
| Kodgranskning | repository route + egen godkänd testrepo och lästoken | Projektpermission + serverallowlist + provider-ID krävs; bara GET |
| Kodförslag | save_repository_review inom/utanför scope och efter revocation | Privat BerryIT-anteckning, inget externt repo skrivs, kodtext ej i audit |
| Upptäckt | Upprepa service-role discovery med pinnad testidentitet | Samma projekt; inga grants; manuella fält bevaras; fel tenant nekas |
| Audit | Tillåtna/nekade API-åtgärder, direkta felande RPC:er | Append-only data, korrekt aktör; även DB/API-loggar för rollbackade fel |

## Verkliga samtidighetstester

Använd två eller fler oberoende PostgreSQL/HTTP-sessioner i TESTSTACKEN:

- Håll rollradslås i A; försök grant i B och malländring i C. Endast godkänd
  preview med aktuell assignment-version får ändra mallen.
- Ny mottagare mellan preview och ändring ska ge konflikt/ny preview.
- Samtidiga importer av samma provider-ID ska ge en identitet och ett projekt,
  inte två projekt eller automatisk behörighet. Ett korsande tenant ska nekas.
- Samtidig återkallelse/inaktivering och nästa resursbegäran ska inte medge
  någon ny operation efter att återkallelsen blivit committed.
- Spara verkliga statuskoder, transaktionsutfall och audit; ett avbrutet/deadlockat
  försök får inte lämna halvskrivna grants, projekt eller permissions.

PGlite testar redan efter-preview-ändring och aktuella kontroller sekventiellt.
Denna fleranslutningsgrind är ett separat, ännu ej verifierat driftkrav.

## Native Windows efter verifierad backend

Använd separat testprofil/Windowsidentitet eller verifierat avskild Credential
Manager-namnrymd, och bara teststackens publika nyckel/endpoint. Verifiera login,
TOTP-enroll/verify, refresh/logout, offline/återanslutning, projektscope,
rollrevocation och supporthelresa i den riktiga byggda appen. Ingen befintlig
Windows-session/config får skrivas över som bieffekt. Installera inget i detta pass.

## Stopp och bevis

Inget syntetiskt eller verkligt serverinnehåll rensas automatiskt. Eventuell
framtida cleanup får bara hantera explicita ägarmärkta run-ID efter separat
kontroll; gamla seed-/cleanup-skript används aldrig. Före produktionsbeslut
krävs dessutom verklig DB+Storage+Auth-restore till separat stack, checksumma,
RPO/RTO, skyddad ägaråterställning och nytt uttryckligt migrations-/deploygodkännande.
