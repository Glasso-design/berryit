# Systemregister och Connector Engine

BERRYiT ska kunna svara på *vad har vi, var ligger det, och fungerar det?* för
både egna projekt och kunders system – från ett ställe. Det här dokumentet
beskriver registret, motorn som fyller det, och var gränserna går.

## Datamodell

```
organizations (is_internal)        kund eller BERRYiT självt
  └── support_projects             ett projekt per kund, flera per kund
        └── infra_services         applikationer och tjänster
              └── infra_nodes      servern tjänsten kör på (null = serverlöst)

connector_integrations             anslutningen till ett externt system
service_status_checks              mätpunkter: vad en connector såg, när
incidents                          avbrott, kopplade till tjänst eller projekt
connector_activity_log             append-only: vem eller vad gjorde vad
```

Ett projekt kan ha flera tjänster, och tjänsterna kan ligga på olika servrar.
En kund kan ha flera projekt.

**Internt eller externt** avgörs på organisationen (`organizations.is_internal`),
inte på projektet. Hade flaggan suttit på projektet kunde de två glida isär, och
då vet man till slut inte vems system man tittar på.

**Tenancy i nycklarna, inte bara i policyerna.** Varje tabell bär
`organization_id` och refererar sin förälder med `(id, organization_id)`. Att
hänga en tjänst under en annan kunds projekt går alltså inte – databasen vägrar,
utan att någon policy behöver vara inblandad. En trigger hindrar dessutom att en
befintlig rad flyttas till en annan organisation.

## Vem ser vad

| | Kund | Tekniker | connectors.manage |
|---|---|---|---|
| Projekt, tjänster, servrar | – | läser | läser och ändrar |
| Driftstatus och incidenter | – | läser | läser |
| Integrationer och aktivitetslogg | – | – | läser och ändrar |

Kunder har **ingen policy alls** på registertabellerna. Det finns därför ingen
väg dit genom PostgREST, oavsett vilket id som gissas. En kundvänlig statussida
är ett eget beslut, inte en bieffekt av att data råkar finnas.

`infrastructure.read` kräver inte tvåfaktor – att läsa registret är dagligt
arbete. `connectors.manage` gör det, eftersom den visar vilka system vi är inne
i och under vilken identitet. Den behörigheten är märkt `requires_mfa`, så
kravet följer automatiskt av MFA-modellen från PASS 2C.

## Connector Engine

Motorn kör på servern och är den enda som ser tokens, socketar och nycklar.

```
registret  →  adapter läser systemet  →  mätpunkt + aktivitetsrad tillbaka
```

| Connector | Läser | Identitet |
|---|---|---|
| `docker` | containrar och hälsa från injicerad serverläsare/snapshot | separat serverlokal collector/API-begränsad läsare; ingen socket i Desktop |
| `github` | senaste commit per repo | egen fine-grained token med enbart läsrätt |
| `vercel` | senaste deployment | egen token med read-scope på projektet |
| `onarly_ai` | hälsa via BERRYiT:s egen AI-adapter | ingen – adaptern håller gateway-token själv |
| `onarly_desk` | inget serverbaserat sessions-API; okänd faktisk status | ingen token eller HTTP-kontroll |
| `http_health` | HTTP-status och svarstid | ingen, anonymt GET |

### Läsläge, på tre ställen

1. **Databasen**: `connector_integrations.access_mode` kan bara vara
   `read_only`. Att öppna för skrivning kräver en ny migration, inte en
   uppdatering av en rad.
2. **Motorn**: vägrar köra en integration vars `access_mode` är något annat, och
   vägrar registrera en adapter som deklarerar skrivläge eller som har en metod
   med ett namn som `restart`, `deploy` eller `exec`.
3. **Adaptrarna**: tar emot `fetch` och hemligheter som argument i stället för
   att läsa globala värden. En adapter kan alltså inte plocka upp en nyckel den
   inte fått.

### Hemligheter

Registret innehåller `secret_ref` – **namnet** på hemligheten i serverns store,
aldrig värdet. En databaskonstraint avvisar värden som ser ut som tokens
(`eyJ…`, `ghp_…`, `sk-…`), så att en felklistrad nyckel stoppas direkt.

