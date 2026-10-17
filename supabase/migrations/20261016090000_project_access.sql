-- Forward only. Existing project/role/grant tables remain the only registries.
-- No external resources, Auth accounts or customer records are deleted.
revoke create on schema public from public,anon,authenticated;
alter table public.support_projects
  add column status text not null default 'active' check(status in ('planned','active','paused','completed')),
  add column environment text not null default 'development' check(environment in ('development','staging','production')),
  add column website_url text check(website_url is null or (length(website_url)<=500 and website_url ~ '^https://[^[:space:]]+$')),
  add column contact_id uuid references public.profiles(id) on delete restrict,
  add column archived_at timestamptz,
  add column source text not null default 'manual' check(source in ('manual','berryit','github','vercel')),
  add column revision bigint not null default 1;

alter table public.support_roles
  add column description text not null default '' check(length(description)<=2000),
  add column organization_id uuid references public.organizations(id) on delete restrict,
  add column is_active boolean not null default true,
  add column revision bigint not null default 1,
  add column assignment_revision bigint not null default 0;
alter table public.support_role_grants
  add column project_id uuid,
  add constraint grant_project_tenant foreign key(project_id,organization_id)
    references public.support_projects(id,organization_id) on delete restrict,
  add constraint grant_project_scope check(project_id is null or (scope='organization' and organization_id is not null));
alter table public.tickets add column project_id uuid,
 add constraint ticket_project_tenant foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict,
 add constraint ticket_project_requires_org check(project_id is null or organization_id is not null);
create index tickets_project_idx on public.tickets(project_id) where project_id is not null;
alter table public.support_role_grants drop constraint external_grant_scope;
alter table public.support_role_grants add constraint external_grant_scope check(not is_external_consultant or (
 scope='organization' and organization_id is not null and expires_at is not null and commissioning_organization_id is not null
 and length(btrim(coalesce(consultant_company,''))) between 2 and 200));
create or replace function public.guard_external_consultant_grant() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.is_external_consultant is distinct from old.is_external_consultant
 or new.consultant_company is distinct from old.consultant_company
 or new.commissioning_organization_id is distinct from old.commissioning_organization_id) then
 raise exception 'Konsultidentiteten är oföränderlig; återkalla och tilldela igen' using errcode='42501'; end if;
 if new.is_external_consultant and (new.scope<>'organization' or exists(
 select 1 from public.support_role_permissions p where p.role_key=new.role_key and p.permission_key in
 ('roles.manage','roles.grant','users.manage','organizations.manage','technicians.manage','escalation.configure'))) then
 raise exception 'Extern konsult får inte ges personaladministration eller global åtkomst' using errcode='42501'; end if;
 return new;
end;
$$;
drop index public.support_role_grants_active_org_idx;
create unique index support_role_grants_active_org on public.support_role_grants(grantee_id,role_key,organization_id)
  where revoked_at is null and scope='organization' and project_id is null;
create unique index support_role_grants_active_project on public.support_role_grants(grantee_id,role_key,project_id)
  where revoked_at is null and project_id is not null;

insert into public.support_permissions(key,description,requires_mfa) values
 ('projects.read','Läsa projekt inom tilldelat scope',false),
 ('projects.manage','Administrera projekt inom tilldelat scope',true),
 ('repositories.read','Granska ett uttryckligen anslutet repository via server',false),
 ('repositories.review','Registrera kodförslag i projektet utan att skriva till repository',false),
 ('repositories.write','Reserverad för separat godkänt kodarbetsflöde; ingen skrivadapter finns',true),
 ('roles.manage','Administrera egna rollmallar inom delegerat scope',true),
 ('users.manage','Administrera aktiva personalkonton inom scope',true);
update public.support_permissions set description='Svara och ändra status/prioritet inom scope; tilldelning kräver tickets.reassign' where key='tickets.write';
insert into public.support_roles(key,label,rank,is_system,description) values
 ('BERRYIT_DEVELOPER','DEVELOPER',40,true,'Projektbegränsad kodgranskning; ingen repository-skrivning');
update public.support_roles set label='ADMIN' where key='BERRYIT_SUPPORT_ADMIN';
update public.support_roles set label='IT SUPPORT' where key='BERRYIT_SUPPORT_TECHNICIAN';
insert into public.support_role_permissions(role_key,permission_key)
 select 'BERRYIT_SUPPORT_SUPER_ADMIN',key from public.support_permissions on conflict do nothing;
insert into public.support_role_permissions(role_key,permission_key) values
 ('BERRYIT_SUPPORT_ADMIN','projects.read'),('BERRYIT_SUPPORT_ADMIN','projects.manage'),
 ('BERRYIT_SUPPORT_ADMIN','roles.manage'),('BERRYIT_SUPPORT_ADMIN','roles.grant'),
 ('BERRYIT_SUPPORT_ADMIN','connectors.manage'),('BERRYIT_SUPPORT_ADMIN','infrastructure.read'),
 ('BERRYIT_SUPPORT_ADMIN','repositories.read'),
 ('BERRYIT_SUPPORT_ADMIN','repositories.review'),
 ('BERRYIT_SUPPORT_ADMIN','users.manage'),
 ('BERRYIT_SUPPORT_TECHNICIAN','projects.read'),
 ('BERRYIT_DEVELOPER','projects.read'),('BERRYIT_DEVELOPER','repositories.read'),('BERRYIT_DEVELOPER','repositories.review') on conflict do nothing;

-- Freeze legacy server-maintained profile authority into explicit grants ONCE.
-- Future profile edits are never an authority source. Existing owner grants survive.
insert into public.support_role_grants(grantee_id,role_key,scope,reason)
 select p.id,case when p.role='admin' then 'BERRYIT_SUPPORT_ADMIN' else 'BERRYIT_SUPPORT_TECHNICIAN' end,
 'global','Migration: explicit record of pre-existing legacy profile authority; review global scope before rollout'
 from public.profiles p where p.role in ('admin','technician') and p.is_active
 on conflict do nothing;
-- Preserve the old technicians' existing infrastructure READ access explicitly,
-- without adding it to newly assigned IT SUPPORT roles or inferring it forever
-- from a profile flag. This compatibility grant is reviewed at rollout.
insert into public.support_roles(key,label,rank,is_system,description)
 values('BERRYIT_LEGACY_INFRA_READ','Äldre infrastrukturläsning',1,true,'Engångskonvertering av befintlig profilåtkomst; granska och ersätt med godkänt scope');
