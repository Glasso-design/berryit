-- REVIEWED HOTFIX CANDIDATE ONLY. Production execution requires separate approval.
-- Targets ONLY the verified six-migration baseline; never edit historical migrations.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '15s';
do $$
declare applied text[]; source_hash text;
begin
  select array_agg(version order by version) into applied from public.schema_migrations;
  if applied is distinct from array[
    '20261013080000_platform_bootstrap.sql','20261013090000_support_desk_core.sql',
    '20261013090100_support_desk_rls.sql','20261013090200_support_desk_storage.sql',
    '20261013090300_support_authority.sql','20261013091000_support_authority_hardening.sql'
  ]::text[] then
    raise exception 'Hotfix baseline differs; no changes permitted';
  end if;
  select md5(prosrc) into source_hash from pg_proc where oid='public.active_support_grants(uuid)'::regprocedure;
  if source_hash not in ('7046b3ef55adcf0b7ec7a454d43c106c','cdd0ccbd4098db65edcf14a872e002be') then
    raise exception 'Helper definition differs; review required';
  end if;
end;
$$;

-- Reuses the helper repair already reviewed in the later Security & CI migration.
create or replace function public.active_support_grants(p_user uuid)
returns table (role_key text, scope public.support_scope, organization_id uuid)
language sql stable security definer set search_path = ''
as $$
  select g.role_key, g.scope, g.organization_id
  from public.support_role_grants g
  join public.profiles p on p.id = g.grantee_id and p.is_active
  where g.grantee_id = p_user
    and (
      p_user = auth.uid()
      or auth.role() = 'service_role'
      or (auth.role() is null and auth.uid() is null
          and session_user not in ('anon', 'authenticated', 'authenticator')
          and coalesce(current_setting('role', true), '') not in ('anon', 'authenticated', 'authenticator'))
    )
    and g.revoked_at is null and (g.expires_at is null or g.expires_at > now());
$$;
revoke all on function public.active_support_grants(uuid),public.max_support_rank(uuid) from public,anon;
grant execute on function public.active_support_grants(uuid),public.max_support_rank(uuid) to authenticated,service_role;

insert into public.support_admin_audit(action,target_type,target_id,scope,reason,metadata)
values('security.hotfix.prepared_helper_applied','function','active_support_grants(uuid)','global',
 'Approved operator hotfix: self-only helper and closed anonymous rank wrapper',
 jsonb_build_object('change_id','PASS3B-active-support-grants','baseline_migrations',6));
commit;
