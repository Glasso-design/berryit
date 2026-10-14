-- BERRYiT Control Center – PASS 2F: Communications V1.
--
-- Samlar chatt, e-post och supportärenden i ett arbetsflöde. Bygger på det som
-- redan finns: organisationer, profiler, tickets, storage-bucketen
-- "ticket-attachments", RLS-hjälparna och MFA-modellen.
--
-- Varför en egen konversationsmodell vid sidan av ticket_messages
-- ---------------------------------------------------------------
-- `ticket_messages` är ärendets konversation och ska förbli det: den har en
-- enkel modell där varje rad hör till ett ärende. Kommunikation börjar ofta
-- innan ett ärende finns – ett mejl till info@berryit.se, en chatt från en kund
-- – och kan sluta utan att bli ett ärende. Därför en egen modell som *kan*
-- kopplas till ett ärende, inte en som kräver det.
--
-- Tenancy
-- -------
-- En konversation tillhör exakt en organisation. Deltagare, meddelanden och
-- bilagor refererar sin konversation med (id, organization_id), så ett
-- meddelande kan aldrig hamna i en annan kunds tråd – databasen vägrar, utan
-- att någon policy behöver vara inblandad. En trigger hindrar dessutom att en
-- befintlig rad flyttas mellan organisationer.
--
-- Vad som INTE finns här
-- ---------------------
-- Ingen e-postleverantör ansluts, inga mejl skickas och ingen publik tjänst
-- öppnas. Mailboxarna är registerposter med namnet på en hemlighet, aldrig ett
-- lösenord eller en token.

-- --------------------------------------------------- förutsättning på tickets

-- En konversation får bara kopplas till ett ärende i samma organisation. Den
-- sammansatta främmande nyckeln kräver en matchande unik nyckel på tickets.
-- Den tillför ingen ny begränsning: id är redan unikt, paret blir det också.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_id_organization_key') then
    alter table public.tickets add constraint tickets_id_organization_key unique (id, organization_id);
  end if;
end;
$$;

-- ------------------------------------------------------------------ kanaler

create table public.comm_channels (
  key text primary key,
  label text not null,
  description text not null,
  -- Kräver kanalen en utgående anslutning för att fungera alls?
  needs_connection boolean not null default false,
  sort_order smallint not null default 0
);

insert into public.comm_channels (key, label, description, needs_connection, sort_order) values
  ('chat_customer', 'Kundchatt',    'Livechatt mellan kund och support.',              false, 10),
  ('chat_internal', 'Internchatt',  'Teknikernas egen tråd, aldrig synlig för kund.',  false, 20),
  ('email',         'E-post',       'Inkommande och utgående mejl via BERRYiT:s brevlåda.', true, 30)
on conflict (key) do nothing;

-- ---------------------------------------------------------------- brevlådor

-- Den låsta e-poststrukturen. Adresserna står här som referensdata, inte som
-- rader i registret: en brevlåda hör till en organisation, och vilken
-- organisation som är BERRYiT självt avgörs vid installationen.
create table public.comm_mailbox_purposes (
  key text primary key,
  label text not null,
  description text not null,
  -- Adressen rollen är avsedd för. Vägledning vid registrering, inte en regel:
  -- en kund kan ha sin egen supportadress.
  default_address text,
  -- Ska inkommande post kunna knytas till ett supportärende automatiskt?
  auto_link_tickets boolean not null default false,
  -- Ska posten kunna kategoriseras (allmän fråga, offert, samarbete)?
  allows_intent_categories boolean not null default false,
  sort_order smallint not null default 0
);

insert into public.comm_mailbox_purposes
  (key, label, description, default_address, auto_link_tickets, allows_intent_categories, sort_order) values
  ('support', 'Support', 'Primär supportadress. Post hit hör till ett ärende.',
   'support@berryit.se', true, false, 10),
  ('info', 'Information', 'Allmän företagskontakt: frågor, offerter och samarbeten.',
   'info@berryit.se', false, true, 20),
  ('other', 'Övrigt', 'Brevlåda utan särskild roll.', null, false, false, 30)
on conflict (key) do nothing;