insert into public.support_role_permissions(role_key,permission_key) values('BERRYIT_LEGACY_INFRA_READ','infrastructure.read');
insert into public.support_role_grants(grantee_id,role_key,scope,reason)
 select p.id,'BERRYIT_LEGACY_INFRA_READ','global','Migration: existing legacy infrastructure read access; explicit scope review required'
 from public.profiles p where p.role='technician' and p.is_active and not exists(
 select 1 from public.support_role_grants g join public.support_role_permissions rp on rp.role_key=g.role_key
 where g.grantee_id=p.id and g.scope='global' and rp.permission_key='infrastructure.read'
 and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())) on conflict do nothing;

create function public.has_resource_permission(p_permission text,p_organization_id uuid default null,p_project_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.support_role_grants g
   join public.profiles u on u.id=g.grantee_id and u.is_active and not u.login_activation_pending
   join public.support_roles r on r.key=g.role_key and r.is_active
   join public.support_role_permissions rp on rp.role_key=r.key and rp.permission_key=p_permission
   join public.support_permissions p on p.key=rp.permission_key
   where g.grantee_id=auth.uid() and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
     and (g.scope='global' or (g.organization_id=p_organization_id and
       (g.project_id is null or g.project_id=p_project_id)))
     and (r.organization_id is null or r.organization_id=p_organization_id)
     and (p_project_id is null or exists(select 1 from public.support_projects x
       where x.id=p_project_id and x.organization_id=p_organization_id))
     and (not p.requires_mfa or (public.current_aal()='aal2' and public.session_is_live() and not u.is_machine))
 );
$$;
-- Old callers cannot accidentally promote project access to organization access.
create or replace function public.has_support_permission(p_permission text,p_organization_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_resource_permission(p_permission,p_organization_id,null);
$$;
create or replace function public.session_is_live() returns boolean
language sql stable security definer set search_path='' as $$
 select case when public.is_trusted_backend() then true else exists(
 select 1 from auth.sessions s where s.id=nullif(auth.jwt()->>'session_id','')::uuid
 and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now())) end;
$$;
create or replace function public.active_support_grants(p_user uuid)
returns table(role_key text,scope public.support_scope,organization_id uuid)
language sql stable security definer set search_path='' as $$
 select g.role_key,g.scope,g.organization_id from public.support_role_grants g
 join public.profiles p on p.id=g.grantee_id and p.is_active and not p.login_activation_pending
 join public.support_roles r on r.key=g.role_key and r.is_active
 where g.grantee_id=p_user and g.project_id is null
 and (p_user=auth.uid() or auth.role()='service_role' or
   (auth.role() is null and auth.uid() is null and session_user not in ('anon','authenticated','authenticator')
    and coalesce(current_setting('role',true),'') not in ('anon','authenticated','authenticator')))
 and g.revoked_at is null and (g.expires_at is null or g.expires_at>now());
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path='' as $$
 -- Legacy policies sometimes use is_staff for writes. A read-only custom role
 -- must never inherit those writes from tickets.read alone.
 select public.has_support_permission('tickets.read') and public.has_support_permission('tickets.write');
$$;
create or replace function public.can_work_ticket(p_ticket_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tickets t where t.id=p_ticket_id
 and public.has_resource_permission('tickets.write',t.organization_id,t.project_id));
$$;
create or replace function public.can_view_ticket(p_ticket_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tickets t where t.id=p_ticket_id and (
 public.has_resource_permission('tickets.read',t.organization_id,t.project_id)
 or (public.current_app_role()='customer' and t.requester_id=auth.uid()
 and (t.organization_id is null or t.organization_id=public.current_organization_id()))
 or (public.is_org_contact() and t.organization_id=public.current_organization_id())));
$$;
drop policy tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated using(
 public.has_resource_permission('tickets.read',organization_id,project_id)
 or (public.current_app_role()='customer' and requester_id=auth.uid()
 and (organization_id is null or organization_id=public.current_organization_id()))
 or (public.is_org_contact() and organization_id=public.current_organization_id()));
create policy tickets_project_insert on public.tickets for insert to authenticated with check(
 public.has_resource_permission('tickets.write',organization_id,project_id));
create policy tickets_project_update on public.tickets for update to authenticated
 using(public.has_resource_permission('tickets.write',organization_id,project_id))
 with check(public.has_resource_permission('tickets.write',organization_id,project_id));
create policy tickets_write_bound on public.tickets as restrictive for update to authenticated
 using(public.has_resource_permission('tickets.write',organization_id,project_id))
 with check(public.has_resource_permission('tickets.write',organization_id,project_id));
create or replace function public.can_view_infrastructure(p_organization_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_organization_id is not null and public.has_support_permission('infrastructure.read',p_organization_id);
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select public.has_support_permission('organizations.manage');
$$;
create or replace function public.is_support_super_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(public.current_aal()='aal2',false) and public.session_is_live() and exists(
 select 1 from public.active_support_grants(auth.uid()) g
 where g.role_key='BERRYIT_SUPPORT_SUPER_ADMIN' and g.scope='global');
$$;
create or replace function public.protect_profile_privileges() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.role()='service_role' or (auth.uid() is null and auth.role() is null
   and session_user not in ('anon','authenticated','authenticator')
   and coalesce(current_setting('role',true),'') not in ('anon','authenticated','authenticator')) then return new; end if;
 -- Even an ordinary ADMIN must use dedicated audited operations, never a profile PATCH.
 new.role:=old.role; new.organization_id:=old.organization_id; new.is_org_admin:=old.is_org_admin;
 if new.is_active is distinct from old.is_active and berryit_private.can_manage_user(old.id) is not true then
   raise exception 'Kontoadministration nekad' using errcode='42501'; end if;
 new.is_machine:=old.is_machine;
 new.login_activation_pending:=old.login_activation_pending; new.registered_by:=old.registered_by;
 return new;
end;
$$;
create or replace function berryit_private.technician_eligible(p_user uuid,p_org uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.support_role_grants g
 join public.profiles p on p.id=g.grantee_id and p.is_active and not p.login_activation_pending
 join public.support_roles r on r.key=g.role_key and r.is_active
 join public.support_role_permissions rp on rp.role_key=r.key and rp.permission_key='tickets.write'
 where g.grantee_id=p_user and g.revoked_at is null
 and (g.expires_at is null or g.expires_at>now()) and (g.scope='global' or g.organization_id=p_org));
$$;
create function berryit_private.technician_for_project(p_user uuid,p_org uuid,p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.support_role_grants g
 join public.profiles p on p.id=g.grantee_id and p.is_active and not p.login_activation_pending
 join public.support_roles r on r.key=g.role_key and r.is_active
 join public.support_role_permissions rp on rp.role_key=r.key and rp.permission_key='tickets.write'
 where g.grantee_id=p_user and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
 and (g.scope='global' or (g.organization_id=p_org and (g.project_id is null or g.project_id=p_project))));
$$;
create function public.guard_ticket_project_access() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null and (auth.role()='service_role' or (auth.role() is null and
 coalesce(current_setting('role',true),'') not in ('anon','authenticated','authenticator'))) then return new; end if;
 if tg_op='INSERT' and new.project_id is not null and not public.has_resource_permission('tickets.write',new.organization_id,new.project_id) then
 raise exception 'Projektkopplat ärende kräver rätt uppdrag' using errcode='42501'; end if;
 if tg_op='UPDATE' then
   if new.project_id is distinct from old.project_id and (not public.has_support_permission('tickets.reassign',old.organization_id)
   or not public.has_resource_permission('projects.manage',new.organization_id,new.project_id)
   or not public.has_resource_permission('projects.manage',old.organization_id,old.project_id)) then
   raise exception 'Ärendets projektscope får inte flyttas' using errcode='42501'; end if;
   if new.assignee_id is distinct from old.assignee_id and not public.has_resource_permission('tickets.reassign',new.organization_id,new.project_id) then
   raise exception 'Tilldelningsrättighet krävs' using errcode='42501'; end if;
 end if;
 if new.assignee_id is not null and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id or new.project_id is distinct from old.project_id)
 and not berryit_private.technician_for_project(new.assignee_id,new.organization_id,new.project_id) then
 raise exception 'Teknikern saknar uppdrag i ärendets projekt' using errcode='42501'; end if;
 return new;
