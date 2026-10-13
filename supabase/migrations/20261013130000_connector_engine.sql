-- BERRYiT Control Center – PASS 2D: centralt systemregister och Connector Engine.
--
-- Vad registret är till för
-- -------------------------
-- BERRYiT ska kunna svara på "vad har vi, var ligger det, och fungerar det?"
-- för både egna projekt och externa kunders system – från ett ställe.
--
--   organizations            (finns sedan tidigare) – kund eller BERRYiT självt
--     └── support_projects   (finns sedan PASS 2C/AI) – ett projekt per kund
--           └── infra_services – applikationer och tjänster i projektet
--                 └── ligger på infra_nodes (server/nod) eller ingenstans
--                     (serverlöst, t.ex. Vercel)
--
-- Ett projekt kan ha flera tjänster, och tjänsterna kan ligga på olika servrar.
-- En kund kan ha flera projekt. Interna projekt skiljs från externa kunder på
-- organisationen (`is_internal`), inte på projektet – då kan de aldrig glida isär.
--
-- Mångfald av ägare, en tenant
-- ----------------------------
-- Varje tabell bär `organization_id` och refererar sin förälder med en
-- sammansatt nyckel (id, organization_id). Det gör det omöjligt att hänga en
-- tjänst under ett projekt som tillhör en annan kund – databasen vägrar, utan
-- att någon policy behöver vara inblandad.
--
-- Läsläge först
-- -------------
-- `connector_integrations.access_mode` kan i den här migrationen bara vara
-- 'read_only'. Att släppa in skrivande integrationer är ett eget beslut och
-- kräver en egen migration. Ingen connector startar om något, deployar något
-- eller skriver i någon annans databas.

-- ------------------------------------------------- intern eller extern kund

alter table public.organizations
  add column if not exists is_internal boolean not null default false;

comment on column public.organizations.is_internal is
  'Sant för BERRYiT:s egna verksamhet. Projekt under en intern organisation är våra egna; allt annat är kundsystem.';

-- ------------------------------------------------------------ behörigheter

insert into public.support_permissions (key, description, requires_mfa) values
  ('infrastructure.read', 'Läsa systemregistret: projekt, servrar, tjänster, driftstatus och incidenter', false),
  ('connectors.manage',   'Konfigurera anslutningar till externa system och deras identiteter', true)
on conflict (key) do nothing;

-- Läsning hör till det dagliga arbetet. Att koppla in ett externt system gör
-- det inte: det kräver tvåfaktor, precis som övrig administration.
insert into public.support_role_permissions (role_key, permission_key) values
  ('BERRYIT_SUPPORT_SUPER_ADMIN', 'infrastructure.read'),
  ('BERRYIT_SUPPORT_SUPER_ADMIN', 'connectors.manage'),
  ('BERRYIT_SUPPORT_ADMIN',       'infrastructure.read'),
  ('BERRYIT_SUPPORT_ADMIN',       'connectors.manage'),
  ('BERRYIT_SUPPORT_TECHNICIAN',  'infrastructure.read')
on conflict do nothing;

-- ------------------------------------------------------------- uppslagsdata

create table if not exists public.connector_kinds (
  key text primary key,
  label text not null,
  description text not null,
  -- Vad adaptern får göra i den här passet. Enbart läsning är implementerad.
  supports_read boolean not null default true,
  supports_write boolean not null default false,
  sort_order smallint not null default 0
);

insert into public.connector_kinds (key, label, description, sort_order) values
  ('docker',      'Docker och serverövervakning', 'Containrar, hälsa och resursläge på en nod.', 10),
  ('github',      'GitHub',                       'Repositorier, senaste commit och byggstatus.', 20),
  ('vercel',      'Vercel',                       'Deployments och domänstatus för webbprojekt.', 30),
  ('onarly_ai',   'ONARLY AI Gateway',            'Hälsa och modellstatus via BERRYiT:s egen adapter.', 40),
  ('onarly_desk', 'ONARLY DESK',                  'Fjärrsupportens tillgänglighet och rättighetsläge.', 50),
  ('http_health', 'Webbplats och API-hälsa',      'HTTP-kontroll av en publik eller intern adress.', 60)
on conflict (key) do nothing;

create table if not exists public.service_status_kinds (
  key text primary key,
  label text not null,
  sort_order smallint not null default 0
);

insert into public.service_status_kinds (key, label, sort_order) values
  ('ok',       'Fungerar',      10),
  ('degraded', 'Försämrad',     20),
  ('down',     'Nere',          30),
  ('unknown',  'Okänd',         40)