create table public.comm_mailboxes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  address text not null,
  display_name text not null default '',

  -- Rollen avgör vad posten ska bli: ett ärende, eller en fråga att kategorisera.
  purpose text not null default 'other'
    references public.comm_mailbox_purposes (key) on update cascade on delete restrict,

  -- Leverantörsoberoende: adaptern vet hur den pratar, registret vet bara vem.
  provider_kind text not null default 'imap_smtp'
    check (provider_kind in ('imap_smtp', 'graph', 'gmail_api', 'none')),

  -- Två adresser kan vara alias till samma fysiska brevlåda hos leverantören.
  -- Nyckeln identifierar det underliggande kontot, så att posten hämtas en gång
  -- och inte en gång per adress. Null betyder eget konto.
  provider_account_key text,

  -- Får adressen användas som avsändare? Leverantören avgör det, inte vi:
  -- fältet speglar en verifierad behörighet och sätts av adaptern.
  can_send_from boolean not null default false,

  -- NAMNET på hemligheten i serverns secret store. Aldrig lösenordet.
  secret_ref text,

  -- Går bara att läsa i den här versionen. Att skicka kräver en egen migration
  -- och ett eget beslut, precis som skrivande connectors.
  access_mode text not null default 'read_only' check (access_mode in ('read_only', 'read_send')),

  is_enabled boolean not null default false,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'configured', 'connected', 'error', 'disabled')),
  last_synced_at timestamptz,
  last_error text,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, organization_id),
  unique (organization_id, address),
  constraint comm_mailboxes_address_format check (
    address ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(address) <= 254
  ),
  constraint comm_mailboxes_secret_ref_is_a_name check (
    secret_ref is null or (
      char_length(secret_ref) between 2 and 120
      and secret_ref ~ '^[A-Za-z0-9_.:-]+$'
      and secret_ref !~ '^eyJ'
      and secret_ref !~ '^(sk|gh[pousr]|xox|AIza)[-_]?[A-Za-z0-9]{10,}'
    )
  ),
  constraint comm_mailboxes_last_error_length check (last_error is null or char_length(last_error) <= 2000)
);

comment on table public.comm_mailboxes is
  'Brevlådor BERRYiT läser. secret_ref är namnet på en hemlighet i serverns store – aldrig värdet.';
comment on column public.comm_mailboxes.provider_account_key is
  'Identifierar det fysiska kontot hos leverantören. Adresser som delar nyckel är alias och hämtas en gång.';
comment on column public.comm_mailboxes.can_send_from is
  'Leverantören har verifierat att adressen får användas som avsändare. Utan detta vägrar adaptern skicka.';

-- ------------------------------------------------------------ konversationer

create table public.comm_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_key text not null references public.comm_channels (key) on update cascade on delete restrict,
  mailbox_id uuid,

  subject text not null default '',
  -- Konversationen kan kopplas till ett ärende, men behöver inte vara det.
  ticket_id uuid,
  assignee_id uuid references public.profiles (id) on delete set null,

  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  -- Internchatt syns aldrig för kund, oavsett övriga regler.
  is_internal boolean not null default false,

  -- Trådnyckel för e-post: normaliserat Message-ID för trådens rot.
  external_thread_key text,

  -- Vad posten handlar om. Sätts för supportpost direkt; för infopost är den
  -- null tills någon – en människa eller ett förslag från AI – avgjort saken.
  -- Ett tomt fält är ärligare än en gissning.
  intent text check (intent in ('support', 'general', 'quote', 'partnership')),

  last_message_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, organization_id),
  foreign key (ticket_id, organization_id)
    references public.tickets (id, organization_id) on delete set null,
  foreign key (mailbox_id, organization_id)
    references public.comm_mailboxes (id, organization_id) on delete set null,
  constraint comm_conversations_subject_length check (char_length(subject) <= 300),
  constraint comm_conversations_internal_channel check (
    (is_internal and channel_key = 'chat_internal') or (not is_internal and channel_key <> 'chat_internal')
  )
);

-- En e-posttråd är en konversation, inte flera. Utan detta blir inkorgen en
-- lista med samma samtal om och om igen.
create unique index comm_conversations_thread_idx
  on public.comm_conversations (organization_id, external_thread_key)
  where external_thread_key is not null;

-- ------------------------------------------------------------------ deltagare

create table public.comm_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,

  -- Antingen en känd användare eller en extern adress – aldrig båda, aldrig
  -- ingen. En deltagare utan identitet går inte att behörighetspröva.
  profile_id uuid references public.profiles (id) on delete cascade,
  external_address text,

  participant_role text not null default 'customer'
    check (participant_role in ('customer', 'staff', 'external')),

  -- Läst/oläst: allt efter den här tidpunkten är oläst för deltagaren.
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),

  unique (id, organization_id),
  foreign key (conversation_id, organization_id)
    references public.comm_conversations (id, organization_id) on delete cascade,
  constraint comm_participants_identity check (
    (profile_id is not null and external_address is null)
    or (profile_id is null and external_address is not null)
  ),
  constraint comm_participants_address_format check (
    external_address is null or (
      external_address ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      and char_length(external_address) <= 254
    )
  )
);

