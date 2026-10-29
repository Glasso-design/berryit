# Halvregistrerade kundkonton – kontroll och manuell reparation (MASTER PASS 2, M4)

Status: rutin för driften. Ingenting här körs automatiskt, och ingenting har körts mot
någon delad eller hostad databas.

## Bakgrund

Fram till `supabase/migrations/20261029090000_registration_gotrue_metadata.sql` blev
manuell kundregistrering via `/api/control/customers` halv. GoTrues admin-API skapar
först användaren (`INSERT auth.users` utan BERRYiT-markören) och skriver
`app_metadata` med en senare `UPDATE`. Triggern `handle_new_auth_user()` såg därför
aldrig markören `berryit_manual_customer`. Följden:

- kontot finns i `auth.users`, med markören i `raw_app_meta_data`;
- profilen blev en vanlig kund: `organization_id` NULL, `login_activation_pending`
  false, `registered_by` NULL;
- ingen rad `customer_registered` i `support_admin_audit`;
- på den versionen kontrollerades registraren inte heller i databasen. Konton kan
  alltså även ha skapats med en registrar som saknade levande aal2-session (routen
  kontrollerade fortfarande i förväg).

Sådana konton kan bara finnas där `20261014235633_complete_support_workflow.sql`
applicerats och registreringen använts före fixen. Enligt
`docs/masterpass1-migrations.json` är `20261014235633` inte applicerad i produktion.
Staging-, test- och demostackar kan ändå ha sådana konton.

Migrationen `20261029090000` reparerar **inte** gamla konton. Det är avsiktligt: rätt
organisation och om kontot alls ska finnas är ett beslut, inte något som kan härledas
säkert.

## 1. Kontroll (skrivskyddad)

```bash
cd deploy/berryit-support
./registration-check.sh
```

- Kör `checks/half-registered-customers.sql` i en `READ ONLY`-transaktion, med
  `default_transaction_read_only=on` och `statement_timeout` 30 s.
- Exit 0: inga träffar. Exit 3: träffar, en rad per konto. Annat: kontrollen kunde
  inte köras.
- Kolumner: `user_id`, `email`, tidpunkt, registrar och organisation enligt markören,
  profilens organisation, aktiveringsspärr, registrar, antal registreringsrader i
  auditloggen, och `findings` (varför kontot listas).
- Hostad Supabase eller annan stack utan `docker exec`: kör SQL-filen i en SQL-konsol.
  Den börjar med `start transaction read only` och slutar med `rollback`.

## 2. Bedömning per träff (manuellt)

För varje rad, innan något ändras:

1. Ta reda på vem som registrerade kontot (`marker_registrar_id`) och om
   registreringen var avsedd.
2. Bestäm organisationen. Markörens organisation är vad registraren valde; tom
   betyder privatkund.
3. Kontrollera att kontot inte är en dubblett av ett annat kundkonto.
4. Dokumentera beslutet med en referens, t.ex. ett ärendenummer.

Möjliga beslut:

- **Slutför registreringen** (avsnitt 3).
- **Ta bort kontot**, om det var ett misstag eller en dubblett. Använd GoTrues admin-API
  eller Supabase Studio, inte SQL. `auth.users` ägs av GoTrue.
- **Låt det vara**, om kunden redan hanteras på annat sätt. Kontrollen fortsätter då
  att lista kontot.

## 3. Slutför en registrering (ett konto i taget)

Mallen `deploy/berryit-support/checks/repair-half-registration.template.sql` gör allt
eller inget, i en transaktion, med `lock_timeout` 5 s. Den vägrar om:

- `-v confirm=JA` saknas;
- kontot saknar markör, eller registraren inte stämmer med markören;
- organisationen inte finns, eller operatören inte är en administratörsprofil;
- profilen inte längre är halvregistrerad (en andra körning ändrar ingenting);
- `reason` är kortare än 10 tecken.

```bash
docker exec -i berryit-support-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
  --single-transaction \
  -v user_id=<user_id> \
  -v organization_id=<beslutad organisation, tom för privatkund> \
  -v registrar_id=<marker_registrar_id> \
  -v operator_id=<profil-id för beslutande administratör> \
  -v reason='<beslutsreferens>' \
  -v confirm=JA \
  < deploy/berryit-support/checks/repair-half-registration.template.sql
```

Effekt:

- profilen får organisation, `login_activation_pending = true` och `registered_by`;
- en attribuerad audit-rad `customer_registration_repaired` med operatören som aktör.
  Raden innehåller beslutsreferensen och den ursprungliga markören;
- triggern `support_profiles_audit` skriver dessutom `profiles_update` utan aktör
  ("Manuell registerändring"). Det stämmer, eftersom ändringen görs med direkt SQL.
  Auditloggen är append-only, så båda raderna finns kvar.

Kör sedan `./registration-check.sh` igen. Det reparerade kontot ska inte längre
listas; kontrollen godtar `customer_registration_repaired` som audit-rad.

## Verifiering av rutinen

- Lokalt, PostgreSQL 16 med repots auth-stubbe (SIM-auth):
  - databas i läget före fixen med registreringar i GoTrues satsordning;
  - kontrollen hittar dem, före och efter att fixen applicerats;
  - nya registreringar efter fixen listas inte;
  - en skrivning i kontrollens sessionsform nekas (read-only);
  - mallens spärrar (utan confirm, fel registrar, andra körningen) och en lyckad
    reparation.
- REAL i CI (`tests/masterpass1/ops.e2e.mjs`, M4), mot supabase/postgres och riktig GoTrue:
  - ren stack ger exit 0;
  - ett konto i läget före fixen ger exit 3 och listas, utan att något ändras;
  - utan confirm ändras ingenting;
  - reparationen fungerar, en andra reparation nekas, och kontrollen ger sedan exit 0.