end;
$$;
create trigger tickets_a_project_access before insert or update on public.tickets for each row execute function public.guard_ticket_project_access();
revoke all on function public.guard_ticket_project_access() from public,anon,authenticated;
create or replace function public.support_ticket_technicians(p_ticket_id uuid)
returns table(id uuid,label text,is_external boolean,expires_at timestamptz)
language sql stable security definer set search_path='' as $$
 select p.id,coalesce(nullif(p.full_name,''),p.email,'Tekniker'),
 exists(select 1 from public.support_role_grants g where g.grantee_id=p.id and g.is_external_consultant
 and g.organization_id=t.organization_id and (g.project_id is null or g.project_id=t.project_id) and g.revoked_at is null and g.expires_at>now()),
 (select max(g.expires_at) from public.support_role_grants g where g.grantee_id=p.id and g.is_external_consultant
 and g.organization_id=t.organization_id and (g.project_id is null or g.project_id=t.project_id) and g.revoked_at is null and g.expires_at>now())
 from public.tickets t cross join public.profiles p where t.id=p_ticket_id and public.can_work_ticket(t.id)
 and berryit_private.technician_for_project(p.id,t.organization_id,t.project_id) order by 2,p.id;
$$;
create policy project_support_contacts on public.profiles for select to authenticated using(
 role='customer' and organization_id is not null and exists(select 1 from public.support_role_grants g
 where g.grantee_id=auth.uid() and g.organization_id=profiles.organization_id and g.project_id is not null
 and public.has_resource_permission('tickets.write',g.organization_id,g.project_id)));
create or replace function berryit_private.registration_admin(p_actor uuid,p_session uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.sessions s on s.user_id=p.id
 join public.support_role_grants g on g.grantee_id=p.id
 join public.support_roles r on r.key=g.role_key and r.is_active
 join public.support_role_permissions rp on rp.role_key=r.key and rp.permission_key='organizations.manage'
 where p.id=p_actor and p.is_active and not p.is_machine and not p.login_activation_pending
 and s.id=p_session and s.aal::text='aal2' and (s.not_after is null or s.not_after>now())
 and g.scope='global' and g.revoked_at is null and (g.expires_at is null or g.expires_at>now()));
$$;

create function public.can_view_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.support_projects p where p.id=p_project_id and (
 public.has_resource_permission('projects.read',p.organization_id,p.id)
 or public.has_resource_permission('projects.manage',p.organization_id,p.id)));
$$;
-- Restrictive policies also constrain historical permissive policies.
create policy projects_bound on public.support_projects as restrictive for select to authenticated
 using(public.has_resource_permission('projects.read',organization_id,id)
 or public.has_resource_permission('projects.manage',organization_id,id));
create policy projects_explicit_read on public.support_projects for select to authenticated
 using(public.can_view_project(id));
revoke insert,update,delete on public.support_projects from authenticated;
create policy services_project_bound on public.infra_services as restrictive for select to authenticated
 using(public.has_support_permission('infrastructure.read',organization_id) or public.can_view_project(project_id));
create policy services_project_read on public.infra_services for select to authenticated
 using(public.can_view_project(project_id));
create policy organizations_project_read on public.organizations for select to authenticated using(
 exists(select 1 from public.support_role_grants g join public.support_roles r on r.key=g.role_key and r.is_active
 join public.profiles u on u.id=g.grantee_id and u.is_active and not u.login_activation_pending
 where g.grantee_id=auth.uid() and g.organization_id=organizations.id and g.revoked_at is null
 and (g.expires_at is null or g.expires_at>now())));

