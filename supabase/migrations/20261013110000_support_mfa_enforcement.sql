-- BERRYiT Support Desk – PASS 2C: tvåfaktor som krav i databasen.
--
-- Bakgrund
-- --------
-- Fram till nu kontrollerades aal2 bara i klienterna: webben omdirigerade till
-- /control/mfa och desktopappen vägrade rendera moduler. Ett direkt anrop mot
-- PostgREST med en giltig aal1-token gick förbi hela spärren, eftersom RLS inte
-- såg skillnad på en superadministratör som bekräftat tvåfaktor och en som bara
-- angett lösenord.
--
-- Modellen
-- --------
--   current_aal()         – aal-claim ur användarens JWT ("aal1" / "aal2")
--   is_trusted_backend()  – service_role eller internt anrop helt utan JWT
--   is_machine_identity() – profil märkt som maskinidentitet (kan inte göra TOTP)
--   mfa_satisfied()       – aal2, betrodd backend eller maskinidentitet
--
-- Gränsen går mellan ärendearbete och administration:
--
--   | Vem                                   | Utan aal2            |
--   |---------------------------------------|----------------------|
--   | Kund                                  | oförändrat           |
--   | Tekniker (profilroll)                 | oförändrat           |
--   | Scoped tekniker (tickets.* på en org) | oförändrat           |
--   | Profilroll admin                      | tappar adminrättigheter |
--   | Global superadministratör             | tappar allt utöver personal |
--   | roles.grant, audit.read, m.fl.        | nekas                |
--
-- Ingen förlorar alltså åtkomst till sina egna ärenden, och ingen tekniker
-- hindras i sitt dagliga arbete. Det som kräver tvåfaktor är administration.
--
-- Migrationen är framåtriktad och idempotent: den ändrar inga rader utom de nya
-- kolumnernas förval, och rör aldrig auth.users eller GoTrues konfiguration.

-- ------------------------------------------------------------ nivå och identitet

-- aal-claim ur JWT. GoTrue sätter "aal1" efter lösenord och "aal2" efter
-- verifierad TOTP. Saknas claimen (äldre token, service_role) blir svaret null.
create or replace function public.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.aal', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal'
    ),
    ''
  );
$$;

comment on function public.current_aal() is
  'Autentiseringsnivå ur JWT: aal1 = lösenord, aal2 = lösenord + verifierad MFA.';

-- Betrodd backend: service_role-nyckeln eller ett internt anrop helt utan JWT
-- (triggers, migrationer, direkt SQL). Dessa kringgår redan RLS och ska inte
-- låsas ute av ett MFA-krav de omöjligt kan uppfylla.
--
-- Observera skillnaden mot ett anonymt API-anrop: PostgREST sätter alltid en
-- roll-claim ("anon" eller "authenticated"), medan ett internt anrop saknar
-- claims helt. Ett anrop med anon-nyckeln är alltså INTE en betrodd backend,
-- trots att auth.uid() är null. Identiteten avgörs av roll-claimen, inte av
-- frånvaron av en användare.
create or replace function public.is_trusted_backend()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- coalesce overallt: en behorighetsfunktion ska svara ja eller nej, aldrig
  -- null. Ett null hade visserligen behandlats som "inte sant" av en policy,
  -- men det hade ocksa gjort villkor som "not mfa_satisfied()" obrukbara.
  select coalesce(auth.role() = 'service_role', false)
      or (auth.uid() is null and auth.role() is null);
$$;

comment on function public.is_trusted_backend() is
  'Sant för service_role och interna anrop helt utan JWT. Ett anonymt API-anrop räknas inte hit.';

-- Maskinidentiteter: tjänstekonton som loggar in som vanliga användare men
-- omöjligt kan mata in en engångskod (t.ex. en infrastrukturagent). De markeras
-- uttryckligen, så att undantaget syns i registret i stället för att gömmas i kod.
alter table public.profiles
  add column if not exists is_machine boolean not null default false;

comment on column public.profiles.is_machine is
  'Tjänstekonto utan möjlighet till TOTP. Undantas MFA-kravet – sätts endast av administratör med aal2 eller av service_role.';

