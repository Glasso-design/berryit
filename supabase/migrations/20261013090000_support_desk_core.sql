-- BERRYiT Support Desk – PASS 1: kärnschema.
--
-- Omfattar organisationer, profiler (kopplade till auth.users), uppslagstabeller
-- för kategori/prioritet/status, ärenden, kundkonversation, interna anteckningar,
-- bilagor och händelsehistorik.
--
-- Principer:
--  * Uppslagstabeller i stället för hårdkodade enums där värdena ska kunna
--    administreras (kategori/prioritet/status). Roller och källor är enums.
--  * Kundsynlig konversation och interna anteckningar ligger i SEPARATA tabeller
--    så att en intern anteckning aldrig kan läcka via en felskriven policy.
--  * All historik skrivs av databasen (triggers), inte av klienten.
--  * RLS aktiveras här men policies ligger i nästa migration.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums

create type public.app_role as enum ('customer', 'technician', 'admin');

-- Varifrån ärendet kom. "web_form" = publika formuläret på berryit.se,
-- "discord"/"api" förbereder framtida integrationer (ingen integration byggs här).
create type public.ticket_source as enum ('portal', 'web_form', 'email', 'discord', 'api');

create type public.attachment_visibility as enum ('customer', 'internal');

create type public.ticket_event_type as enum (
  'created',
  'status_changed',
  'priority_changed',
  'category_changed',
  'assigned',
  'customer_message',
  'internal_note',
  'attachment_added'
);

-- ------------------------------------------------------- uppslagstabeller

create table public.ticket_statuses (
  key text primary key,
  label text not null,
  sort_order smallint not null,
  -- is_open = ärendet räknas som pågående i kundens/teknikerns vyer.
  is_open boolean not null default true,
  -- awaiting_customer = väntar på kundsvar (används för påminnelser senare).
  awaiting_customer boolean not null default false,
  is_active boolean not null default true,
  constraint ticket_statuses_key_format check (key ~ '^[a-z_]{2,32}$'),
  constraint ticket_statuses_label_not_blank check (btrim(label) <> '')
);

create table public.ticket_priorities (
  key text primary key,
  label text not null,
  sort_order smallint not null,
  is_active boolean not null default true,
  constraint ticket_priorities_key_format check (key ~ '^[a-z_]{2,32}$'),
  constraint ticket_priorities_label_not_blank check (btrim(label) <> '')
);

create table public.ticket_categories (
  key text primary key,
  label text not null,
  sort_order smallint not null,
  is_active boolean not null default true,
  constraint ticket_categories_key_format check (key ~ '^[a-z0-9_]{2,32}$'),
  constraint ticket_categories_label_not_blank check (btrim(label) <> '')
);

-- BERRYiT:s etablerade statusflöde och prioriteringsmodell.
insert into public.ticket_statuses (key, label, sort_order, is_open, awaiting_customer) values
  ('mottaget',          'Mottaget',        10, true,  false),
  ('pagar',             'Pågår',           20, true,  false),
  ('vantar_pa_kund',    'Väntar på kund',  30, true,  true),
  ('lost',              'Löst',            40, false, false),
  ('stangt',            'Stängt',          50, false, false);

insert into public.ticket_priorities (key, label, sort_order) values
  ('lag',    'Låg',    10),
  ('normal', 'Normal', 20),
  ('hog',    'Hög',    30),
  ('akut',   'Akut',   40);

insert into public.ticket_categories (key, label, sort_order) values
  ('dator',         'Dator',             10),
  ('natverk',       'Nätverk',           20),
  ('epost',         'E-post',            30),
  ('microsoft_365', 'Microsoft 365',     40),
  ('skrivare',      'Skrivare',          50),
  ('programvara',   'Programvara',       60),
  ('konto',         'Konto / inloggning',70),
  ('sakerhet',      'Säkerhet',          80),
  ('webb',          'Webb',              90),
  ('ovrigt',        'Övrigt',           100);

-- ------------------------------------------------------------ kärntabeller

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (btrim(name) <> '')
);