create function berryit_private.access_audit(p_action text,p_type text,p_id text,p_org uuid,p_reason text,p_metadata jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
begin
 if length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Ange orsak (3–1000 tecken)' using errcode='22023'; end if;
 insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
 values(auth.uid(),p_action,p_type,p_id,case when p_org is null then 'global'::public.support_scope else 'organization'::public.support_scope end,p_org,p_reason,p_metadata);
end;
$$;

create function public.save_support_project(p_id uuid,p_organization_id uuid,p_values jsonb,p_reason text,p_revision bigint default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare x public.support_projects; contact uuid;
begin
 if not public.has_resource_permission('projects.manage',p_organization_id,p_id) then raise exception 'Projektadministration nekad' using errcode='42501'; end if;
 if not exists(select 1 from public.organizations where id=p_organization_id) then raise exception 'Okänd organisation' using errcode='22023'; end if;
 if jsonb_typeof(p_values)<>'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in
 ('name','description','status','environment','website_url','repository_url','contact_id','archived','source')) then raise exception 'Okända projektfält' using errcode='22023'; end if;
 contact:=nullif(p_values->>'contact_id','')::uuid;
 if contact is not null and not exists(select 1 from public.profiles u where u.id=contact and u.is_active and
   (u.organization_id=p_organization_id or berryit_private.technician_eligible(u.id,p_organization_id))) then
   raise exception 'Kontakt saknar rätt organisation/uppdrag' using errcode='42501'; end if;
 if p_id is null then
   if coalesce(p_values->>'source','manual') not in ('manual','berryit') then raise exception 'Använd upptäcktskontraktet' using errcode='22023'; end if;
   insert into public.support_projects(organization_id,name,description,status,environment,website_url,repository_url,contact_id,created_by,source)
   values(p_organization_id,p_values->>'name',coalesce(p_values->>'description',''),coalesce(p_values->>'status','active'),
   coalesce(p_values->>'environment','development'),nullif(p_values->>'website_url',''),nullif(p_values->>'repository_url',''),contact,auth.uid(),coalesce(p_values->>'source','manual')) returning * into x;
 else
   select * into x from public.support_projects where id=p_id and organization_id=p_organization_id for update;
   if not found or x.revision is distinct from p_revision then raise exception 'Projektet saknas eller har ändrats; läs om' using errcode='40001'; end if;
   update public.support_projects set name=coalesce(p_values->>'name',name),description=coalesce(p_values->>'description',description),
     status=coalesce(p_values->>'status',status),environment=coalesce(p_values->>'environment',environment),
     website_url=case when p_values?'website_url' then nullif(p_values->>'website_url','') else website_url end,
     repository_url=case when p_values?'repository_url' then nullif(p_values->>'repository_url','') else repository_url end,
     contact_id=case when p_values?'contact_id' then contact else contact_id end,
     archived_at=case when p_values?'archived' then case when (p_values->>'archived')::boolean then now() else null end else archived_at end,
     revision=revision+1 where id=p_id returning * into x;
 end if;
 perform berryit_private.access_audit(case when p_id is null then 'project.created' when x.archived_at is not null then 'project.archived' else 'project.updated' end,
   'project',x.id::text,x.organization_id,p_reason,jsonb_build_object('revision',x.revision));
 return x.id;
end;
$$;

-- Central delegation rule: actual caller, current database grants, real MFA,
-- permission subset in EXACT target scope, strictly lower rank, never owner.
create function berryit_private.can_delegate(p_role text,p_org uuid,p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.current_aal()='aal2' and public.session_is_live()
 and public.has_resource_permission('roles.grant',p_org,p_project)
 and exists(select 1 from public.support_roles r where r.key=p_role
   and r.key<>'BERRYIT_SUPPORT_SUPER_ADMIN' and r.rank<(select coalesce(max(ar.rank),0)
     from public.support_role_grants ag join public.support_roles ar on ar.key=ag.role_key and ar.is_active
     where ag.grantee_id=auth.uid() and ag.revoked_at is null and (ag.expires_at is null or ag.expires_at>now())
     and (ar.organization_id is null or ar.organization_id=p_org)
     and (ag.scope='global' or (ag.organization_id=p_org and (ag.project_id is null or ag.project_id=p_project))))
   and (r.organization_id is null or r.organization_id=p_org)
   and not exists(select 1 from public.support_role_permissions rp where rp.role_key=r.key
     and not public.has_resource_permission(rp.permission_key,p_org,p_project)));
$$;
create or replace function public.guard_support_role_grant() returns trigger
language plpgsql security definer set search_path='' as $$
declare role_org uuid;
begin
 select organization_id into role_org from public.support_roles where key=new.role_key;
 if role_org is not null and role_org is distinct from new.organization_id then
 raise exception 'Rollmall och grant tillhör olika organisationer' using errcode='42501'; end if;
 if auth.role()='service_role' or (auth.uid() is null and auth.role() is null
   and session_user not in ('anon','authenticated','authenticator') and
   coalesce(current_setting('role',true),'') not in ('anon','authenticated','authenticator')) then return new; end if;
 if tg_op='INSERT' then
   perform 1 from public.support_roles where key=new.role_key for update;
   if new.grantee_id=auth.uid() or new.granted_by is distinct from auth.uid()
   or not exists(select 1 from public.support_roles where key=new.role_key and is_active)
   or berryit_private.can_delegate(new.role_key,new.organization_id,new.project_id) is not true then
     raise exception 'Otillåten rolldelegering' using errcode='42501'; end if;
 else
   if (to_jsonb(new)-array['revoked_at','revoked_by','revoke_reason']) is distinct from
      (to_jsonb(old)-array['revoked_at','revoked_by','revoke_reason']) or old.revoked_at is not null
      or new.revoked_at is null or new.revoked_by is distinct from auth.uid()
      or old.grantee_id=auth.uid() or berryit_private.can_delegate(old.role_key,old.organization_id,old.project_id) is not true then
     raise exception 'Otillåten återkallelse eller ändring av grant' using errcode='42501'; end if;
 end if;
 if not exists(select 1 from public.profiles p where p.id=new.grantee_id and p.is_active and not p.login_activation_pending) then
 raise exception 'Användaren är inte aktiv' using errcode='42501'; end if;
 return new;
end;
$$;

create function public.grant_support_role(p_user uuid,p_role text,p_org uuid,p_project uuid,p_expires timestamptz,p_reason text,
 p_external boolean default false,p_company text default null,p_commissioner uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if berryit_private.can_delegate(p_role,p_org,p_project) is not true then raise exception 'Rolldelegering nekad' using errcode='42501'; end if;
 insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,project_id,expires_at,reason,granted_by,
 is_external_consultant,consultant_company,commissioning_organization_id)
 values(p_user,p_role,case when p_org is null then 'global'::public.support_scope else 'organization'::public.support_scope end,
 p_org,p_project,p_expires,p_reason,auth.uid(),p_external,p_company,p_commissioner) returning id into result;
 return result;
end;
$$;
create function public.revoke_support_role(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.support_role_grants set revoked_at=now(),revoked_by=auth.uid(),revoke_reason=p_reason where id=p_id and revoked_at is null;
 if not found then raise exception 'Tilldelningen saknas/återkallad' using errcode='22023'; end if;
end;
$$;
create or replace function public.audit_support_role_grant() returns trigger
language plpgsql security definer set search_path='' as $$
declare verb text;
begin
 if tg_op='INSERT' then verb:='role.granted';
 elsif old.revoked_at is null and new.revoked_at is not null then verb:='role.revoked';
 else return new; end if;
 update public.support_roles set assignment_revision=assignment_revision+1 where key=new.role_key;
 insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
 values(case when tg_op='INSERT' then coalesce(new.granted_by,auth.uid()) else coalesce(new.revoked_by,auth.uid()) end,
 verb,'profile',new.grantee_id::text,new.scope,new.organization_id,
 case when tg_op='INSERT' then new.reason else new.revoke_reason end,
 jsonb_build_object('grant_id',new.id,'role_key',new.role_key,'project_id',new.project_id,'expires_at',new.expires_at));
 if new.project_id is not null then
 insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
 values(auth.uid(),'project.access_changed','project',new.project_id::text,new.scope,new.organization_id,
 case when tg_op='INSERT' then new.reason else new.revoke_reason end,
 jsonb_build_object('grant_id',new.id,'user_id',new.grantee_id,'change',verb));
 end if;
 return new;
end;
$$;

create function public.support_role_impact(p_role text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; org uuid;
begin
 select organization_id into org from public.support_roles where key=p_role;
 if not found or not public.has_resource_permission('roles.manage',org) then raise exception 'Rolladministration nekad' using errcode='42501'; end if;
 if exists(select 1 from public.support_role_grants g where g.role_key=p_role and g.revoked_at is null
 and (g.expires_at is null or g.expires_at>now()) and not public.has_resource_permission('roles.manage',g.organization_id,g.project_id)) then
 raise exception 'Berörda användare ligger utanför scope' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('grant_id',g.id,'user_id',g.grantee_id,'organization_id',g.organization_id,'project_id',g.project_id) order by g.id),'[]') into result
 from public.support_role_grants g where g.role_key=p_role and g.revoked_at is null and (g.expires_at is null or g.expires_at>now());
 return jsonb_build_object('assignments',result,'fingerprint',md5((select assignment_revision::text from public.support_roles where key=p_role)||':'||result::text));
end;
$$;
create function public.save_support_role(p_key text,p_label text,p_description text,p_permissions text[],p_org uuid,p_active boolean,
 p_reason text,p_revision bigint default null,p_impact text default null)
returns text language plpgsql security definer set search_path='' as $$
declare r public.support_roles; permission text; impact jsonb; target record; key_value text;
begin
 if public.has_resource_permission('roles.manage',p_org) is not true or public.current_aal()<>'aal2' or not public.session_is_live() then
 raise exception 'Rolladministration kräver delegerad rättighet och MFA' using errcode='42501'; end if;
 if length(btrim(p_label)) not between 2 and 120 or length(coalesce(p_description,''))>2000 or p_permissions is null then
 raise exception 'Ogiltig roll' using errcode='22023'; end if;
 -- Serialize edits AND grants to this role: prevents an unreviewed concurrent recipient.
 if p_key is not null then
   select * into r from public.support_roles where key=p_key for update;
   if not found or r.is_system or r.organization_id is distinct from p_org or r.revision is distinct from p_revision then
   raise exception 'Skyddad roll eller föråldrad revision' using errcode='42501'; end if;
   impact:=public.support_role_impact(p_key);
   -- Use the locked row's assignment version, including a grant committed while
   -- this request waited for the row lock. No stale statement snapshot can
   -- approve an unreviewed concurrent recipient.
   if md5(r.assignment_revision::text||':'||(impact->'assignments')::text) is distinct from p_impact then raise exception 'Tilldelningar har ändrats; förhandsgranska igen' using errcode='40001'; end if;
 end if;
 foreach permission in array p_permissions loop
   if not exists(select 1 from public.support_permissions where key=permission)
   or public.has_resource_permission(permission,p_org) is not true then raise exception 'Okänd eller ej delegerbar permission' using errcode='42501'; end if;
   for target in select * from public.support_role_grants where role_key=p_key and revoked_at is null and (expires_at is null or expires_at>now()) loop
     if not public.has_resource_permission(permission,target.organization_id,target.project_id) then raise exception 'Rolländring överskrider scope' using errcode='42501'; end if;
     if target.is_external_consultant and permission in ('roles.manage','roles.grant','users.manage','organizations.manage','technicians.manage','escalation.configure') then
       raise exception 'Konsultroll får inte ändras till personaladministration' using errcode='42501'; end if;
   end loop;
 end loop;
 if p_key is null then
   key_value:='CUSTOM_'||upper(replace(gen_random_uuid()::text,'-',''));
   insert into public.support_roles(key,label,rank,is_system,description,organization_id,is_active)
   values(key_value,btrim(p_label),1,false,coalesce(p_description,''),p_org,p_active);
 else
   key_value:=p_key;
   update public.support_roles set label=btrim(p_label),description=coalesce(p_description,''),is_active=p_active,revision=revision+1 where key=key_value;
   delete from public.support_role_permissions where role_key=key_value;
 end if;
 insert into public.support_role_permissions(role_key,permission_key) select key_value,k from unnest(p_permissions) k group by k;
 perform berryit_private.access_audit('role.definition_saved','role',key_value,p_org,p_reason,jsonb_build_object('active',p_active,'permissions',p_permissions));
 return key_value;
end;
$$;

create table public.project_external_identities(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),
 project_id uuid not null,provider text not null check(provider in ('github','vercel')),
 external_id text not null check(length(external_id) between 1 and 200),
 integration_id uuid not null,created_at timestamptz not null default now(),
 unique(provider,external_id),foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict,
 foreign key(integration_id,organization_id) references public.connector_integrations(id,organization_id) on delete restrict);
alter table public.project_external_identities enable row level security;
revoke all on public.project_external_identities from public,anon,authenticated;
grant select on public.project_external_identities to authenticated;
grant all on public.project_external_identities to service_role;
create policy project_identities_read on public.project_external_identities for select to authenticated using(public.can_view_project(project_id));

-- Project documentation, not repository writes. Raw code proposals are NOT
-- placed in the audit log; only the note ID is logged there.
create table public.repository_review_notes(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,
 project_id uuid not null,author_id uuid not null references public.profiles(id),
 body text not null check(length(btrim(body)) between 1 and 20000),created_at timestamptz not null default now(),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict);
alter table public.repository_review_notes enable row level security;
revoke all on public.repository_review_notes from public,anon,authenticated;
grant select on public.repository_review_notes to authenticated;
grant all on public.repository_review_notes to service_role;
create policy repository_reviews_read on public.repository_review_notes for select to authenticated using(
 public.has_resource_permission('repositories.read',organization_id,project_id));
create function public.save_repository_review(p_project uuid,p_body text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid; result uuid;
begin
 select organization_id into org from public.support_projects where id=p_project and archived_at is null;
 if not found or not public.has_resource_permission('repositories.review',org,p_project)
 or not public.has_resource_permission('repositories.read',org,p_project) then
 raise exception 'Kodförslag kräver aktuellt projektuppdrag' using errcode='42501'; end if;
 insert into public.repository_review_notes(organization_id,project_id,author_id,body)
 values(org,p_project,auth.uid(),p_body) returning id into result;
 perform berryit_private.access_audit('repository.review_recorded','project',p_project::text,org,p_reason,jsonb_build_object('review_id',result));
 return result;
end;
$$;
revoke all on function public.save_repository_review(uuid,text,text) from public,anon;
grant execute on function public.save_repository_review(uuid,text,text) to authenticated;

create function public.link_project_resource(p_project uuid,p_kind text,p_resource uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.support_projects where id=p_project;
 if not found or not public.has_resource_permission('projects.manage',org,p_project)
 or not public.has_resource_permission('connectors.manage',org,p_project) then raise exception 'Projektkoppling nekad' using errcode='42501'; end if;
 if p_kind='service' then
   update public.infra_services set project_id=p_project where id=p_resource and organization_id=org
   and public.has_resource_permission('connectors.manage',organization_id,project_id)
   and public.has_resource_permission('projects.manage',organization_id,project_id);
 elsif p_kind='integration' then
   update public.connector_integrations set project_id=p_project,scope_kind='project' where id=p_resource and organization_id=org and scope_kind in ('project','organization')
   and public.has_resource_permission('connectors.manage',organization_id,project_id)
   and public.has_resource_permission('projects.manage',organization_id,project_id);
 elsif p_kind='ticket' then
   update public.tickets set project_id=p_project where id=p_resource and organization_id=org
   and public.has_support_permission('tickets.reassign',organization_id)
   and public.has_resource_permission('projects.manage',organization_id,project_id);
 else raise exception 'Okänd koppling' using errcode='22023'; end if;
 if not found then raise exception 'Resursen saknas eller har fel tenant/scope' using errcode='42501'; end if;
 perform berryit_private.access_audit('project.resource_linked','project',p_project::text,org,p_reason,jsonb_build_object('kind',p_kind,'resource_id',p_resource));
end;
$$;

-- A connector may reconcile identities, never change manually maintained fields
-- or create roles/grants. Provider IDs must be pinned in an approved integration.
create function public.reconcile_discovered_project(p_integration uuid,p_external_id text,p_name text,p_description text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare i public.connector_integrations; x uuid; existing_org uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Serverconnector krävs' using errcode='42501'; end if;
 select * into i from public.connector_integrations where id=p_integration for update;
 if not found or i.connector_key not in ('github','vercel') or not i.is_enabled or i.access_mode<>'read_only'
 or i.config->>'provider_project_id' is distinct from p_external_id or p_external_id is null then
 raise exception 'Verifierad/pinnad provideridentitet saknas' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(i.connector_key||':'||p_external_id,0));
 select project_id,organization_id into x,existing_org from public.project_external_identities
 where provider=i.connector_key and external_id=p_external_id;
 if found then
   if existing_org<>i.organization_id then raise exception 'Extern identitet är redan kopplad' using errcode='42501'; end if;
   return x;
 end if;
 x:=i.project_id;
 if x is null then
   if i.created_by is null then raise exception 'Registreringsansvarig saknas' using errcode='42501'; end if;
   insert into public.support_projects(organization_id,name,description,created_by,source)
   values(i.organization_id,p_name,p_description,i.created_by,i.connector_key) returning id into x;
 end if;
 insert into public.project_external_identities(organization_id,project_id,provider,external_id,integration_id)
 values(i.organization_id,x,i.connector_key,p_external_id,i.id);
 perform berryit_private.access_audit('project.discovered','project',x::text,i.organization_id,
 'Verifierad connectoridentitet',jsonb_build_object('provider',i.connector_key,'integration_id',i.id));
 return x;
end;
$$;
revoke all on function public.reconcile_discovered_project(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_discovered_project(uuid,text,text,text) to service_role;

create function public.unlink_project_identity(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare identity_row public.project_external_identities;
begin
 select * into identity_row from public.project_external_identities where id=p_id for update;
 if not found or not public.has_resource_permission('projects.manage',identity_row.organization_id,identity_row.project_id)
 or not public.has_resource_permission('connectors.manage',identity_row.organization_id,identity_row.project_id) then
 raise exception 'Extern projektkoppling nekad' using errcode='42501'; end if;
 delete from public.project_external_identities where id=p_id;
 perform berryit_private.access_audit('project.identity_unlinked','project',identity_row.project_id::text,identity_row.organization_id,
 p_reason,jsonb_build_object('identity_id',p_id,'provider',identity_row.provider));
end;
$$;

create function public.project_access_details(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_view_project(p_project) then raise exception 'Projektåtkomst nekad' using errcode='42501'; end if;
 return jsonb_build_object(
 'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'user_id',g.grantee_id,'name',p.full_name,
   'role',r.label,'expires_at',g.expires_at,'project_id',g.project_id))
   from public.support_projects x join public.support_role_grants g on g.organization_id=x.organization_id or g.scope='global'
   join public.support_roles r on r.key=g.role_key and r.is_active join public.profiles p on p.id=g.grantee_id and p.is_active
   where x.id=p_project and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
   and (g.project_id is null or g.project_id=x.id)
   and exists(select 1 from public.support_role_permissions rp where rp.role_key=r.key and rp.permission_key in ('projects.read','projects.manage','repositories.read'))),'[]'),
 'reviews',coalesce((select jsonb_agg(to_jsonb(notes)) from (
   select n.id,n.author_id,n.body,n.created_at from public.repository_review_notes n where n.project_id=p_project
   and public.has_resource_permission('repositories.read',n.organization_id,n.project_id) order by n.created_at,n.id) notes),'[]'),
 'activity',coalesce((select jsonb_agg(to_jsonb(events)) from (
   select action,actor_id,created_at,reason from public.support_admin_audit where target_type='project' and target_id=p_project::text
   order by id desc limit 100) events),'[]'));
end;
$$;

create function public.access_administration_directory(p_org uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_resource_permission('roles.grant',p_org) and not public.has_resource_permission('projects.manage',p_org) then
 raise exception 'Administrationsregister nekas' using errcode='42501'; end if;
 return jsonb_build_object('users',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name,'email',p.email,'is_active',p.is_active))
 from public.profiles p where public.has_support_permission('roles.grant') or p_org is null or p.organization_id=p_org or exists(
 select 1 from public.support_role_grants g where g.grantee_id=p.id and g.organization_id=p_org)),'[]'));