create or replace function public.is_machine_identity()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_machine from public.profiles p where p.id = auth.uid() and p.is_active),
    false
  );
$$;

-- Lever sessionen fortfarande?
--
-- En signerad JWT säger bara att den en gång utfärdades, inte att den
-- fortfarande gäller. GoTrue raderar raden i auth.sessions vid utloggning –
-- mätt på den körande stacken försvinner den omedelbart, medan PostgREST
-- fortsätter att acceptera samma token tills den går ut. Därför kontrolleras
-- sessionen separat för allt som är privilegierat.
--
-- Saknas tabellen är svaret nej. Det är avsiktligt: en kontroll som tyst
-- slutar kontrollera är värre än ingen kontroll alls. Betrodda backendtjänster
-- har ingen session och undantas före uppslaget.
create or replace function public.session_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_trusted_backend() then true
    when to_regclass('auth.sessions') is null then false
    else exists (
      select 1
        from auth.sessions s
       where s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
         and (s.not_after is null or s.not_after > now())
    )
  end;
$$;

comment on function public.session_is_live() is
  'Sant när sessionen bakom JWT:n fortfarande finns kvar i GoTrue. Utloggning slår igenom direkt, utan att invänta att token går ut.';

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.is_trusted_backend(), false)
      or coalesce(public.is_machine_identity(), false)
      -- En administrativ åtgärd kräver både verifierad tvåfaktor och en session
      -- som fortfarande lever. Signaturen ensam räcker inte.
      or (
        coalesce(public.current_aal() = 'aal2', false)
        and coalesce(public.session_is_live(), false)
      );
$$;

comment on function public.mfa_satisfied() is
  'Sant när tvåfaktorkravet är uppfyllt: verifierad aal2 med levande session, betrodd backend eller maskinidentitet.';

-- ------------------------------------------------------- vilka behörigheter kräver MFA

alter table public.support_permissions
  add column if not exists requires_mfa boolean not null default false;

comment on column public.support_permissions.requires_mfa is
  'Behörigheten gäller endast med uppfyllt tvåfaktorkrav. Ärendearbete är undantaget, administration är det inte.';

-- Allt som administrerar plattformen kräver tvåfaktor. Ärendearbetet
-- (tickets.read/write/reassign) gör det inte – annars skulle en tekniker utan
-- MFA inte kunna göra sitt jobb.
update public.support_permissions
   set requires_mfa = true
 where key in (
   'roles.grant',
   'onarly.entitlements.manage',
   'audit.read',
   'organizations.manage',
   'technicians.manage',
   'escalation.configure'
 );

-- -------------------------------------------------------------- behörighetsfunktioner

-- En behörighet som kräver MFA ger ingenting förrän kravet är uppfyllt.
create or replace function public.has_support_permission(p_permission text, p_organization_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.active_support_grants(auth.uid()) g
      join public.support_role_permissions rp on rp.role_key = g.role_key
      join public.support_permissions p on p.key = rp.permission_key
     where rp.permission_key = p_permission
       and (
         g.scope = 'global'
         or (p_organization_id is not null and g.organization_id = p_organization_id)
       )
       and (not p.requires_mfa or public.mfa_satisfied())
  );
$$;

-- Superadministratör är en privilegierad roll och kräver därför alltid aal2.
create or replace function public.is_support_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.mfa_satisfied(), false)
     and exists (
       select 1 from public.active_support_grants(auth.uid()) g
        where g.role_key = 'BERRYIT_SUPPORT_SUPER_ADMIN' and g.scope = 'global'
     );
$$;

-- Samma sak för profilrollen admin: administration kräver tvåfaktor, men
-- personen behåller sin personalåtkomst till ärenden (se is_staff nedan).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (coalesce(public.current_app_role() = 'admin', false) and public.mfa_satisfied())
      or public.is_support_super_admin();
$$;

-- is_staff ändras inte i sak, men skrivs om här så att definitionen står samlad:
-- personal är profilrollen technician/admin eller en aktiv tickets.read-tilldelning.
-- tickets.read kräver inte MFA, alltså påverkas inget ärendearbete.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('technician', 'admin'), false)
      or public.has_support_permission('tickets.read');