Resultat städas innan de sparas: fält som heter `token`, `secret`, `api_key` och
liknande maskeras, och strängar som ser ut som nycklar maskeras oavsett vad
fältet heter. Detaljerna visas i Desktop, och det som visas ska gå att visa.

### Ärliga svar

`unknown` är ett giltigt svar. En connector som inte är konfigurerad, inte når
fram eller får ett otolkbart svar rapporterar det – den gissar aldrig `ok`.
Varje mätpunkt bär vilken connector som svarade och när; Desktop säger till när
en mätning är äldre än 15 minuter i stället för att visa gårdagens "fungerar"
som om den vore färsk.

Motorn skiljer också på två frågor som är lätta att blanda ihop: *fungerar
anslutningen* och *mår tjänsten bra*. En connector kan vara ansluten och ändå
rapportera att tjänsten är nere.

## Desktop

Projekt, Infrastruktur och Integrationer läser registret med användarens egen
JWT genom PostgREST. Klienten har **ingen** service-role-nyckel, ingen
SSH-nyckel och ingen Docker-socket, och den kan inte köra en connector. Den
visar vad motorn har mätt.

Integrationsvyn skiljer på tre lägen: *du saknar behörighet att se dem*,
*connectorn finns men är inte ansluten*, och *ansluten, senast kontrollerad
då-och-då*. Den första är viktig – en tom lista hade sett ut som "det finns
inga".

## Innan det kan köras

1. Applicera migrationen på servern (kräver eget godkännande och verifierad
   offsite-backup, se `docs/security-sessions.md`).
2. Lägg in organisationer, projekt, servrar och tjänster i registret.
3. Skapa en egen begränsad identitet per externt system och lägg den i serverns
   secret store. Registrera **namnet** i `secret_ref`.
4. Driftsätt motorn som ett schemalagt jobb på servern.

Varje steg är ett eget beslut. Inget av dem ingår i PASS 2D.

## PASS 1, 2026-10-16 — lokalt verifierad pilotgrund

`services/connector-engine/pilot.mjs` förbereder ett utkast i samma befintliga
tabeller: en nod (core-node-01), två projekt (FLIQS/AuroraPark), åtta tjänster
och nio avstängda, läsande integrationer. Befintlig intern organisations-ID och
behörig profils ID måste anges. Generatorn skapar inga organisationer, har ingen
databasklient och kör inga kommandon. Före import måste befintliga projekt och
tjänster matchas så att inga parallella registerrader skapas.

Dockeradaptern stöder exakta `container_names` och
`expected_stopped_containers`. Endast observerat `exited` för ett uttryckligen
angivet namn räknas som planerat stopp. Wildcards, dubletter och namn utanför
kontrollens scope avvisas. Saknade mål och oväntade starter syns fortfarande.
Enbart planerade stopp ger `unknown`, aldrig en påhittad frisk, körande tjänst.
`unhealthy` på en stoppad container är historisk metadata och räknas inte som
ett aktuellt hälsolarm. En verkligt ohälsosam körande container larmar fortfarande.

Agentmottagningen sparar härledda containersiffror en gång. Avsaknad av
inventering ger inte längre påhittade nollvärden; fel form eller fler än 200
poster avvisas, i stället för att en tyst trunkering skulle kunna dölja fel.

**Säkerhetsgräns:** `:ro` på Docker-socketens mount blockerar inte skrivande
Docker API-anrop. Den befintliga injektionspunkten är ingen färdig collector
eller transportautentisering. En verklig API-begränsad läsare, autentiserad
agentmottagning, egressregler och schemaläggning återstår före driftsättning.

Se [PASS 1-rapport och produktionsgrind](master-integration-pass1-2026-10-16.md).

## Lokalt tillägg: projekt och åtkomst

Den lokala projekt-/rollutökningen beskrivs i
[projekt- och åtkomstrapporten](project-access-master-2026-10-16.md).
Discovery kräver explicit opt-in och pinnat provider-ID; samma projektregister
återanvänds. Repositorygranskning kräver aktuell projektpermission i databasen
och en separat serverallowlist i `BERRYIT_GITHUB_READ_CONNECTIONS`.
Tokens hör endast hemma på servern. Ingen anslutning aktiverades här.
Den nya framåtriktade migrationen och isolerad HTTP/MFA-grind måste godkännas
innan klienten eller connectorutökningen tas i drift.
