-- MASTER PASS 1/2 regression: manual customer registration in GoTrue's real
-- statement order (INSERT auth.users with provider app_metadata, then UPDATE
-- raw_app_meta_data with the caller's app_metadata, same transaction).
-- Runs against a migrated database as superuser (local PostgreSQL with
-- local_bootstrap.sql, or a throwaway Supabase stack). Everything is rolled back.
--
-- MASTER PASS 2: every registration is checked against ALL support_admin_audit
-- rows written while it ran (id > the highest id before it), not only
-- customer_registered (M1). Refused registrations must leave zero rows in
-- auth.users, profiles and the audit log (M5, SQL level; REAL GoTrue in api.e2e B8b).
begin;
do $$
declare
  admin_id uuid := gen_random_uuid(); sess uuid := gen_random_uuid(); sess_aal1 uuid := gen_random_uuid();
  tech_id uuid := gen_random_uuid(); tech_sess uuid := gen_random_uuid(); org uuid;
  newbie uuid := gen_random_uuid(); late uuid := gen_random_uuid(); revoked uuid := gen_random_uuid();
  priv uuid := gen_random_uuid(); probe uuid; p record; a record; n int; before bigint; failed boolean;
  state text; expected text; got text;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(admin_id,'mp1.admin@example.test','{"full_name":"MP1 Admin"}');
  update public.profiles set role='admin' where id=admin_id;
  insert into public.support_role_grants(grantee_id,role_key,scope,reason) values(admin_id,'BERRYIT_SUPPORT_SUPER_ADMIN','global','MP1 regression fixture');
  insert into auth.sessions(id,user_id,aal) values(sess,admin_id,'aal2'),(sess_aal1,admin_id,'aal1');
  insert into auth.users(id,email,raw_user_meta_data) values(tech_id,'mp1.tekniker@example.test','{"full_name":"MP1 Tekniker"}');
  update public.profiles set role='technician' where id=tech_id;
  insert into auth.sessions(id,user_id,aal) values(tech_sess,tech_id,'aal2');
  insert into public.organizations(name) values('MP1 Regression AB') returning id into org;

  -- 1. GoTrue order: insert without the marker, then update app_metadata.
  select coalesce(max(id),0) into before from public.support_admin_audit;
  insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    values(newbie,'mp1.kund@example.test','{"full_name":"MP1 Kund","phone":"070"}','{"provider":"email","providers":["email"]}');
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('berryit_manual_customer',
    jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',org)) where id=newbie;
  select * into p from public.profiles where id=newbie;
  if p.organization_id is distinct from org or not p.login_activation_pending or p.registered_by is distinct from admin_id or p.role <> 'customer' then
    raise exception 'FAIL 1: GoTrue-order registration not applied: %', row_to_json(p);
  end if;
  select count(*) into n from public.support_admin_audit where id > before;
  if n <> 1 then
    raise exception 'FAIL 1: a registration must write exactly ONE audit row in total, got %: %', n,
      (select json_agg(json_build_object('action',action,'actor_id',actor_id,'target_id',target_id,'reason',reason) order by id)
         from public.support_admin_audit where id > before);
  end if;
  select * into a from public.support_admin_audit where id > before;
  if a.action <> 'customer_registered' or a.actor_id is distinct from admin_id or a.target_id <> newbie::text
     or a.organization_id is distinct from org or a.scope <> 'organization' then
    raise exception 'FAIL 1: wrong audit row %', row_to_json(a);
  end if;
  raise notice 'ok: GoTrue insert-then-update registration sets organisation, pending activation, registrar and exactly one attributed audit row';

  -- 2. A second update with the same marker is a no-op (no audit row at all).
  select coalesce(max(id),0) into before from public.support_admin_audit;
  update auth.users set raw_app_meta_data = raw_app_meta_data || '{"extra":true}'::jsonb where id=newbie;
  select count(*) into n from public.support_admin_audit where id > before;
  if n <> 0 then raise exception 'FAIL 2: later app_metadata update wrote % audit rows', n; end if;
  raise notice 'ok: later app_metadata updates do not re-register or audit';

  -- 3. An existing account (profile not created in this transaction) can never be converted.
  insert into auth.users(id,email) values(late,'mp1.befintlig@example.test');
  update public.profiles set created_at = now() - interval '1 day' where id=late;
  select coalesce(max(id),0) into before from public.support_admin_audit;
  failed := false;
  begin
    update auth.users set raw_app_meta_data = jsonb_build_object('berryit_manual_customer',
      jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',org)) where id=late;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL 3: existing account was converted'; end if;
  select * into p from public.profiles where id=late;
  if p.organization_id is not null or p.login_activation_pending then raise exception 'FAIL 3: profile changed %', row_to_json(p); end if;
  select count(*) into n from public.support_admin_audit where id > before;
  if n <> 0 then raise exception 'FAIL 3: refused conversion left % audit rows', n; end if;
  raise notice 'ok: existing accounts cannot be converted into manual registrations';

  -- 4-7. Refusals in GoTrue order: the whole (sub)transaction aborts, nothing remains.
  -- Each case runs in a subtransaction (like GoTrue's own transaction) and must
  -- fail with the intended SQLSTATE: 42501 for the registrar, 23503 for the organisation.
  for probe, state, expected in
    select * from (values
      (gen_random_uuid(), 'no-live-session', '42501'), (gen_random_uuid(), 'aal1-session', '42501'),
      (gen_random_uuid(), 'forged-session', '42501'), (gen_random_uuid(), 'unknown-organisation', '23503'),
      (gen_random_uuid(), 'technician-registrar', '42501')) v(id, label, code)
  loop
    select coalesce(max(id),0) into before from public.support_admin_audit;
    failed := false; got := null;
    begin
      if state = 'no-live-session' then delete from auth.sessions where id=sess; end if;
      insert into auth.users(id,email,raw_app_meta_data) values(probe,'mp1.nekad.'||state||'@example.test','{"provider":"email"}');
      update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('berryit_manual_customer',
        jsonb_build_object(
          'actor_id', case when state='technician-registrar' then tech_id else admin_id end,
          'session_id', case state when 'aal1-session' then sess_aal1 when 'forged-session' then gen_random_uuid()
                                   when 'technician-registrar' then tech_sess else sess end,
          'organization_id', case when state='unknown-organisation' then gen_random_uuid() else org end)) where id=probe;
    exception when others then failed := true; got := sqlstate;
    end;
    if not failed then raise exception 'FAIL 4: registration accepted (%)', state; end if;
    if got <> expected then raise exception 'FAIL 4: % refused with % instead of %', state, got, expected; end if;
    select (select count(*) from auth.users where id=probe) + (select count(*) from public.profiles where id=probe)
         + (select count(*) from public.support_admin_audit where id > before) into n;
    if n <> 0 then raise exception 'FAIL 4: refused registration (%) left % rows behind', state, n; end if;
  end loop;
  raise notice 'ok: no live session / aal1 session / forged session / unknown organisation / technician registrar are refused and leave zero rows';

  -- 8. Private customer (organisation NULL): one global-scope audit row.
  select coalesce(max(id),0) into before from public.support_admin_audit;
  insert into auth.users(id,email,raw_app_meta_data) values(priv,'mp1.privat@example.test','{"provider":"email"}');
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('berryit_manual_customer',
    jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',null)) where id=priv;
  select count(*) into n from public.support_admin_audit where id > before;
  select * into a from public.support_admin_audit where id > before order by id limit 1;
  if n <> 1 or a.action <> 'customer_registered' or a.scope <> 'global' or a.organization_id is not null then
    raise exception 'FAIL 8: private registration audit n=% %', n, row_to_json(a);
  end if;
  if not exists (select 1 from public.profiles where id=priv and organization_id is null and login_activation_pending and registered_by=admin_id) then
    raise exception 'FAIL 8: private registration not applied';
  end if;
  raise notice 'ok: private customer registration writes one global-scope audit row';

  -- 9. The M1 exception is narrow: a later change to the registered profile, and a
  --    registration-shaped profile write WITHOUT the attributed row, are still audited.
  select coalesce(max(id),0) into before from public.support_admin_audit;
  update public.profiles set phone = '070-111' where id=newbie;
  select count(*) into n from public.support_admin_audit where id > before and action='profiles_update' and target_id=newbie::text;
  if n <> 1 then raise exception 'FAIL 9: later profile change not audited (%)', n; end if;
  probe := gen_random_uuid();
  insert into auth.users(id,email) values(probe,'mp1.direktskrivning@example.test');
  select coalesce(max(id),0) into before from public.support_admin_audit;
  update public.profiles set login_activation_pending = true, registered_by = admin_id where id=probe;
  select count(*) into n from public.support_admin_audit where id > before and action='profiles_update' and target_id=probe::text;
  if n <> 1 then raise exception 'FAIL 9: registration-shaped write without customer_registered row not audited (%)', n; end if;
  select coalesce(max(id),0) into before from public.support_admin_audit;
  insert into public.organizations(name) values('MP1 Revisionskontroll AB');
  select count(*) into n from public.support_admin_audit where id > before and action='organizations_insert';
  if n <> 1 then raise exception 'FAIL 9: organisation insert not audited (%)', n; end if;
  raise notice 'ok: other profile and organisation changes are audited as before';

  -- 10. The original single-INSERT path (PGlite fixtures, older GoTrue) still works with one audit row.
  select coalesce(max(id),0) into before from public.support_admin_audit;
  insert into auth.users(id,email,raw_app_meta_data) values(gen_random_uuid(),'mp1.direkt@example.test',
    jsonb_build_object('berryit_manual_customer',jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',org)));
  select count(*) into n from public.profiles where email='mp1.direkt@example.test' and login_activation_pending and organization_id=org;
  if n <> 1 then raise exception 'FAIL 10: insert path broken'; end if;
  select count(*) into n from public.support_admin_audit where id > before;
  if n <> 1 then raise exception 'FAIL 10: insert path wrote % audit rows', n; end if;
  raise notice 'ok: single-INSERT registration path unchanged (one audit row)';
  raise notice 'MP1 REGISTRATION REGRESSION: 10/10 PASS';
end;
$$;
rollback;
