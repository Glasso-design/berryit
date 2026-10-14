-- BERRYiT Control Center – PASS 2E: Infrastructure Monitoring V1.
--
-- Bygger vidare på systemregistret från PASS 2D. Inga nya noder, tjänster eller
-- integrationer uppfinns här: mätvärdena hänger på `infra_nodes` och
-- `infra_services`, och upp/ned-status ligger kvar i `service_status_checks`.
-- Det som tillkommer är fyra saker som inte fanns:
--
--   monitoring_samples      numeriska mätvärden (CPU, RAM, disk, svarstid …)
--   monitoring_thresholds   konfigurerbara gränser med skydd mot falsklarm
--   monitoring_agents       den läsande agenten som får rapportera in
--   incident_events         incidenternas livshistoria, append-only
--
-- `incidents` utökas i stället för att dupliceras.
--
-- Två regler styr utformningen:
--
--   1. Ett mätvärde utan källa och tidsstämpel är en gissning. Varje rad i
--      monitoring_samples bär båda, och de går inte att skriva om i efterhand.
--   2. Saknad data är inte ett friskt system. En incident kan därför inte
--      stängas utan att ett skäl anges, och 'saknad data' är inte ett giltigt
--      skäl – se `incidents_resolved_reason`.

-- ------------------------------------------------------------- mätvärdestyper

create table public.monitoring_metric_kinds (
  key text primary key,
  label text not null,
  unit text not null,
  -- Åt vilket håll ett värde är dåligt. Avgör hur trösklarna tolkas.
  direction text not null check (direction in ('above', 'below')),
  -- Värdeintervallet som alls är rimligt. Ett CPU-värde på 400 % är inte en
  -- överbelastning, det är en trasig insamling.
  min_value numeric,
  max_value numeric,
  sort_order smallint not null default 0
);

insert into public.monitoring_metric_kinds (key, label, unit, direction, min_value, max_value, sort_order) values
  ('cpu_percent',             'CPU-belastning',        'procent', 'above', 0, 100,  10),
  ('memory_used_percent',     'RAM-användning',        'procent', 'above', 0, 100,  20),
  ('memory_available_bytes',  'Tillgängligt minne',    'byte',    'below', 0, null, 30),
  ('disk_used_percent',       'Diskutnyttjande',       'procent', 'above', 0, 100,  40),
  ('disk_available_bytes',    'Ledigt diskutrymme',    'byte',    'below', 0, null, 50),
  ('response_time_ms',        'Svarstid',              'ms',      'above', 0, 600000, 60),
  ('containers_running',      'Containrar som kör',    'antal',   'below', 0, null, 70),
  ('containers_unhealthy',    'Ohälsosamma containrar','antal',   'above', 0, null, 80),
  ('uptime_seconds',          'Upptid',                'sekunder','below', 0, null, 90)
on conflict (key) do nothing;

-- --------------------------------------------------------------- mätpunkter

create table public.monitoring_samples (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  node_id uuid,
  service_id uuid,
  metric_key text not null references public.monitoring_metric_kinds (key) on update cascade on delete restrict,
  value numeric not null,
  collected_at timestamptz not null default now(),
  -- Vem mätte. 'agent' för den läsande agenten, annars connector-nyckeln.
  source text not null,
  agent_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (node_id, organization_id)
    references public.infra_nodes (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.infra_services (id, organization_id) on delete cascade,
  -- Ett mätvärde utan mål hör ingenstans hemma.
  constraint monitoring_samples_target check (node_id is not null or service_id is not null),
  constraint monitoring_samples_source_length check (char_length(btrim(source)) between 2 and 40),
  constraint monitoring_samples_detail_object check (jsonb_typeof(detail) = 'object'),
  -- Framtida mätvärden finns inte. En klocka som gått fel ska synas direkt.
  constraint monitoring_samples_not_future check (collected_at <= now() + interval '5 minutes')
);

comment on table public.monitoring_samples is
  'Normaliserade mätvärden. Varje rad bär källa och tidsstämpel och är oföränderlig.';

-- --------------------------------------------------------------- trösklar

create table public.monitoring_thresholds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  metric_key text not null references public.monitoring_metric_kinds (key) on update cascade on delete restrict,
  scope_kind text not null default 'organization'
    check (scope_kind in ('organization', 'node', 'service')),
  node_id uuid,
  service_id uuid,
  warning_value numeric,
  critical_value numeric,

  -- Skydd mot falsklarm: så många mätningar i rad måste bryta gränsen innan en
  -- incident öppnas, och så många friska mätningar krävs innan den stängs.
  consecutive_breaches smallint not null default 3 check (consecutive_breaches between 1 and 20),
  recovery_samples smallint not null default 3 check (recovery_samples between 1 and 20),

  -- Hur länge mätvärden får utebli innan det i sig är en incident.
  stale_after_seconds integer not null default 900 check (stale_after_seconds between 60 and 86400),

  is_enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, organization_id),
  foreign key (node_id, organization_id)
    references public.infra_nodes (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id)
    references public.infra_services (id, organization_id) on delete cascade,
  constraint monitoring_thresholds_scope_target check (
    (scope_kind = 'organization' and node_id is null and service_id is null)
    or (scope_kind = 'node' and node_id is not null and service_id is null)
    or (scope_kind = 'service' and service_id is not null and node_id is null)
  ),
  constraint monitoring_thresholds_has_a_level check (warning_value is not null or critical_value is not null)
);