$$;

-- ------------------------------------------------------------- skydd i triggers

-- Policyer kan ändras; triggern är sista försvaret. Ändringar av behörigheter
-- och ONARLY-rättigheter avvisas utan uppfyllt MFA-krav, oavsett vilken policy
-- som släppte igenom anropet.
create or replace function public.guard_support_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  granter uuid := auth.uid();
  granter_rank smallint;
  target_rank smallint;
begin
  -- Ingen JWT = service_role eller direkt SQL (plattformsägaren). Dessa sätter
  -- den första superadministratören och kringgår RLS redan i dag.
  if granter is null then
    return new;
  end if;

  if not public.mfa_satisfied() then
    raise exception 'Tvåfaktor krävs för att ändra supportbehörigheter'
      using errcode = 'insufficient_privilege';
  end if;

  select r.rank into target_rank from public.support_roles r where r.key = new.role_key;
  granter_rank := public.max_support_rank(granter);

  if tg_op = 'INSERT' then
    -- Globala roller delas endast ut av en global superadministratör.
    if new.scope = 'global' and not public.is_support_super_admin() then
      raise exception 'Endast global superadministratör kan dela ut globala roller'
        using errcode = 'insufficient_privilege';
    end if;

    -- Man kan aldrig dela ut sin egen rang eller högre.
    if target_rank >= granter_rank and not public.is_support_super_admin() then
      raise exception 'Kan inte dela ut en roll med samma eller högre rang än den egna'
        using errcode = 'insufficient_privilege';
    end if;

    if new.granted_by is distinct from granter then
      raise exception 'granted_by måste vara den som utför tilldelningen'
        using errcode = 'insufficient_privilege';
    end if;

    return new;
  end if;

  -- UPDATE: endast återkallelse är tillåten, aldrig omskrivning av tilldelningen.
  if new.grantee_id is distinct from old.grantee_id
     or new.role_key is distinct from old.role_key
     or new.scope is distinct from old.scope
     or new.organization_id is distinct from old.organization_id
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.expires_at is distinct from old.expires_at
     or new.reason is distinct from old.reason then
    raise exception 'En tilldelning kan inte ändras i efterhand – återkalla och skapa en ny'
      using errcode = 'insufficient_privilege';
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'En återkallad tilldelning kan inte återaktiveras'
      using errcode = 'insufficient_privilege';
  end if;

  if new.revoked_at is not null and new.revoked_by is distinct from granter then
    raise exception 'revoked_by måste vara den som utför återkallelsen'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create or replace function public.guard_onarly_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.mfa_satisfied() then
    raise exception 'Tvåfaktor krävs för att ändra ONARLY-rättigheter'
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'INSERT' then
    if new.granted_by is distinct from auth.uid() then
      raise exception 'granted_by måste vara den som utför beviljandet'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.product_key is distinct from old.product_key
     or new.entitlement is distinct from old.entitlement
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.reason is distinct from old.reason then
    raise exception 'En rättighet kan inte ändras i efterhand – återkalla och bevilja på nytt'
      using errcode = 'insufficient_privilege';
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'En återkallad rättighet kan inte återaktiveras'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Profilens privilegiekolumner skyddas som tidigare, nu även is_machine. Att
-- sätta is_machine är att dela ut ett undantag från MFA-kravet, och kräver
-- därför administratör med uppfyllt krav (eller service_role).
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  new.role := old.role;
  new.organization_id := old.organization_id;
  new.is_org_admin := old.is_org_admin;
  new.is_active := old.is_active;
  new.is_machine := old.is_machine;
  return new;
end;
$$;

-- ------------------------------------------------------------------- rättigheter

grant execute on function public.current_aal() to authenticated, anon, service_role;
grant execute on function public.is_trusted_backend() to authenticated, anon, service_role;
grant execute on function public.is_machine_identity() to authenticated, service_role;
grant execute on function public.session_is_live() to authenticated, service_role;
grant execute on function public.mfa_satisfied() to authenticated, service_role;
