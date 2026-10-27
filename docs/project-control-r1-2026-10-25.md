# PCC R1 — HTTP-konflikt och ONARLY AI-kontext

Status: **lokalt förberedd; inte applicerad på någon server eller isolerad
HTTP-stack**. Detta dokument ersätter inte resultatet i
`project-control-isolated-result-2026-10-25.md`.

## Rotorsak

`public.save_project_task` i den redan applicerade PCC-migrationen använde
medvetet SQLSTATE `40001` när en klient skickade en gammal `revision`. Det är
en optimistic-concurrency-konflikt, inte en PostgreSQL-serialiseringskonflikt.
PostgREST 14 behandlar `40*` som återförsökningsbart och den isolerade
HTTP-körningen fick därför ingen terminal respons innan testets timeout.

Den nya, **ej applicerade**, framåtriktade migrationen
`20261025160000_pcc_http_conflict_and_ai_context.sql` ersätter bara den
applikationskonflikten med `PT409`. PostgRESTs dokumentation anger att
`PT409` svarar med HTTP 409. Den lämnar alla kontrollordningar intakta:
aktiv session, project scope, `tasks.read`, `tasks.write`, RLS-synlighet,
`FOR UPDATE`, assignee-validering, audit, revision och append-only-historik.

Historiska 17 migrationsfiler är orörda. `save_support_project` och
`save_support_role` har fortfarande sina egna äldre `40001`-konflikter och
ligger uttryckligen utanför R1A:s PCC-taskkorrigering.

Migrationens SHA-256 är
`44da8030e96cba3f6a68bf126da9ac05a75081a35600a6652ad7c93f4775a19f`.
Den lokala Supabase CLI:n är inte installerad; ingen CLI-installation gjordes
i detta pass. Filen är därför namngiven enligt den befintliga framåtriktade
migrationsordningen och verifierad genom hela PGlite-kedjan.

## AI-adapterparitet

Den lokala `services/onarly-ai-adapter/server.mjs` använder redan
`project_control_ai_context` med samma anropar-JWT, inte service-role, både
före Gateway-anrop och före persistens. Den returnerar 403 vid nekad scope,
markerar en saknad RPC som en informationslucka och gör inte detta till mockad
data.

R1:s framåtriktade definition av `project_control_ai_context` adderar stabil
projekt-/organisationsscope och, endast när den aktuella serverkontrollen
tillåter det, säkra fakta från `project_repository_catalog` och
`project_infrastructure_context`. Den skickar aldrig `secret_ref`, URL:er,
statusdetaljer, affärs-/avtalsdata eller lokala sökvägar. Den befintliga
adapterkoden behöver därför ingen ny parallell datakälla.

Den isolerade adapterns äldre `server.mjs` saknar fortfarande denna koppling.
Att byta containerfil/image, ladda om adapter eller anropa riktig Gateway är
ett separat godkännande och har inte utförts.

## Verifieringsgräns

`supabase/tests/project-control-r1.test.mjs` kör en färsk PGlite-databas med
hela migrationskedjan och verifierar `PT409`, två samma-revisionsförsök,
oförändrad rad efter nekad skrivning, behörighet före konflikttestet samt
AI-kontextens tenant-/secretgräns. PGlite är inte PostgREST och bevisar inte
ett verkligt HTTP 409-svar.

Före R1 är den verkliga isolerade HTTP-reproduktionen dokumenterad som
`40001`-retry/timeout med oförändrad revision. Efter R1 är verklig HTTP/MFA/RLS
mot en **ny, disponibel och uttryckligen godkänd** Supabase-stack fortfarande
BLOCKED. Den befintliga `berryit-iso-83a2f62f`-stacken får inte ändras enligt
detta pass.

## Nästa godkännande som behövs

1. Granska migrationens hash och kör den endast mot en ny disponibel,
   syntetisk Supabase-stack.
2. Kör samma stale `save_project_task`-RPC över PostgREST och bekräfta snabb
   HTTP 409 med `PT409`, utan ny audit-/taskrad.
3. Kör MFA, foreign-tenant, revoke-under-session och adapterkontrakt mot den
   stacken.
4. Separat granska/deploya adapterpariteten till en isolerad adapter först
   efter att dess container-image och konfiguration har verifierats.