-- En tröskel per mätvärde och mål. Utan detta kan två motstridiga gränser gälla
-- samtidigt, och då går det inte att säga vad som borde ha larmat.
create unique index monitoring_thresholds_org_idx on public.monitoring_thresholds (organization_id, metric_key)
  where scope_kind = 'organization';
create unique index monitoring_thresholds_node_idx on public.monitoring_thresholds (organization_id, metric_key, node_id)
  where scope_kind = 'node';
create unique index monitoring_thresholds_service_idx on public.monitoring_thresholds (organization_id, metric_key, service_id)
  where scope_kind = 'service';

-- ------------------------------------------------------------- läsande agent

create table public.monitoring_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  node_id uuid not null,
  display_name text not null,

  -- NAMNET på agentens nyckel i serverns secret store. Aldrig värdet.
  secret_ref text,

  -- Agenten läser. Fältet finns för att göra det uttryckligt och kontrollerbart;
  -- en skrivande agent kan inte registreras i den här versionen.
  capabilities jsonb not null default '{"read": true, "write": false}'::jsonb,

  is_enabled boolean not null default false,
  last_seen_at timestamptz,
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, organization_id),
  unique (organization_id, node_id),
  foreign key (node_id, organization_id)
    references public.infra_nodes (id, organization_id) on delete cascade,
  constraint monitoring_agents_name_length check (char_length(btrim(display_name)) between 2 and 120),
  constraint monitoring_agents_read_only check (capabilities ->> 'write' = 'false'),
  constraint monitoring_agents_secret_ref_is_a_name check (
    secret_ref is null or (
      char_length(secret_ref) between 2 and 120
      and secret_ref ~ '^[A-Za-z0-9_.:-]+$'
      and secret_ref !~ '^eyJ'
      and secret_ref !~ '^(sk|gh[pousr]|xox|AIza)[-_]?[A-Za-z0-9]{10,}'
    )
  )
);

comment on table public.monitoring_agents is
  'Den läsande insamlaren på en nod. Håller Docker-socketen själv så att Connector Engine aldrig behöver den.';

-- -------------------------------------------------------------- incidenter