-- En profil per inloggad användare. role styr all behörighet.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'customer',
  full_name text,
  email text,
  phone text,
  organization_id uuid references public.organizations (id) on delete set null,
  -- Organisationens kontaktperson får se hela organisationens ärenden.
  is_org_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_format check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Personal tillhör BERRYiT, inte en kundorganisation.
  constraint profiles_staff_has_no_org check (role = 'customer' or organization_id is null),
  constraint profiles_org_admin_requires_org check (not is_org_admin or organization_id is not null)
);

-- Löpnummer för läsbara ärende-ID: BIT-2026-0001.
create sequence public.ticket_reference_seq;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  organization_id uuid references public.organizations (id) on delete restrict,
  requester_id uuid not null references public.profiles (id) on delete restrict,
  assignee_id uuid references public.profiles (id) on delete set null,
  subject text not null,
  description text not null,
  category_key text not null references public.ticket_categories (key) on update cascade on delete restrict,
  priority_key text not null default 'normal' references public.ticket_priorities (key) on update cascade on delete restrict,
  status_key text not null default 'mottaget' references public.ticket_statuses (key) on update cascade on delete restrict,
  source public.ticket_source not null default 'portal',
  -- Kontaktuppgifter som de angavs vid skapandet (kan skilja sig från profilen).
  contact_name text,
  contact_email text,
  contact_phone text,
  contact_city text,
  preferred_contact text,
  preferred_time text,
  -- Spår för inkommande integrationer. Ingen integration implementeras i denna pass.
  external_id text,
  external_channel text,
  external_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  constraint tickets_subject_length check (char_length(btrim(subject)) between 3 and 200),
  constraint tickets_description_length check (char_length(btrim(description)) between 10 and 10000),
  constraint tickets_contact_email_format check (contact_email is null or contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint tickets_external_source_pair check (external_id is null or external_channel is not null)
);

-- Kundsynlig konversation. Allt här kan läsas av kunden som äger ärendet.
create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  -- true = skrivet av BERRYiT, false = skrivet av kunden.
  is_from_staff boolean not null,
  created_at timestamptz not null default now(),
  constraint ticket_messages_body_not_blank check (char_length(btrim(body)) between 1 and 20000)
);

-- Interna anteckningar. Egen tabell: ingen policy ger customer-rollen läsrätt.
create table public.ticket_internal_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint ticket_internal_notes_body_not_blank check (char_length(btrim(body)) between 1 and 20000)
);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  message_id uuid references public.ticket_messages (id) on delete set null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  -- Sökväg i privat storage-bucket: tickets/<ticket_id>/<uuid>-<filnamn>
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  visibility public.attachment_visibility not null default 'customer',
  created_at timestamptz not null default now(),
  constraint ticket_attachments_size check (size_bytes > 0 and size_bytes <= 26214400),
  constraint ticket_attachments_file_name_not_blank check (btrim(file_name) <> ''),
  constraint ticket_attachments_path_prefix check (storage_path like 'tickets/%')
);

-- Oföränderlig historik. Skrivs av triggers nedan.
create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  event_type public.ticket_event_type not null,
  from_value text,
  to_value text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- index

-- Samma externa ärende (t.ex. en Discord-tråd) får bara importeras en gång.
create unique index tickets_external_ref_idx on public.tickets (source, external_id)
  where external_id is not null;

create index tickets_status_idx on public.tickets (status_key);
create index tickets_priority_idx on public.tickets (priority_key);
create index tickets_category_idx on public.tickets (category_key);
create index tickets_assignee_idx on public.tickets (assignee_id);
create index tickets_requester_idx on public.tickets (requester_id);
create index tickets_organization_idx on public.tickets (organization_id);
create index tickets_updated_at_idx on public.tickets (updated_at desc);
create index tickets_open_queue_idx on public.tickets (status_key, priority_key, updated_at desc);
-- Fritextsökning på ämne, beskrivning och ärende-ID (svensk ordstamning).
create index tickets_search_idx on public.tickets
  using gin (to_tsvector('swedish', reference || ' ' || subject || ' ' || description));