create unique index comm_participants_profile_idx
  on public.comm_participants (conversation_id, profile_id) where profile_id is not null;
create unique index comm_participants_address_idx
  on public.comm_participants (conversation_id, lower(external_address)) where external_address is not null;

-- --------------------------------------------------------------- meddelanden

create table public.comm_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,

  author_id uuid references public.profiles (id) on delete set null,
  -- Avsändaradressen som den stod i mejlet. Sparas som uppgift, inte som bevis:
  -- se sender_verified nedan.
  author_address text,

  direction text not null check (direction in ('inbound', 'outbound', 'internal')),

  -- Brödtexten lagras som text. HTML saneras av adaptern innan den sparas, och
  -- originalet sparas aldrig som körbar markup.
  body_text text not null,
  body_safe_html text,

  -- E-posttrådning. Message-ID är leverantörens identitet för meddelandet och
  -- används också som dubblettskydd.
  external_message_id text,
  in_reply_to text,
  reference_ids text[] not null default '{}',

  delivery_status text not null default 'received'
    check (delivery_status in ('draft', 'queued', 'sent', 'delivered', 'failed', 'received')),
  delivery_error text,
  delivered_at timestamptz,

  -- Sant bara när avsändaren kunnat knytas till en känd kontakt i
  -- organisationen. En obekräftad avsändare visas som obekräftad.
  sender_verified boolean not null default false,

  created_at timestamptz not null default now(),

  unique (id, organization_id),
  foreign key (conversation_id, organization_id)
    references public.comm_conversations (id, organization_id) on delete cascade,
  constraint comm_messages_body_length check (char_length(btrim(body_text)) between 1 and 100000),
  constraint comm_messages_safe_html_length check (body_safe_html is null or char_length(body_safe_html) <= 400000),
  constraint comm_messages_author check (author_id is not null or author_address is not null),
  constraint comm_messages_error_only_on_failure check (
    delivery_error is null or delivery_status = 'failed'
  )
);

-- Dubblettskydd och idempotens: samma Message-ID hämtas aldrig in två gånger.
create unique index comm_messages_external_idx
  on public.comm_messages (organization_id, external_message_id)
  where external_message_id is not null;

comment on column public.comm_messages.sender_verified is
  'Avsändaren matchade en känd kontakt i organisationen. Falskt betyder obekräftad – aldrig falsk.';

-- ------------------------------------------------------------------ bilagor

create table public.comm_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  message_id uuid,
  uploaded_by uuid references public.profiles (id) on delete set null,

  -- Samma privata bucket som ärendebilagor, egen prefix.
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,

  -- Intern bilaga når aldrig kunden, oavsett vem som frågar.
  visibility text not null default 'customer' check (visibility in ('customer', 'internal')),

  created_at timestamptz not null default now(),

  unique (id, organization_id),
  foreign key (conversation_id, organization_id)
    references public.comm_conversations (id, organization_id) on delete cascade,
  foreign key (message_id, organization_id)
    references public.comm_messages (id, organization_id) on delete cascade,
  constraint comm_attachments_size check (size_bytes > 0 and size_bytes <= 26214400),
  constraint comm_attachments_name_not_blank check (btrim(file_name) <> ''),
  constraint comm_attachments_path_prefix check (storage_path like 'conversations/%')
);

-- ------------------------------------------------------------ revisionsspår