end;
$$;

create function berryit_private.can_manage_user(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_user<>auth.uid() and exists(select 1 from public.profiles p where p.id=p_user
 and public.has_support_permission('users.manage',p.organization_id))
 and not exists(select 1 from public.support_role_grants g where g.grantee_id=p_user and g.revoked_at is null
 and (g.role_key='BERRYIT_SUPPORT_SUPER_ADMIN' or not public.has_resource_permission('users.manage',g.organization_id,g.project_id)));
$$;
create function public.set_support_user_active(p_user uuid,p_active boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 if berryit_private.can_manage_user(p_user) is not true then
 raise exception 'Kontoadministration nekad' using errcode='42501'; end if;
 update public.profiles set is_active=p_active where id=p_user returning organization_id into org;
 perform berryit_private.access_audit('user.active_changed','profile',p_user::text,org,p_reason,jsonb_build_object('is_active',p_active));
end;
$$;

create function public.create_project_service(p_project uuid,p_name text,p_node uuid,p_kind text,p_environment text,p_url text,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare org uuid; result uuid;
begin
 select organization_id into org from public.support_projects where id=p_project;
 if not found or not public.has_resource_permission('projects.manage',org,p_project)
 or not public.has_resource_permission('connectors.manage',org,p_project) then raise exception 'Tjänsteadministration nekad' using errcode='42501'; end if;
 insert into public.infra_services(organization_id,project_id,node_id,name,service_kind,environment,url)
 values(org,p_project,p_node,p_name,p_kind,p_environment,p_url) returning id into result;
 perform berryit_private.access_audit('project.service_created','project',p_project::text,org,p_reason,jsonb_build_object('service_id',result,'node_id',p_node));
 return result;
end;
$$;
revoke all on function public.create_project_service(uuid,text,uuid,text,text,text,text) from public,anon;
grant execute on function public.create_project_service(uuid,text,uuid,text,text,text,text) to authenticated;

create function public.repository_read_context(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare x public.support_projects; i public.connector_integrations;
begin
 select * into x from public.support_projects where id=p_project;
 if not found or not public.has_resource_permission('repositories.read',x.organization_id,x.id) then
 raise exception 'Repositoryåtkomst nekad' using errcode='42501'; end if;
 select * into i from public.connector_integrations where project_id=x.id and organization_id=x.organization_id
 and connector_key='github' and is_enabled and access_mode='read_only' order by id limit 1;
 if not found or i.secret_ref is null or i.config->>'repository' is null or i.config->>'provider_project_id' is null then
 raise exception 'Repository saknar godkänd läsanslutning' using errcode='22023'; end if;
 return jsonb_build_object('repository',i.config->>'repository','provider_id',i.config->>'provider_project_id',
 'secret_ref',i.secret_ref,'integration_id',i.id);
end;
$$;
revoke all on function public.repository_read_context(uuid) from public,anon;
grant execute on function public.repository_read_context(uuid) to authenticated;

-- Preserve project service-health presentation without exposing whole node
-- inventories or provider detail payloads to project-only readers.
create function public.project_registry_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(latest)),'[]') from (
 select distinct on(c.service_id) c.service_id,c.status_key,c.checked_at,c.source
 from public.service_status_checks c join public.infra_services s on s.id=c.service_id and s.organization_id=c.organization_id
 where public.can_view_project(s.project_id) or public.has_support_permission('infrastructure.read',s.organization_id)
 order by c.service_id,c.checked_at desc,c.id desc) latest;
$$;
revoke all on function public.project_registry_status() from public,anon;
grant execute on function public.project_registry_status() to authenticated;

create function public.support_access_context() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('isStaff',public.is_staff() or public.has_support_permission('projects.read') or exists(
 select 1 from public.support_role_grants g join public.support_roles r on r.key=g.role_key and r.is_active
 join public.profiles u on u.id=g.grantee_id and u.is_active and not u.login_activation_pending
 where g.grantee_id=auth.uid() and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())),
 'isSuperAdmin',coalesce(public.is_support_super_admin(),false),
 'accountActive',exists(select 1 from public.profiles u where u.id=auth.uid() and u.is_active and not u.login_activation_pending),
 'requiresMfa',exists(select 1 from public.support_role_grants g join public.support_roles r on r.key=g.role_key and r.is_active
 join public.support_role_permissions rp on rp.role_key=r.key join public.support_permissions p on p.key=rp.permission_key and p.requires_mfa
 join public.profiles u on u.id=g.grantee_id and u.is_active and not u.login_activation_pending
 where g.grantee_id=auth.uid() and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())),
 'roles',coalesce((select jsonb_agg(distinct r.label) from public.support_role_grants g
 join public.support_roles r on r.key=g.role_key and r.is_active
 where g.grantee_id=auth.uid() and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())),'[]'),
 'permissions',coalesce((select jsonb_agg(distinct rp.permission_key) from public.support_role_grants g
 join public.support_roles r on r.key=g.role_key and r.is_active
 join public.support_role_permissions rp on rp.role_key=r.key
 where g.grantee_id=auth.uid() and public.has_resource_permission(rp.permission_key,g.organization_id,g.project_id)
 and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())),'[]'));