on conflict (key) do nothing;

-- ------------------------------------------------------------------- noder

create table public.infra_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  hostname text,
  provider text,
  region text,
  node_kind text not null default 'server'
    check (node_kind in ('server', 'container_host', 'workstation', 'managed', 'network')),
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name),
  constraint infra_nodes_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint infra_nodes_hostname_length check (hostname is null or char_length(hostname) <= 253),
  constraint infra_nodes_notes_length check (char_length(notes) <= 4000)
);

comment on table public.infra_nodes is
  'Servrar och noder. Här står var något kör – aldrig hur man loggar in på det.';

-- ----------------------------------------------------------------- tjänster

create table public.infra_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  -- Null för serverlösa tjänster (t.ex. Vercel) – de ligger inte på en nod vi äger.
  node_id uuid,
  name text not null,
  service_kind text not null default 'web'
    check (service_kind in ('web', 'api', 'database', 'container', 'job', 'static', 'desktop')),
  url text,
  environment text not null default 'production'
    check (environment in ('production', 'staging', 'development')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, project_id, name, environment),
  foreign key (project_id, organization_id)
    references public.support_projects (id, organization_id) on delete cascade,
  foreign key (node_id, organization_id)
    references public.infra_nodes (id, organization_id) on delete set null,
  constraint infra_services_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint infra_services_url_format check (
    url is null or (char_length(url) <= 500 and url ~ '^https?://[^[:space:]]+$')
  )
);

comment on table public.infra_services is
  'Applikationer och tjänster. Ett projekt kan ha flera, och de kan ligga på olika noder.';

-- ------------------------------------------------------------- integrationer

create table public.connector_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connector_key text not null references public.connector_kinds (key) on update cascade on delete restrict,
  display_name text not null,

  -- Vad integrationen är kopplad till. Exakt ett mål, eller hela organisationen.
  scope_kind text not null default 'organization'
    check (scope_kind in ('organization', 'project', 'node', 'service')),
  project_id uuid,
  node_id uuid,
  service_id uuid,

  -- Icke-hemlig konfiguration: repo-namn, adress, containerprefix och liknande.
  config jsonb not null default '{}'::jsonb,

  -- NAMNET på hemligheten i serverns secret store. Aldrig värdet. Varje
  -- integration ska ha en egen, begränsad identitet – inte en delad nyckel.
  secret_ref text,

  -- Läsläge är det enda som finns. Att öppna för skrivning kräver en ny
  -- migration, inte en uppdatering av en rad.
  access_mode text not null default 'read_only' check (access_mode = 'read_only'),

  is_enabled boolean not null default false,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'configured', 'connected', 'error', 'disabled')),
  last_checked_at timestamptz,
  last_error text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, organization_id),
  unique (organization_id, connector_key, display_name),
  foreign key (project_id, organization_id)
    references public.support_projects (id, organization_id) on delete cascade,
  foreign key (node_id, organization_id)
    references public.infra_nodes (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.infra_services (id, organization_id) on delete cascade,

  constraint connector_integrations_display_name_length
    check (char_length(btrim(display_name)) between 2 and 120),
  constraint connector_integrations_config_object
    check (jsonb_typeof(config) = 'object'),
  -- Målet måste matcha scope_kind, annars går det inte att veta vad som mäts.
  constraint connector_integrations_scope_target check (
    (scope_kind = 'organization' and project_id is null and node_id is null and service_id is null)
    or (scope_kind = 'project' and project_id is not null and node_id is null and service_id is null)
    or (scope_kind = 'node' and node_id is not null and project_id is null and service_id is null)
    or (scope_kind = 'service' and service_id is not null and project_id is null and node_id is null)
  ),
  -- secret_ref är en pekare, inte en hemlighet. Ser den ut som en token eller
  -- nyckel avvisas den direkt – då har någon klistrat in fel sak.
  constraint connector_integrations_secret_ref_is_a_name check (
    secret_ref is null or (
      char_length(secret_ref) between 2 and 120
      and secret_ref ~ '^[A-Za-z0-9_.:-]+$'
      and secret_ref !~ '^eyJ'
      and secret_ref !~ '^(sk|gh[pousr]|xox|AIza)[-_]?[A-Za-z0-9]{10,}'
    )
  ),
  constraint connector_integrations_last_error_length check (last_error is null or char_length(last_error) <= 2000)
);

comment on column public.connector_integrations.secret_ref is
  'Namnet på hemligheten i serverns secret store – aldrig värdet. Varje integration har en egen begränsad identitet.';