create table public.comm_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'system', 'connector', 'ai')),
  event_type text not null check (event_type in (
    'created', 'message_received', 'message_sent', 'assigned', 'unassigned',
    'linked_ticket', 'unlinked_ticket', 'closed', 'reopened', 'participant_added',
    'ai_shared', 'delivery_failed'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (conversation_id, organization_id)
    references public.comm_conversations (id, organization_id) on delete cascade,
  constraint comm_events_detail_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.comm_events is 'Append-only. Vem gjorde vad i en konversation, och när.';

-- -------------------------------------------------------------------- index

create index comm_conversations_org_idx on public.comm_conversations (organization_id, status, last_message_at desc);
create index comm_conversations_assignee_idx on public.comm_conversations (assignee_id, status) where assignee_id is not null;
create index comm_conversations_unassigned_idx on public.comm_conversations (organization_id, channel_key)
  where assignee_id is null and status <> 'closed';
create index comm_conversations_ticket_idx on public.comm_conversations (ticket_id) where ticket_id is not null;
create index comm_conversations_intent_idx on public.comm_conversations (organization_id, intent)
  where intent is not null;
create index comm_mailboxes_account_idx on public.comm_mailboxes (organization_id, provider_account_key)
  where provider_account_key is not null;
create index comm_messages_conversation_idx on public.comm_messages (conversation_id, created_at desc);
create index comm_messages_sync_idx on public.comm_messages (organization_id, created_at desc);
create index comm_participants_conversation_idx on public.comm_participants (conversation_id);
create index comm_attachments_conversation_idx on public.comm_attachments (conversation_id);
create index comm_events_conversation_idx on public.comm_events (conversation_id, created_at desc);

-- ------------------------------------------------------------ behörighetslogik

-- Får den inloggade se konversationen?
--
--   personal          – ja, inom sitt scope
--   kund              – endast konversationer där hen är deltagare, och aldrig
--                       interna
--   organisationens kontaktperson – hela organisationens kundkonversationer
--
-- security definer: slår upp deltagarskap utan att trigga RLS på
-- comm_participants, vilket annars ger rekursion.
create or replace function public.can_view_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.comm_conversations c
     where c.id = p_conversation_id
       and (
         -- Personal: global eller scopad på organisationen.
         public.is_staff()
         or public.has_support_permission('tickets.read', c.organization_id)
         or (
           not c.is_internal
           and (
             exists (
               select 1 from public.comm_participants p
                where p.conversation_id = c.id and p.profile_id = auth.uid()
             )
             or (
               public.is_org_contact()
               and c.organization_id = public.current_organization_id()
             )
           )
         )
       )
  );
$$;

-- Får den inloggade skriva i konversationen?
-- Kunden får svara i sin egen tråd så länge den inte är stängd. Internchatt är
-- personalens.
create or replace function public.can_write_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.comm_conversations c
     where c.id = p_conversation_id
       and c.status <> 'closed'
       and (
         public.is_staff()
         or public.has_support_permission('tickets.write', c.organization_id)
         or (
           not c.is_internal
           and exists (
             select 1 from public.comm_participants p
              where p.conversation_id = c.id and p.profile_id = auth.uid()
           )
         )
       )
  );
$$;

grant execute on function public.can_view_conversation(uuid) to authenticated;
grant execute on function public.can_write_conversation(uuid) to authenticated;

-- ------------------------------------------------------------------ triggers

-- En konversation, ett meddelande eller en bilaga byter aldrig organisation.
create trigger comm_conversations_tenancy before update on public.comm_conversations
  for each row execute function public.guard_registry_tenancy();
create trigger comm_mailboxes_tenancy before update on public.comm_mailboxes
  for each row execute function public.guard_registry_tenancy();
create trigger comm_participants_tenancy before update on public.comm_participants
  for each row execute function public.guard_registry_tenancy();
create trigger comm_messages_tenancy before update on public.comm_messages
  for each row execute function public.guard_registry_tenancy();
create trigger comm_attachments_tenancy before update on public.comm_attachments
  for each row execute function public.guard_registry_tenancy();

-- Ett meddelande skrivs en gång. Ändrad historik är ingen historik.
create trigger comm_messages_immutable before delete on public.comm_messages
  for each row execute function public.deny_write();
create trigger comm_events_immutable before update or delete on public.comm_events
  for each row execute function public.deny_write();

-- Ett meddelande får inte flyttas till en annan konversation i efterhand, och
-- dess innehåll är historik.
create or replace function public.guard_message_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.conversation_id is distinct from old.conversation_id
     or new.body_text is distinct from old.body_text
     or new.author_id is distinct from old.author_id
     or new.author_address is distinct from old.author_address
     or new.external_message_id is distinct from old.external_message_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Ett meddelande kan inte skrivas om i efterhand'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger comm_messages_guard before update on public.comm_messages
  for each row execute function public.guard_message_immutability();

-- Håller konversationens tidsstämpel aktuell, så att inkorgen kan sorteras utan
-- att läsa alla meddelanden.
create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.comm_conversations
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
         updated_at = now()
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger comm_messages_touch after insert on public.comm_messages
  for each row execute function public.touch_conversation();

create trigger comm_conversations_updated before update on public.comm_conversations
  for each row execute function public.set_updated_at();