alter table public.incidents
  add column if not exists node_id uuid,
  add column if not exists metric_key text references public.monitoring_metric_kinds (key) on update cascade on delete set null,
  -- Identiteten som avgör om något är samma incident igen eller en ny.
  add column if not exists incident_key text,
  -- Sammanhörande incidenter delar nyckel: allt på samma nod vid samma avbrott.
  add column if not exists group_key text,
  add column if not exists detected_by text not null default 'manual',
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists observation_count integer not null default 1,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid references public.profiles (id) on delete set null,
  add column if not exists resolved_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'incidents_node_fk') then
    alter table public.incidents
      add constraint incidents_node_fk foreign key (node_id, organization_id)
        references public.infra_nodes (id, organization_id) on delete set null;
  end if;

  -- Det här är hela skyddet mot "den slutade larma, alltså är den frisk":
  -- en incident kan inte stängas utan ett skäl, och saknad data är inte ett
  -- giltigt skäl. Övervakningen kan alltså aldrig städa bort sin egen blindhet.
  if not exists (select 1 from pg_constraint where conname = 'incidents_resolved_reason') then
    alter table public.incidents
      -- `resolved_reason is not null` måste stå med: ett CHECK-villkor som
      -- utvärderas till null räknas som uppfyllt, så utan det hade en incident
      -- gått att stänga helt utan skäl – precis det här skyddet ska hindra.
      add constraint incidents_resolved_reason check (
        (status <> 'resolved' and resolved_reason is null)
        or (
          status = 'resolved'
          and resolved_reason is not null
          and resolved_reason in ('recovered', 'manual', 'superseded')
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'incidents_observation_count') then
    alter table public.incidents
      add constraint incidents_observation_count check (observation_count >= 1);
  end if;
end;
$$;

comment on column public.incidents.resolved_reason is
  'Varför incidenten stängdes. Saknad övervakningsdata är inte ett giltigt skäl – den kan aldrig stänga en incident.';

-- Högst en öppen incident per identitet. Dubbletter är det vanligaste sättet
-- att göra en larmlista obrukbar.
create unique index incidents_open_key_idx on public.incidents (organization_id, incident_key)
  where incident_key is not null and status <> 'resolved';

create table public.incident_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid not null,
  event_type text not null
    check (event_type in ('opened', 'observed', 'escalated', 'acknowledged', 'resolved', 'reopened', 'note')),
  actor_kind text not null default 'monitoring' check (actor_kind in ('monitoring', 'user', 'system')),
  actor_id uuid references public.profiles (id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (incident_id, organization_id)
    references public.incidents (id, organization_id) on delete cascade,
  constraint incident_events_detail_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.incident_events is
  'Incidentens livshistoria. Append-only: öppnad, observerad igen, kvitterad, stängd.';

-- -------------------------------------------------------------------- index

create index monitoring_samples_node_idx on public.monitoring_samples (node_id, metric_key, collected_at desc);
create index monitoring_samples_service_idx on public.monitoring_samples (service_id, metric_key, collected_at desc);
create index monitoring_samples_org_idx on public.monitoring_samples (organization_id, collected_at desc);
create index monitoring_thresholds_lookup_idx on public.monitoring_thresholds (organization_id, metric_key, is_enabled);
create index monitoring_agents_node_idx on public.monitoring_agents (node_id);
create index incidents_group_idx on public.incidents (organization_id, group_key, opened_at desc);
create index incident_events_incident_idx on public.incident_events (incident_id, created_at desc);

-- ------------------------------------------------------------------ guards

-- Tröskeln måste vara begriplig: för ett värde som är dåligt när det är högt
-- ska critical ligga över warning, och tvärtom för det som är dåligt när det är
-- lågt. Annars larmar systemet i fel ordning utan att någon märker det.
create or replace function public.guard_threshold_values()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  riktning text;
  lagsta numeric;
  hogsta numeric;
begin
  select m.direction, m.min_value, m.max_value
    into riktning, lagsta, hogsta
    from public.monitoring_metric_kinds m
   where m.key = new.metric_key;

  if riktning is null then
    raise exception 'Okänd mätvärdestyp %', new.metric_key using errcode = 'check_violation';
  end if;

  for i in 1..1 loop
    exit when new.warning_value is null;
    if lagsta is not null and new.warning_value < lagsta then
      raise exception 'warning_value % ligger under det möjliga för %', new.warning_value, new.metric_key
        using errcode = 'check_violation';
    end if;
    if hogsta is not null and new.warning_value > hogsta then
      raise exception 'warning_value % ligger över det möjliga för %', new.warning_value, new.metric_key
        using errcode = 'check_violation';
    end if;
  end loop;

  for i in 1..1 loop
    exit when new.critical_value is null;
    if lagsta is not null and new.critical_value < lagsta then
      raise exception 'critical_value % ligger under det möjliga för %', new.critical_value, new.metric_key
        using errcode = 'check_violation';
    end if;
    if hogsta is not null and new.critical_value > hogsta then
      raise exception 'critical_value % ligger över det möjliga för %', new.critical_value, new.metric_key
        using errcode = 'check_violation';
    end if;
  end loop;

  if new.warning_value is not null and new.critical_value is not null then
    if riktning = 'above' and new.critical_value < new.warning_value then
      raise exception 'critical_value måste vara minst warning_value för %', new.metric_key
        using errcode = 'check_violation';
    end if;
    if riktning = 'below' and new.critical_value > new.warning_value then
      raise exception 'critical_value måste vara högst warning_value för %', new.metric_key
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger monitoring_thresholds_guard before insert or update on public.monitoring_thresholds
  for each row execute function public.guard_threshold_values();

-- Ett mätvärde utanför sitt möjliga intervall är en trasig insamling, inte en
-- extrem mätning. Det avvisas i stället för att få larma.
create or replace function public.guard_sample_range()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lagsta numeric;
  hogsta numeric;
begin
  select m.min_value, m.max_value into lagsta, hogsta
    from public.monitoring_metric_kinds m where m.key = new.metric_key;

  if lagsta is not null and new.value < lagsta then
    raise exception 'Mätvärdet % ligger under det möjliga för %', new.value, new.metric_key
      using errcode = 'check_violation';
  end if;
  if hogsta is not null and new.value > hogsta then
    raise exception 'Mätvärdet % ligger över det möjliga för %', new.value, new.metric_key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger monitoring_samples_range before insert on public.monitoring_samples
  for each row execute function public.guard_sample_range();

-- Mätpunkter och incidenthistorik skrivs en gång.
create trigger monitoring_samples_immutable before update or delete on public.monitoring_samples
  for each row execute function public.deny_write();
create trigger incident_events_immutable before update or delete on public.incident_events
  for each row execute function public.deny_write();

create trigger monitoring_thresholds_tenancy before update on public.monitoring_thresholds
  for each row execute function public.guard_registry_tenancy();
create trigger monitoring_agents_tenancy before update on public.monitoring_agents
  for each row execute function public.guard_registry_tenancy();

create trigger monitoring_thresholds_updated before update on public.monitoring_thresholds
  for each row execute function public.set_updated_at();
create trigger monitoring_agents_updated before update on public.monitoring_agents
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------- RLS

alter table public.monitoring_metric_kinds enable row level security;
alter table public.monitoring_samples enable row level security;
alter table public.monitoring_thresholds enable row level security;
alter table public.monitoring_agents enable row level security;
alter table public.incident_events enable row level security;

grant select on public.monitoring_metric_kinds to authenticated;
grant select on public.monitoring_samples, public.incident_events to authenticated;
grant select, insert, update on public.monitoring_thresholds to authenticated;
grant select, insert, update on public.monitoring_agents to authenticated;
grant all on public.monitoring_metric_kinds, public.monitoring_samples, public.monitoring_thresholds,
  public.monitoring_agents, public.incident_events to service_role;

create policy monitoring_metric_kinds_select on public.monitoring_metric_kinds
  for select to authenticated using (true);

-- Mätvärden och incidenthistorik: samma krets som får se registret.
-- Kunder har ingen policy – alltså ingen väg hit genom PostgREST.
create policy monitoring_samples_select on public.monitoring_samples
  for select to authenticated using (public.can_view_infrastructure(organization_id));

create policy incident_events_select on public.incident_events
  for select to authenticated using (public.can_view_infrastructure(organization_id));

-- Trösklar och agenter styr vad som larmar och vem som får rapportera in.
-- Det är konfiguration av driften och kräver connectors.manage, som i sin tur
-- kräver tvåfaktor.
create policy monitoring_thresholds_select on public.monitoring_thresholds
  for select to authenticated using (public.can_view_infrastructure(organization_id));
create policy monitoring_thresholds_write on public.monitoring_thresholds
  for insert to authenticated with check (public.can_manage_connectors(organization_id));
create policy monitoring_thresholds_update on public.monitoring_thresholds
  for update to authenticated
  using (public.can_manage_connectors(organization_id))
  with check (public.can_manage_connectors(organization_id));

create policy monitoring_agents_select on public.monitoring_agents
  for select to authenticated using (public.can_manage_connectors(organization_id));
create policy monitoring_agents_write on public.monitoring_agents
  for insert to authenticated
  with check (public.can_manage_connectors(organization_id) and capabilities ->> 'write' = 'false');
create policy monitoring_agents_update on public.monitoring_agents
  for update to authenticated
  using (public.can_manage_connectors(organization_id))
  with check (public.can_manage_connectors(organization_id) and capabilities ->> 'write' = 'false');

-- Mätvärden skrivs bara av motorn med service_role. Det finns med flit ingen
-- insert-policy för authenticated: en klient ska inte kunna hitta på driftdata.