comment on column public.connector_integrations.access_mode is
  'Endast read_only i denna version. Skrivande integrationer kräver en egen migration och ett eget beslut.';

-- --------------------------------------------------------------- driftstatus

create table public.service_status_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid,
  node_id uuid,
  integration_id uuid,
  status_key text not null references public.service_status_kinds (key) on update cascade on delete restrict,
  checked_at timestamptz not null default now(),
  latency_ms integer,
  detail jsonb not null default '{}'::jsonb,
  -- Vilken connector som svarade. Status utan avsändare är en gissning.
  source text not null references public.connector_kinds (key) on update cascade on delete restrict,
  unique (id, organization_id),
  foreign key (service_id, organization_id)
    references public.infra_services (id, organization_id) on delete cascade,
  foreign key (node_id, organization_id)
    references public.infra_nodes (id, organization_id) on delete cascade,
  foreign key (integration_id, organization_id)
    references public.connector_integrations (id, organization_id) on delete set null,
  constraint service_status_checks_target check (service_id is not null or node_id is not null),
  constraint service_status_checks_latency check (latency_ms is null or latency_ms between 0 and 600000),
  constraint service_status_checks_detail_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.service_status_checks is
  'Mätpunkter, inte sanningar: varje rad säger vad en namngiven connector såg vid en viss tidpunkt.';

-- ---------------------------------------------------------------- incidenter

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid,
  service_id uuid,
  ticket_id uuid,
  title text not null,
  summary text not null default '',
  severity text not null default 'minor' check (severity in ('critical', 'major', 'minor', 'info')),
  status text not null default 'open' check (status in ('open', 'monitoring', 'resolved')),
  source text not null default 'manual',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.support_projects (id, organization_id) on delete set null,
  foreign key (service_id, organization_id)
    references public.infra_services (id, organization_id) on delete set null,
  constraint incidents_title_length check (char_length(btrim(title)) between 3 and 200),
  constraint incidents_summary_length check (char_length(summary) <= 10000),
  constraint incidents_resolved_consistency check (
    (status = 'resolved' and resolved_at is not null) or (status <> 'resolved' and resolved_at is null)
  )
);

-- -------------------------------------------------------------- aktivitetslogg

create table public.connector_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Null när handlingen utfördes av motorn själv och inte av en människa.
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind text not null default 'connector' check (actor_kind in ('user', 'connector', 'system')),
  connector_key text references public.connector_kinds (key) on update cascade on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint connector_activity_action_length check (char_length(btrim(action)) between 2 and 120),
  constraint connector_activity_detail_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.connector_activity_log is
  'Append-only. Vem eller vad gjorde vad, och mot vilket system.';

-- -------------------------------------------------------------------- index

create index infra_nodes_org_idx on public.infra_nodes (organization_id, name);
create index infra_services_org_idx on public.infra_services (organization_id, project_id);
create index infra_services_node_idx on public.infra_services (node_id) where node_id is not null;
create index connector_integrations_org_idx on public.connector_integrations (organization_id, connector_key);
create index service_status_checks_service_idx on public.service_status_checks (service_id, checked_at desc);
create index service_status_checks_node_idx on public.service_status_checks (node_id, checked_at desc);
create index incidents_org_idx on public.incidents (organization_id, status, opened_at desc);
create index connector_activity_org_idx on public.connector_activity_log (organization_id, created_at desc);

-- ------------------------------------------------------------ behörighetslogik