$$;

-- Catalog is data, never a client-controlled permission source.
revoke insert,update,delete on public.support_roles,public.support_permissions,public.support_role_permissions from public,anon,authenticated;
create policy roles_authenticated_read on public.support_roles for select to authenticated using(
 (public.support_access_context()->>'isStaff')::boolean and (organization_id is null or public.has_resource_permission('roles.manage',organization_id) or exists(
 select 1 from public.support_role_grants g where g.grantee_id=auth.uid() and g.role_key=key)));
create policy permissions_authenticated_read on public.support_permissions for select to authenticated using((public.support_access_context()->>'isStaff')::boolean);
create policy role_permissions_authenticated_read on public.support_role_permissions for select to authenticated using(
 exists(select 1 from public.support_roles r where r.key=role_key));
drop policy support_role_grants_select on public.support_role_grants;
create policy support_role_grants_select on public.support_role_grants for select to authenticated using(
 grantee_id=auth.uid() or public.has_resource_permission('roles.grant',organization_id,project_id));
create policy access_audit_scoped_read on public.support_admin_audit for select to authenticated using(
 public.has_resource_permission('audit.read',organization_id));

-- Explicit minimum EXECUTE: no PUBLIC or anonymous access to added entry points.
-- Application entry point keeps denial audit OUTSIDE the failed subtransaction.
-- Direct SQL/RPC calls remain protected; their raised exceptions belong in the
-- PostgreSQL/API security logs (a rolled-back transaction cannot retain a row).
create function public.perform_access_request(p_operation text,p_args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then
 raise exception 'Autentiserad identitet krävs' using errcode='42501'; end if;
 begin
 case p_operation
 when 'save_support_project' then result:=to_jsonb(public.save_support_project((p_args->>'p_id')::uuid,(p_args->>'p_organization_id')::uuid,p_args->'p_values',p_args->>'p_reason',(p_args->>'p_revision')::bigint));
 when 'save_support_role' then result:=to_jsonb(public.save_support_role(p_args->>'p_key',p_args->>'p_label',p_args->>'p_description',array(select jsonb_array_elements_text(p_args->'p_permissions')),(p_args->>'p_org')::uuid,(p_args->>'p_active')::boolean,p_args->>'p_reason',(p_args->>'p_revision')::bigint,p_args->>'p_impact'));
 when 'grant_support_role' then result:=to_jsonb(public.grant_support_role((p_args->>'p_user')::uuid,p_args->>'p_role',(p_args->>'p_org')::uuid,(p_args->>'p_project')::uuid,(p_args->>'p_expires')::timestamptz,p_args->>'p_reason',(p_args->>'p_external')::boolean,p_args->>'p_company',(p_args->>'p_commissioner')::uuid));
 when 'revoke_support_role' then perform public.revoke_support_role((p_args->>'p_id')::uuid,p_args->>'p_reason');
 when 'link_project_resource' then perform public.link_project_resource((p_args->>'p_project')::uuid,p_args->>'p_kind',(p_args->>'p_resource')::uuid,p_args->>'p_reason');
 when 'unlink_project_identity' then perform public.unlink_project_identity((p_args->>'p_id')::uuid,p_args->>'p_reason');
 when 'set_support_user_active' then perform public.set_support_user_active((p_args->>'p_user')::uuid,(p_args->>'p_active')::boolean,p_args->>'p_reason');
 when 'create_project_service' then result:=to_jsonb(public.create_project_service((p_args->>'p_project')::uuid,p_args->>'p_name',(p_args->>'p_node')::uuid,p_args->>'p_kind',p_args->>'p_environment',p_args->>'p_url',p_args->>'p_reason'));
 when 'save_repository_review' then result:=to_jsonb(public.save_repository_review((p_args->>'p_project')::uuid,p_args->>'p_body',p_args->>'p_reason'));
 else raise exception 'Okänd administrativ operation' using errcode='22023';
 end case;
 exception when insufficient_privilege then
   insert into public.support_admin_audit(actor_id,action,target_type,reason,metadata)
   values(auth.uid(),'access.denied','access_request','Backend nekade privilegierad åtgärd',jsonb_build_object('operation',p_operation,'code','42501'));
   return jsonb_build_object('ok',false,'code','42501','error','Backend nekade åtgärden; kontrollera scope, aktuell roll och MFA.');
 end;
 return jsonb_build_object('ok',true,'data',result);
end;
$$;
revoke all on function public.perform_access_request(text,jsonb) from public,anon;
grant execute on function public.perform_access_request(text,jsonb) to authenticated;

revoke all on function public.has_resource_permission(text,uuid,uuid),public.can_view_project(uuid),
 public.save_support_project(uuid,uuid,jsonb,text,bigint),public.grant_support_role(uuid,text,uuid,uuid,timestamptz,text,boolean,text,uuid),
 public.revoke_support_role(uuid,text),public.support_role_impact(text),public.save_support_role(text,text,text,text[],uuid,boolean,text,bigint,text),
 public.link_project_resource(uuid,text,uuid,text),public.support_access_context() from public,anon;
grant execute on function public.has_resource_permission(text,uuid,uuid),public.can_view_project(uuid),
 public.save_support_project(uuid,uuid,jsonb,text,bigint),public.grant_support_role(uuid,text,uuid,uuid,timestamptz,text,boolean,text,uuid),
 public.revoke_support_role(uuid,text),public.support_role_impact(text),public.save_support_role(text,text,text,text[],uuid,boolean,text,bigint,text),
 public.link_project_resource(uuid,text,uuid,text),public.support_access_context() to authenticated;
revoke all on function public.unlink_project_identity(uuid,text),public.project_access_details(uuid),public.access_administration_directory(uuid),public.set_support_user_active(uuid,boolean,text) from public,anon;
grant execute on function public.unlink_project_identity(uuid,text),public.project_access_details(uuid),public.access_administration_directory(uuid),public.set_support_user_active(uuid,boolean,text) to authenticated;
revoke all on all functions in schema berryit_private from public,anon,authenticated;
revoke all on function public.guard_support_role_grant(),public.guard_external_consultant_grant(),
 public.protect_profile_privileges(),public.audit_support_role_grant() from public,anon,authenticated;
revoke all on function public.has_support_permission(text,uuid),public.is_staff(),public.is_admin(),
 public.is_support_super_admin(),public.session_is_live(),public.can_work_ticket(uuid),public.can_view_ticket(uuid),
 public.can_view_infrastructure(uuid),public.support_ticket_technicians(uuid) from public,anon;
grant execute on function public.has_support_permission(text,uuid),public.is_staff(),public.is_admin(),
 public.is_support_super_admin(),public.session_is_live(),public.can_work_ticket(uuid),public.can_view_ticket(uuid),
 public.can_view_infrastructure(uuid),public.support_ticket_technicians(uuid) to authenticated,service_role;

create function public.account_is_active() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and not p.login_activation_pending);
$$;
revoke all on function public.account_is_active() from public,anon;
grant execute on function public.account_is_active() to authenticated;
-- Bound every existing application policy, including self-profile access, by
-- current database account state. SECURITY DEFINER helpers avoid RLS recursion.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='public' and rowsecurity loop
   execute format('create policy active_account_bound on public.%I as restrictive for all to authenticated using(public.account_is_active()) with check(public.account_is_active())',t.tablename);
 end loop;
end $$;
