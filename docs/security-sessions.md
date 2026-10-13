# Sessioner, token och tvåfaktor

Hur BERRYiT Control Center avgör vem som är inloggad, vad som gäller efter en
utloggning, och var gränsen går för tvåfaktor. Skrivet i PASS 2C och avsett att
hållas uppdaterat när modellen ändras.

## Vad en session består av

Vid inloggning utfärdar GoTrue två saker:

| | Livslängd | Går att återkalla |
|---|---|---|
| **access-token** (JWT) | 3 600 s (`GOTRUE_JWT_EXP`) | Nej – den är signerad och självbärande |
| **refresh-token** | tills den används eller återkallas | Ja, omedelbart |

JWT:n innehåller `sub` (användare), `role` (`authenticated` eller
`service_role`), `session_id` och **`aal`** – `aal1` efter lösenord, `aal2`
efter verifierad engångskod. Vid förnyelse roterar refresh-token, `session_id`
består och `aal` följer med.

## Det här händer vid utloggning

Mätt mot den körande stacken (PASS 2C):

| Kontroll | Resultat |
|---|---|
| `POST /auth/v1/logout?scope=global` | 204 |
| Förnyelse med samma refresh-token | 400 – avvisas |
| `GET /auth/v1/user` med samma access-token | 403 – avvisas |
| **`GET /rest/v1/tickets` med samma access-token** | **200 – fungerar fortfarande** |

**PostgREST känner inte till utloggningen.** Den kontrollerar signatur och
`exp`, inte om sessionen lever. En access-token som redan är utfärdad fortsätter
därför att ge åtkomst till data-API:t i upp till en timme efter utloggningen.
Detta är standardbeteende i Supabase, inte en felkonfiguration – men det måste
vara känt, för det är skillnaden mellan "utloggad" och "utestängd".

För **privilegierade åtgärder** är gapet stängt. GoTrue raderar raden i
`auth.sessions` vid utloggning – mätt på den körande stacken försvinner den
omedelbart – och den tabellen ligger i samma databas. `session_is_live()` slår
upp `session_id` ur JWT:n och nekar allt administrativt så snart raden är borta,
även om token i övrigt är giltig. Ärendearbete påverkas inte: en tekniker vars
token snart går ut ska inte mötas av ett trasigt gränssnitt.

Det som faktiskt stoppas direkt är förnyelsen: utan giltig refresh-token tar
sessionen slut när access-token går ut, och den kan inte förlängas.

## Var tvåfaktorn kontrolleras

Till och med PASS 2B kontrollerades `aal2` endast i klienterna. Ett direkt anrop
mot PostgREST med en giltig `aal1`-token gick förbi hela spärren.

Migrationen `20261013110000_support_mfa_enforcement.sql` flyttar kravet till
databasen:

```
mfa_satisfied() = (aal2 och levande session)  eller  betrodd backend  eller  maskinidentitet
```

Gränsen går mellan ärendearbete och administration:

| Behörighet | Kräver aal2 |
|---|---|
| `tickets.read`, `tickets.write`, `tickets.reassign` | nej |
| `roles.grant`, `audit.read`, `onarly.entitlements.manage` | ja |
| `organizations.manage`, `technicians.manage`, `escalation.configure` | ja |
| Global superadministratör (`is_support_super_admin`) | ja |
| Profilrollen `admin` (`is_admin`) | ja |

Kunder, tekniker och scoped tekniker arbetar alltså precis som förut. Det som
kräver tvåfaktor är administration – och kravet gäller även om anropet går
direkt mot API:t utan gränssnitt.

### Undantag som är avsiktliga

* **service_role** och interna anrop utan JWT (triggers, migrationer, direkt
  SQL) kringgår redan RLS. De omfattas inte av kravet, för det kan de omöjligt
  uppfylla.
* **Maskinidentiteter** – tjänstekonton som loggar in som vanliga användare men
  inte kan mata in en engångskod – markeras med `profiles.is_machine`.
  Undantaget står i registret, inte i koden, och kan bara sättas av en
  administratör med uppfyllt krav eller av service_role.

## Modell för känsliga administrativa åtgärder

Tre lager, där det understa är det som faktiskt håller:

1. **Databasen (implementerat).** RLS och `SECURITY DEFINER`-funktioner kräver
   `mfa_satisfied()` för administrativa behörigheter. Triggarna på
   `support_role_grants` och `onarly_support_entitlements` avvisar dessutom
   ändringar utan uppfyllt krav, oavsett vilken policy som släppte igenom
   anropet. Ett gränssnitt som har fel kan alltså inte ge åtkomst.
2. **Sessionskontroll i klienten (implementerat).** Både webben och
   desktopappen hämtar behörighetskontexten med `auth.getUser()`, som går mot
   GoTrue och därför ser en återkallad session direkt – till skillnad från ett
   anrop mot PostgREST.
3. **Sessionskontroll i databasen (implementerat).** `session_is_live()` kräver
   att sessionen fortfarande finns i `auth.sessions`. Saknas tabellen svarar
   funktionen nej – en kontroll som tyst slutar kontrollera är värre än ingen
   alls. Betrodda backendtjänster har ingen session och undantas före uppslaget.
4. **Färsk bekräftelse för de tyngsta åtgärderna (förslag, ej byggt).** För
   åtgärder som att dela ut en global roll eller aktivera en ONARLY-rättighet
   bör gränssnittet kräva en ny engångskod om `aal2` är äldre än ~15 minuter.
   GoTrue sätter inte något "mfa verifierad vid"-värde i JWT:n, så tidpunkten
   behöver sparas i sessionen när `challengeAndVerify` lyckas.

## Kortare JWT-livslängd

Kortare `GOTRUE_JWT_EXP` är den enda åtgärd som faktiskt krymper fönstret där en
redan utfärdad token fungerar efter utloggning. Kompatibiliteten är kontrollerad
(PASS 2C):

* Klienterna förnyar automatiskt (`autoRefreshToken`), och en session vars
  access-token gått ut återupptas tyst med refresh-token – verifierat genom att
  skriva tillbaka en utgången session och hämta data igen.
* Webbens proxy förnyar sessionen vid varje begäran.
* `aal` bevaras vid förnyelse, så en kortare livslängd tvingar inte fram ny
  tvåfaktor.

**Rekommendation:** sänk `GOTRUE_JWT_EXP` från 3600 till **900** (15 minuter).
Då krymper efterspelet av en utloggning från en timme till en kvart, utan att
någon behöver logga in oftare. Lägre än så är inte meningsfullt: vinsten är
liten och antalet förnyelser mot GoTrue ökar i onödan.

Ändringen rör GoTrues konfiguration och ingår **inte** i PASS 2C – den kräver
eget godkännande och en omstart av auth-tjänsten.

## Vad som fortfarande inte går att lösa i databasen

* En utfärdad access-token kan inte återkallas. Vill man ha omedelbar
  utestängning krävs antingen mycket kort livslängd eller en spärrlista som
  PostgREST konsulterar – det senare är ett eget projekt.
* `aal` sätts av GoTrue. Databasen kan bara lita på claimen; den kan inte själv
  avgöra om en engångskod verkligen matats in.
