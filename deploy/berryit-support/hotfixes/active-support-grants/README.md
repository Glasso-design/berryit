# PASS 3B: granskad hotfixkandidat, inte körgodkännande

Mål: endast BerryITs verifierade sexposters schema på prod-node-01. Ingen SQL i
denna katalog har körts där. Historiska migrationer och PASS 3A-manifestet lämnas
oförändrade. En separat operatörsåtgärd kräver uttryckligt godkännande.

## Risk och begränsning

Den driftsatta `public.active_support_grants(uuid)` är SECURITY DEFINER med tom
search_path men saknar caller-kontroll och tillåter EXECUTE för anon via PUBLIC.
En oautentiserad caller som känner ett användar-ID kan läsa aktiva `role_key`,
`scope`, `organization_id`. `max_support_rank(uuid)` är en ytterligare läsande
väg till härledd rang. Inga namn, e-postadresser, lösenord, grant-ID eller tokens
returneras av dessa kontrakt. Det är informationsläckage, inte i sig ett bevis
för att anroparen kan tilldela roller. Loopbackbindningen begränsar exponeringen
men reparerar inte RPC:n.

`apply.sql` återanvänder den senare granskade Security & CI-migrationens
caller-kontroll. Aktiva profiler och ej återkallade/utgångna grants krävs.
Inloggad användare kan bara slå upp sig själv; service_role och betrodd direkt
SQL behåller intern lookup. En SET ROLE-caller utan identitet blir inte betrodd
maintenance. Både helper och rank-wrapper förlorar PUBLIC/anon EXECUTE.
Authenticated/service_role behåller EXECUTE. Ingen ny rollmodell, dataflytt,
profiländring eller omskrivning av grants ingår.

Detta är inte full MFA-/organisationshärdning av den gamla sexmigrationsbasen.
De tio väntande migrationerna och legacy-grinden behövs fortfarande.

## Beroenden och verifierade kontrakt

- `has_support_permission` använder helpern med `auth.uid()`.
- `is_support_super_admin` använder helpern med `auth.uid()`.
- `max_support_rank` används av grant-triggern för den faktiska tilldelaren.
- Därigenom påverkas RLS för ärenden, anteckningar, bilagor, grants och audit.
- Funktionen behåller signatur, returkolumner, stabilitet, SECURITY DEFINER och
  tom search_path; byte av ägare eller utökad EXECUTE ingår inte.
- Direkt privilegierad SQL förutsätter redan betrodd databasidentitet. Klienter
  får aldrig ha SQL-adminåtkomst eller kunna sätta PostgRESTs verifierade claims.
- Senare migration 7 ersätter helpern med motsvarande självkontroll; migration 9
  inför projektmodellen. Isolerat test verifierar hela 6 → hotfix → 16-kedjan.

`apply.sql` kontrollerar exakt ledger och funktionskropp före ändring, använder
en transaktion, lock_timeout 2 s och statement_timeout 15 s. En nyare/okänd bas
nekas. Identisk återkörning accepteras; ledgern ändras inte. Basens MD5 används
som driftavvikelsekontroll, inte som ersättning för SHA-256 av leveransfilerna.

## Exakt framtida operatörsgrind — KÖR INTE NU

1. Kräv separat godkännande för just hotfixen, ansvarig operatör och fönster.
   Läs om hostname, BerryIT-containeridentitet, exakt sexposters ledger och
   helperns ägare, ACL och bodyhash. Driftavvikelse → STOPP. Bekräfta att
   betrodd databasägare äger funktionerna och att inga klientroller kan ändra dem.
2. Spara före-bild i ny BerryIT-ägd 0700-katalog: `pg_get_functiondef` för båda
   funktionerna, ägare, ACL, search_path, ledger och leveransens SHA-256.
   Filer 0600; inget på terminal eller i Git. Säkerställ krypterad skyddad kopia
   och testad separat återställningsåtkomst före ändringen. Destination saknas
   idag; backupgrinden är BLOCKED. Full DB+Storage+konfig-backup krävs före
   den senare fulla uppgraderingen.
3. Begränsa endast BerryIT-trafik enligt godkänt fönster. Kör exakt granskad
   `apply.sql` via befintlig betrodd SQL-identitet med `psql -X -v ON_ERROR_STOP=1`.
   Skriptet äger transaktionen. Ingen migrator/seed/cleanup eller extra SQL
   får följa med. Kontrollera exitkod; fel innebär stopp, inte fortsatt körning.
4. Läs tillbaka kropp, ACL, ägare och auditpost. Ledger fortfarande sex och
   grants oförändrade. Begär separat godkänd PostgREST-schemaomläsning om den
   behövs; ingen omstart av andra produkter.
5. HTTP utan Authorization/apikey mot båda RPC:erna ska nekas (401/403; inte
   200). Egen aktiv lookup ska fungera; annat användar-ID ska ge tomt/nekas.
   Ägartilldelning/återkallelse och befintlig ärendeåtkomst kontrolleras med
   avsedda behörigheter. Ingen syntetisk seed eller datarensning i produktion.
6. Håll trafikspärr vid fel. Dokumentera resultat; öppna först efter PASS och
   operatörsbeslut. Full uppgradering följer separat PASS 3A-plan och godkännande.

## Återställning och säker fallback

- Fel inne i transaktionen återgår atomiskt; ledger/grants ändras inte.
- Efter commit får den gamla läckande kroppen/anon-ACL **inte** återställas
  automatiskt. Bevara före-bilden som bevis och för granskad felsökning.
- `containment.sql` är separat godkänd fail-closed fallback: tar även bort
  authenticated EXECUTE på de två direkta RPC:erna, behåller serveråtkomst och
  den härdade kroppen. Den kan störa direkta klientanrop. Test visar att
  befintlig SECURITY DEFINER-ägarväg fortfarande fungerar; detta är därför
  **inte en generell spärr av all applikationstrafik**.
- Reparera framåt i underhållsläge. Nyare schema får inte nedgraderas till
  sexmigrationshelpern. Full återställning kräver separat verifierad backupplan;
  inga automatiska down-migrationer, containeråtgärder eller dataraderingar.

## Lokalt reproducerbart test

```powershell
node supabase/tests/active-grants-hotfix.test.mjs --environment=isolated-pglite
```

Ny minnesdatabas, enbart syntetiska identiteter, inga externa databasvariabler.
Testar läckan före fix, anon/rank-förbud, egen/annan identitet, inaktivitet,
expiry/revocation, SET ROLE, befintliga scoped helpers, ägartilldelning/audit,
eskaleringsförsök, baseline-/bodydrift, återkörning, samtliga senare migrationer
och fail-closed fallback. Detta är riktiga PostgreSQL/RLS-frågor i PGlite,
**inte** verklig PostgREST/JWT/MFA-verifiering av den applicerade hotfixen.

Funktionsrättigheter och SECURITY DEFINER ska behandlas separat från tabell-RLS;
se [Supabase: Database Functions](https://supabase.com/docs/guides/database/functions).