-- Läsning av registret: personal, eller någon med infrastructure.read i sitt
-- scope. Kräver inte tvåfaktor – det är dagligt arbete.
create or replace function public.can_view_infrastructure(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id is not null
     and (
       public.is_staff()
       or public.has_support_permission('infrastructure.read', p_organization_id)
     );
$$;

-- Att koppla in ett externt system är administration: behörigheten
-- connectors.manage är märkt requires_mfa, så tvåfaktorkravet följer med.
create or replace function public.can_manage_connectors(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id is not null
     and public.has_support_permission('connectors.manage', p_organization_id);
$$;

grant execute on function public.can_view_infrastructure(uuid) to authenticated;
grant execute on function public.can_manage_connectors(uuid) to authenticated;

-- ------------------------------------------------------------------ trigger

-- En tjänst, nod eller integration får aldrig byta organisation i efterhand.
-- De sammansatta nycklarna hindrar fel förälder; det här hindrar att hela raden
-- flyttas till en annan kund.
create or replace function public.guard_registry_tenancy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'En post kan inte flyttas till en annan organisation'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger infra_nodes_tenancy before update on public.infra_nodes
  for each row execute function public.guard_registry_tenancy();
create trigger infra_services_tenancy before update on public.infra_services
  for each row execute function public.guard_registry_tenancy();
create trigger connector_integrations_tenancy before update on public.connector_integrations
  for each row execute function public.guard_registry_tenancy();
create trigger incidents_tenancy before update on public.incidents
  for each row execute function public.guard_registry_tenancy();

-- Mätpunkter och aktivitetslogg skrivs en gång och står sedan still.
create or replace function public.deny_write()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Raden är oföränderlig'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger service_status_checks_immutable before update or delete on public.service_status_checks
  for each row execute function public.deny_write();
create trigger connector_activity_log_immutable before update or delete on public.connector_activity_log
  for each row execute function public.deny_write();

-- ----------------------------------------------------------- uppdateringstid

create trigger infra_nodes_updated before update on public.infra_nodes
  for each row execute function public.set_updated_at();
create trigger infra_services_updated before update on public.infra_services
  for each row execute function public.set_updated_at();
create trigger connector_integrations_updated before update on public.connector_integrations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------- RLS

alter table public.connector_kinds enable row level security;
alter table public.service_status_kinds enable row level security;
alter table public.infra_nodes enable row level security;
alter table public.infra_services enable row level security;
alter table public.connector_integrations enable row level security;
alter table public.service_status_checks enable row level security;
alter table public.incidents enable row level security;
alter table public.connector_activity_log enable row level security;

grant select on public.connector_kinds, public.service_status_kinds to authenticated;
grant select, insert, update on public.infra_nodes, public.infra_services, public.incidents to authenticated;
grant select, insert, update on public.connector_integrations to authenticated;
grant select on public.service_status_checks, public.connector_activity_log to authenticated;
grant all on public.connector_kinds, public.service_status_kinds, public.infra_nodes,
  public.infra_services, public.connector_integrations, public.service_status_checks,
  public.incidents, public.connector_activity_log to service_role;

-- Uppslagstabellerna är gemensam vokabulär, inte kunddata.
create policy connector_kinds_select on public.connector_kinds
  for select to authenticated using (true);
create policy service_status_kinds_select on public.service_status_kinds
  for select to authenticated using (true);

-- Registret är personalens vy av driften. Kunder har ingen policy här alls:
-- det finns därför ingen väg till raderna genom PostgREST, oavsett vilket id
-- som gissas. En kundvänlig statussida är ett eget beslut, inte en bieffekt.
create policy infra_nodes_select on public.infra_nodes
  for select to authenticated using (public.can_view_infrastructure(organization_id));
create policy infra_nodes_write on public.infra_nodes
  for insert to authenticated with check (public.can_manage_connectors(organization_id));
create policy infra_nodes_update on public.infra_nodes
  for update to authenticated
  using (public.can_manage_connectors(organization_id))
  with check (public.can_manage_connectors(organization_id));

create policy infra_services_select on public.infra_services
  for select to authenticated using (public.can_view_infrastructure(organization_id));
create policy infra_services_write on public.infra_services
  for insert to authenticated with check (public.can_manage_connectors(organization_id));
create policy infra_services_update on public.infra_services
  for update to authenticated
  using (public.can_manage_connectors(organization_id))
  with check (public.can_manage_connectors(organization_id));

-- Integrationer visar vilka system vi är inne i och under vilken identitet.
-- Att läsa dem kräver samma behörighet som att ändra dem.
create policy connector_integrations_select on public.connector_integrations
  for select to authenticated using (public.can_manage_connectors(organization_id));
create policy connector_integrations_write on public.connector_integrations
  for insert to authenticated
  with check (public.can_manage_connectors(organization_id) and access_mode = 'read_only');
create policy connector_integrations_update on public.connector_integrations
  for update to authenticated
  using (public.can_manage_connectors(organization_id))
  with check (public.can_manage_connectors(organization_id) and access_mode = 'read_only');

create policy service_status_checks_select on public.service_status_checks
  for select to authenticated using (public.can_view_infrastructure(organization_id));

create policy incidents_select on public.incidents
  for select to authenticated using (public.can_view_infrastructure(organization_id));
create policy incidents_write on public.incidents
  for insert to authenticated
  with check (public.can_view_infrastructure(organization_id) and created_by = auth.uid());
create policy incidents_update on public.incidents
  for update to authenticated
  using (public.can_view_infrastructure(organization_id))
  with check (public.can_view_infrastructure(organization_id));

create policy connector_activity_select on public.connector_activity_log
  for select to authenticated using (public.can_manage_connectors(organization_id));