create trigger comm_mailboxes_updated before update on public.comm_mailboxes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------- RLS

alter table public.comm_channels enable row level security;
alter table public.comm_mailbox_purposes enable row level security;
alter table public.comm_mailboxes enable row level security;
alter table public.comm_conversations enable row level security;
alter table public.comm_participants enable row level security;
alter table public.comm_messages enable row level security;
alter table public.comm_attachments enable row level security;
alter table public.comm_events enable row level security;

grant select on public.comm_channels, public.comm_mailbox_purposes to authenticated;
grant select, insert, update on public.comm_conversations to authenticated;
grant select, insert, update on public.comm_mailboxes to authenticated;
grant select, insert, update on public.comm_participants to authenticated;
grant select, insert on public.comm_messages to authenticated;
grant select, insert on public.comm_attachments to authenticated;
grant select on public.comm_events to authenticated;
grant all on public.comm_channels, public.comm_mailbox_purposes, public.comm_mailboxes, public.comm_conversations,
  public.comm_participants, public.comm_messages, public.comm_attachments, public.comm_events
  to service_role;

create policy comm_channels_select on public.comm_channels
  for select to authenticated using (true);
create policy comm_mailbox_purposes_select on public.comm_mailbox_purposes
  for select to authenticated using (true);

-- Brevlådor visar vilken identitet vi läser e-post med. Samma krets som
-- hanterar anslutningar, alltså tvåfaktor.
create policy comm_mailboxes_select on public.comm_mailboxes
  for select to authenticated using (public.can_manage_connectors(organization_id));
-- Att registrera en brevlåda är att peka ut en identitet vi läser post med.
-- Samma krets och samma tvåfaktorkrav som för övriga anslutningar. Nya
-- brevlådor börjar i läsläge: att skicka kräver ett eget beslut.
create policy comm_mailboxes_insert on public.comm_mailboxes
  for insert to authenticated
  with check (public.can_manage_connectors(organization_id) and access_mode = 'read_only');
create policy comm_mailboxes_update on public.comm_mailboxes
  for update to authenticated
  using (public.can_manage_connectors(organization_id))
  with check (public.can_manage_connectors(organization_id));

create policy comm_conversations_select on public.comm_conversations
  for select to authenticated using (public.can_view_conversation(id));
-- Personal startar konversationer. En kund skapar dem inte själv i den här
-- versionen – kundens väg in är ett ärende eller ett mejl.
create policy comm_conversations_insert on public.comm_conversations
  for insert to authenticated
  with check (
    public.is_staff() or public.has_support_permission('tickets.write', organization_id)
  );
create policy comm_conversations_update on public.comm_conversations
  for update to authenticated
  using (public.is_staff() or public.has_support_permission('tickets.write', organization_id))
  with check (public.is_staff() or public.has_support_permission('tickets.write', organization_id));

create policy comm_participants_select on public.comm_participants
  for select to authenticated using (public.can_view_conversation(conversation_id));
create policy comm_participants_insert on public.comm_participants
  for insert to authenticated with check (public.can_write_conversation(conversation_id));
-- Uppdatering finns för läsmarkeringen. Den egna raden räcker: ingen ska kunna
-- markera som läst åt någon annan.
create policy comm_participants_update on public.comm_participants
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy comm_messages_select on public.comm_messages
  for select to authenticated using (public.can_view_conversation(conversation_id));
create policy comm_messages_insert on public.comm_messages
  for insert to authenticated
  with check (
    public.can_write_conversation(conversation_id)
    -- En klient skriver sitt eget meddelande, inte någon annans, och kan inte
    -- hitta på inkommande post eller en leveransstatus.
    and author_id = auth.uid()
    and direction in ('outbound', 'internal')
    and delivery_status in ('draft', 'queued')
    and external_message_id is null
  );

create policy comm_attachments_select on public.comm_attachments
  for select to authenticated
  using (
    public.can_view_conversation(conversation_id)
    and (visibility = 'customer' or public.is_staff()
         or public.has_support_permission('tickets.read', organization_id))
  );
create policy comm_attachments_insert on public.comm_attachments
  for insert to authenticated
  with check (public.can_write_conversation(conversation_id) and uploaded_by = auth.uid());

create policy comm_events_select on public.comm_events
  for select to authenticated using (public.can_view_conversation(conversation_id));

-- Storage: bilagor ligger i den befintliga privata bucketen under prefixet
-- conversations/. Policyerna där gäller redan hela bucketen; prefixet håller
-- isär ärende- och konversationsfiler.