create index ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);
create index ticket_internal_notes_ticket_idx on public.ticket_internal_notes (ticket_id, created_at);
create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id, created_at);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at desc);
create index profiles_organization_idx on public.profiles (organization_id);
create index profiles_role_idx on public.profiles (role);

-- -------------------------------------------------------------- triggers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger tickets_set_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- Läsbart ärende-ID per år: BIT-2026-0001.
create or replace function public.assign_ticket_reference()
returns trigger
language plpgsql
set search_path = ''
security definer
as $$
begin
  if new.reference is null or btrim(new.reference) = '' then
    new.reference := 'BIT-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.ticket_reference_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create trigger tickets_assign_reference before insert on public.tickets
  for each row execute function public.assign_ticket_reference();

-- Historik: skapande och ändringar av status/prioritet/kategori/tilldelning.
create or replace function public.log_ticket_changes()
returns trigger
language plpgsql
set search_path = ''
security definer
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor_id, event_type, to_value)
    values (new.id, actor, 'created', new.status_key);
    return new;
  end if;

  if new.status_key is distinct from old.status_key then
    insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, actor, 'status_changed', old.status_key, new.status_key);

    -- Tidsstämplar för lösta/stängda ärenden hålls i databasen.
    if new.status_key = 'lost' and new.resolved_at is null then
      new.resolved_at := now();
    end if;
    if new.status_key = 'stangt' and new.closed_at is null then
      new.closed_at := now();
    end if;
    if new.status_key not in ('lost', 'stangt') then
      new.resolved_at := null;
      new.closed_at := null;
    end if;
  end if;

  if new.priority_key is distinct from old.priority_key then
    insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, actor, 'priority_changed', old.priority_key, new.priority_key);
  end if;

  if new.category_key is distinct from old.category_key then
    insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, actor, 'category_changed', old.category_key, new.category_key);
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.id, actor, 'assigned', old.assignee_id::text, new.assignee_id::text);
  end if;

  return new;
end;
$$;

create trigger tickets_log_insert after insert on public.tickets
  for each row execute function public.log_ticket_changes();
create trigger tickets_log_update before update on public.tickets
  for each row execute function public.log_ticket_changes();

-- Nytt meddelande: historikpost, uppdaterad tidsstämpel och första svarstid.
create or replace function public.on_ticket_message()
returns trigger
language plpgsql
set search_path = ''
security definer
as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (new.ticket_id, new.author_id, 'customer_message',
          jsonb_build_object('message_id', new.id, 'from_staff', new.is_from_staff));

  update public.tickets
     set updated_at = now(),
         first_response_at = case
           when new.is_from_staff and first_response_at is null then now()
           else first_response_at
         end
   where id = new.ticket_id;

  return new;
end;
$$;

create trigger ticket_messages_after_insert after insert on public.ticket_messages
  for each row execute function public.on_ticket_message();

create or replace function public.on_ticket_internal_note()
returns trigger
language plpgsql
set search_path = ''
security definer
as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (new.ticket_id, new.author_id, 'internal_note', jsonb_build_object('note_id', new.id));
  return new;
end;
$$;

create trigger ticket_internal_notes_after_insert after insert on public.ticket_internal_notes
  for each row execute function public.on_ticket_internal_note();

create or replace function public.on_ticket_attachment()
returns trigger
language plpgsql
set search_path = ''
security definer
as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, event_type, payload)
  values (new.ticket_id, new.uploaded_by, 'attachment_added',
          jsonb_build_object('attachment_id', new.id, 'visibility', new.visibility));
  return new;
end;
$$;

create trigger ticket_attachments_after_insert after insert on public.ticket_attachments
  for each row execute function public.on_ticket_attachment();

-- --------------------------------------------------------------- RLS på

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_internal_notes enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_events enable row level security;
alter table public.ticket_statuses enable row level security;
alter table public.ticket_priorities enable row level security;
alter table public.ticket_categories enable row level security;
