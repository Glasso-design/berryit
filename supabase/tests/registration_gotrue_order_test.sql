-- MASTER PASS 1 regression: manual customer registration in GoTrue's real
-- statement order (INSERT auth.users with provider app_metadata, then UPDATE
-- raw_app_meta_data with the caller's app_metadata, same transaction).
-- Runs against a migrated database as superuser (local PostgreSQL with
-- local_bootstrap.sql, or a throwaway Supabase stack). Everything is rolled back.
begin;
do $$
declare
  admin_id uuid := gen_random_uuid(); sess uuid := gen_random_uuid(); org uuid;
  newbie uuid := gen_random_uuid(); late uuid := gen_random_uuid(); revoked uuid := gen_random_uuid();
  p record; n int; failed boolean;
begin
  insert into auth.users(id,email,raw_user_meta_data) values(admin_id,'mp1.admin@example.test','{"full_name":"MP1 Admin"}');
  update public.profiles set role='admin' where id=admin_id;
  insert into public.support_role_grants(grantee_id,role_key,scope,reason) values(admin_id,'BERRYIT_SUPPORT_SUPER_ADMIN','global','MP1 regression fixture');
  insert into auth.sessions(id,user_id,aal) values(sess,admin_id,'aal2');
  insert into public.organizations(name) values('MP1 Regression AB') returning id into org;

  -- 1. GoTrue order: insert without the marker, then update app_metadata.
  insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    values(newbie,'mp1.kund@example.test','{"full_name":"MP1 Kund","phone":"070"}','{"provider":"email","providers":["email"]}');
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('berryit_manual_customer',
    jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',org)) where id=newbie;
  select * into p from public.profiles where id=newbie;
  if p.organization_id is distinct from org or not p.login_activation_pending or p.registered_by is distinct from admin_id or p.role <> 'customer' then
    raise exception 'FAIL 1: GoTrue-order registration not applied: %', row_to_json(p);
  end if;
  select count(*) into n from public.support_admin_audit where action='customer_registered' and target_id=newbie::text and actor_id=admin_id;
  if n <> 1 then raise exception 'FAIL 1: expected one audit row, got %', n; end if;
  raise notice 'ok: GoTrue insert-then-update registration sets organisation, pending activation, registrar and audit';

  -- 2. A second update with the same marker is a no-op (no duplicate audit).
  update auth.users set raw_app_meta_data = raw_app_meta_data || '{"extra":true}'::jsonb where id=newbie;
  select count(*) into n from public.support_admin_audit where action='customer_registered' and target_id=newbie::text;
  if n <> 1 then raise exception 'FAIL 2: duplicate audit rows %', n; end if;
  raise notice 'ok: later app_metadata updates do not re-register';

  -- 3. An existing account (profile not created in this transaction) can never be converted.
  insert into auth.users(id,email) values(late,'mp1.befintlig@example.test');
  update public.profiles set created_at = now() - interval '1 day' where id=late;
  failed := false;
  begin
    update auth.users set raw_app_meta_data = jsonb_build_object('berryit_manual_customer',
      jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',org)) where id=late;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL 3: existing account was converted'; end if;
  select * into p from public.profiles where id=late;
  if p.organization_id is not null or p.login_activation_pending then raise exception 'FAIL 3: profile changed %', row_to_json(p); end if;
  raise notice 'ok: existing accounts cannot be converted into manual registrations';

  -- 4. Registrar without live aal2 session fails closed (whole GoTrue transaction aborts).
  delete from auth.sessions where id=sess;
  insert into auth.users(id,email,raw_app_meta_data) values(revoked,'mp1.nekad@example.test','{"provider":"email"}');
  failed := false;
  begin
    update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('berryit_manual_customer',
      jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',org)) where id=revoked;
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'FAIL 4: registration accepted without live aal2 registrar session'; end if;
  raise notice 'ok: registrar without live aal2 session is refused';

  -- 5. The original single-INSERT path (PGlite fixtures, older GoTrue) still works.
  insert into auth.sessions(id,user_id,aal) values(sess,admin_id,'aal2');
  insert into auth.users(id,email,raw_app_meta_data) values(gen_random_uuid(),'mp1.direkt@example.test',
    jsonb_build_object('berryit_manual_customer',jsonb_build_object('actor_id',admin_id,'session_id',sess,'organization_id',org)));
  select count(*) into n from public.profiles where email='mp1.direkt@example.test' and login_activation_pending and organization_id=org;
  if n <> 1 then raise exception 'FAIL 5: insert path broken'; end if;
  raise notice 'ok: single-INSERT registration path unchanged';
  raise notice 'MP1 REGISTRATION REGRESSION: 5/5 PASS';
end;
$$;
rollback;
