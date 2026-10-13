# Ask ONARLY AI — BerryIT server integration

## Inventering av befintlig ONARLY Gateway

BerryIT bygger ingen egen modellmotor. Serveradaptern återanvänder de verifierade
server-till-server-kontrakten i ONARLYs befintliga gateway:

| Endpoint | Syfte | Verifierat kontrakt |
|---|---|---|
| POST /chat | Gemini-chat | Bearer server-token, message-sträng, svar med model och reply |
| POST /groq/chat | Groq-chat | Bearer server-token, message-sträng, svar med model och answer |
| POST /projects/ask | Fråga mot ONARLYs projektregister | separat serverpolicy krävs innan registerdata skickas |
| POST /knowledge/search | Kunskapssökning | server-token; svarets fullständiga schema är ännu inte verifierat |

Asset Managers POST /api/asset-manager/ai/analyze är ett separat
bildanalyskontrakt och används inte av supportchatten.

Källor för inventeringen är de befintliga ONARLY-filerna
server/ai-workspace-api.mjs, server/ai-workspace-knowledge.mjs,
server/asset-manager-ai-gateway.mjs och docs/asset-manager-ai-gateway-v1.md.
Inga ONARLY-filer ändrades.

## Autentisering och behörigheter

1. Desktop skickar endast sin vanliga BerryIT access-token till /ai/v1.
2. BerryIT-adaptern verifierar token mot BerryIT GoTrue.
3. Alla kund-, projekt-, ticket- och kunskapsläsningar görs med samma
   användartoken mot PostgREST. RLS är därför auktoritet.
4. can_use_ai_for_organization kräver tickets.read eller tickets.write i vald
   organisation. En organisationsbegränsad tekniker kan inte välja eller läsa
   en annan kund.
5. Endast serveradaptern har ONARLY Gateway-token och BerryIT service-role-token.
   Service-role används enbart för assistant-meddelanden och append-only audit
   efter att användarscope har verifierats.
6. Desktop kan endast skriva rollen user; RLS nekar förfalskade
   assistant-meddelanden och audit-rader.

Super Admins befintliga MFA-krav påverkas inte. AI-chatten är supportarbete och
följer samma scope som tickets.

## API

BerryIT-adaptern äger följande endpoint-prefix:

- GET /ai/v1/health
- GET /ai/v1/context
- GET /ai/v1/conversations?organizationId=<uuid>
- POST /ai/v1/conversations
- GET /ai/v1/conversations/:id/messages
- POST /ai/v1/conversations/:id/messages
- POST /ai/v1/conversations/:id/tickets
- POST /ai/v1/conversations/:id/knowledge

AI-frågor kräver approvedForAi: true. Detta är ett uttryckligt godkännande för
att skicka den granskade frågan och den valda, behörighetskontrollerade
kontexten via ONARLY AI Gateway.

## Svar och källor

Servern instruerar ONARLY AI att svara med separata fält för verifierade fakta,
hypoteser och säkerhetsgrad, rekommenderade åtgärder, saknad information och
källor.

Ett faktapåstående accepteras endast om dess sourceIds finns bland de tickets
eller verifierade kunskapsposter som servern själv valde efter RLS-kontroll.
Okända källor tas bort. Ett ostrukturerat gatewaysvar nedgraderas till en
hypotes med låg säkerhet och får inga verifierade fakta.

## Inga automatiska produktionsändringar

Adaptern har inga endpoints för shell, deployment, omstart eller
konfigurationsändringar. Åtgärder markeras som read-only eller
approval-required.

Supportärende skapas bara efter ett separat användarklick och bekräftelse.
Kunskapsposter skapas bara efter att teknikern uttryckligen bekräftat att
lösningen har verifierats i verkligheten. Båda händelserna auditeras.

## Serverkonfiguration

Följande värden hör hemma i serverns skyddade secret store:

    BERRYIT_AI_ADAPTER_IMAGE=
    ONARLY_AI_GATEWAY_URL=
    ONARLY_AI_GATEWAY_TOKEN=
    ONARLY_AI_GATEWAY_ROUTE=/chat

Desktop får aldrig dessa värden. Den behöver endast befintlig BerryIT
backend-URL och publik anon-nyckel.

Adapterimagen byggs utanför produktionsservern från
services/onarly-ai-adapter/Dockerfile, publiceras till ett betrott registry och
anges som BERRYIT_AI_ADAPTER_IMAGE. På servern aktiveras den uttryckligen med
compose-profilen onarly-ai. Detta arbete utför ingen build, deployment eller
secret-konfiguration.

## Verifiering

    node services/onarly-ai-adapter/server.test.mjs
    node supabase/tests/onarly_ai_assistant_test.mjs
    npm run typecheck
    npm --prefix desktop test
    npm --prefix desktop run build

Ett riktigt gatewayanrop kräver en driftsatt adapter samt
ONARLY_AI_GATEWAY_URL och ONARLY_AI_GATEWAY_TOKEN i serverns secret store.
Avsaknad av dessa värden rapporteras som GATEWAY_DISABLED; klienten faller inte
tillbaka till en lokal eller direkt provider.
