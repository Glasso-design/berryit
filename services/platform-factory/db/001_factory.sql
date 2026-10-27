-- Standalone LOCAL review migration. Deliberately NOT in BerryIT's production
-- migration chain. Requires its existing project/role/MFA schema, no new users.
begin;
do $$ begin
 if current_setting('factory.install_environment',true) is distinct from 'isolated-test'
 then raise exception 'Factory V1 installation requires the explicit isolated test gate'; end if;
 if to_regprocedure('public.has_resource_permission(text,uuid,uuid)') is null
 then raise exception 'Existing BerryIT project authority is required'; end if;
end $$;
create schema factory;
revoke all on schema factory from public,anon,authenticated;
grant usage on schema factory to authenticated,service_role;

insert into public.support_permissions(key,description,requires_mfa) values
 ('factory.read','Read scoped platform instances and provisioning evidence',true),
 ('factory.create','Request isolated platform creation within an assigned project',true),
 ('factory.manage','Resume jobs and record manual checklist evidence within scope',true),
 ('factory.storage.write','Reserve instance object storage within scope',true)
 on conflict do nothing;
insert into public.support_role_permissions(role_key,permission_key)
 select r.key,p.key from public.support_roles r cross join public.support_permissions p
 where r.key in ('BERRYIT_SUPPORT_ADMIN','BERRYIT_SUPPORT_SUPER_ADMIN') and p.key like 'factory.%'
 on conflict do nothing;

create table factory.adapters(
 product_id text primary key, label text, version text check(version ~ '^[a-f0-9]{40}$'),
 status text not null check(status in ('ADAPTER_IN_DEVELOPMENT','READY_FOR_PROVISIONING','MANUAL_SETUP_REQUIRED','NOT_PROVISIONABLE')),
 template jsonb not null check(jsonb_typeof(template)='array'), provenance jsonb not null,
 live_approved boolean not null default false check(not live_approved)
);
create table factory.instances(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 project_id uuid not null, owner_id uuid not null references public.profiles(id),
 product_id text not null references factory.adapters(product_id), version text not null,
 name text not null, domain text not null unique, region text not null,
 execution_mode text not null default 'MOCK' check(execution_mode='MOCK'),
 quota_bytes bigint not null check(quota_bytes>0 and quota_bytes<=1000000000000),
 used_bytes bigint not null default 0 check(used_bytes>=0), reserved_bytes bigint not null default 0 check(reserved_bytes>=0),
 storage_blocked boolean not null default false, status text not null default 'PROVISIONING',
 created_at timestamptz not null default now(), unique(id,organization_id),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id)
);
create index factory_instances_scope on factory.instances(organization_id,project_id,created_at,id);
create table factory.jobs(
 id uuid primary key default gen_random_uuid(), instance_id uuid not null unique references factory.instances(id),
 organization_id uuid not null, project_id uuid not null, created_by uuid not null references public.profiles(id),
 approved_session_id uuid not null, idempotency_key text not null, input_hash text not null,
 input jsonb not null, state text not null default 'APPROVED' check(state in
 ('DRAFT','PREFLIGHT','APPROVED','PROVISIONING','VERIFYING','READY','BLOCKED','WAITING_FOR_EXTERNAL','RETRYABLE_FAILURE','FAILED','MANUAL_RECOVERY')),
 checklist jsonb not null, lease_token uuid, lease_until timestamptz, revision integer not null default 1,
 last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,idempotency_key), foreign key(instance_id,organization_id) references factory.instances(id,organization_id),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id)
);
create index factory_jobs_queue on factory.jobs(state,lease_until,created_at);
create table factory.resources(
 job_id uuid not null references factory.jobs(id), step text not null, instance_id uuid not null references factory.instances(id),
 provider_id text not null, resource_id text not null, evidence jsonb not null,
 created_at timestamptz not null default now(), primary key(job_id,step), unique(provider_id,resource_id)
);
create table factory.upload_reservations(
 id uuid primary key default gen_random_uuid(), instance_id uuid not null references factory.instances(id),
 upload_key text not null, bytes bigint not null check(bytes>0), status text not null default 'RESERVED'
 check(status in ('RESERVED','COMMITTED','QUARANTINED','CANCELLED')), object_bytes bigint,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(instance_id,upload_key)
);
create table factory.mock_resources(
 idempotency_key text primary key, job_id uuid not null references factory.jobs(id),
 instance_id uuid not null references factory.instances(id), step text not null, data jsonb not null,
 created_at timestamptz not null default now()
);
create table factory.storage_observations(
 instance_id uuid not null references factory.instances(id),observation_id uuid not null,manifest_hash text not null,
 observed_bytes bigint not null check(observed_bytes>=0),observed_at timestamptz not null default now(),primary key(instance_id,observation_id)
);
-- Local verification provider only. No production R2 credentials or buckets.
create table factory.local_objects(
 reservation_id uuid primary key references factory.upload_reservations(id),instance_id uuid not null references factory.instances(id),
 body bytea not null,checksum text not null
);
create function public.factory_local_object(p_instance uuid,p_reservation uuid) returns text
language sql stable security definer set search_path='' as $$
 select encode(o.body,'base64') from factory.local_objects o join factory.instances i on i.id=o.instance_id
 join factory.upload_reservations r on r.id=o.reservation_id and r.instance_id=i.id and r.status='COMMITTED'
 where o.instance_id=p_instance and o.reservation_id=p_reservation and public.has_resource_permission('factory.read',i.organization_id,i.project_id);
$$;
create table factory.operation_requests(
 id uuid primary key default gen_random_uuid(),instance_id uuid not null references factory.instances(id),
 actor_id uuid not null references public.profiles(id),operation text not null check(operation in ('upgrade','suspend','backup','restore','cleanup-review')),
 reason text not null, state text not null default 'WAITING_FOR_APPROVAL' check(state='WAITING_FOR_APPROVAL'),created_at timestamptz not null default now()
);

create function factory.audit(p_job uuid,p_action text,p_detail jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare j factory.jobs;
begin
 select * into strict j from factory.jobs where id=p_job;
 insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
 values(coalesce(auth.uid(),j.created_by),'factory.'||p_action,'factory_job',j.id::text,'organization',j.organization_id,
 'Platform Factory · '||p_action,jsonb_build_object('project_id',j.project_id,'instance_id',j.instance_id,'correlation_id',j.id)||p_detail);
end $$;
revoke all on function factory.audit(uuid,text,jsonb) from public,anon,authenticated;

-- Reuse the EXISTING authority calculation even in a background worker. Only
-- the restricted worker can invoke this helper. All claims come from immutable
-- job/session rows, never from the client, and are restored before returning.
create function factory.initiator_allowed(p_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j factory.jobs; saved text; allowed boolean;
begin
 select * into strict j from factory.jobs where id=p_job;
 if not exists(select 1 from auth.sessions s where s.id=j.approved_session_id and s.user_id=j.created_by
 and s.aal='aal2' and (s.not_after is null or s.not_after>now())) then return false; end if;
 saved:=current_setting('request.jwt.claims',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',j.created_by,'role','authenticated','aal','aal2','session_id',j.approved_session_id)::text,true);
 allowed:=public.has_resource_permission('factory.create',j.organization_id,j.project_id);
 perform set_config('request.jwt.claims',coalesce(saved,''),true);
 return coalesce(allowed,false);
exception when others then
 perform set_config('request.jwt.claims',coalesce(saved,''),true); raise;
end $$;
revoke all on function factory.initiator_allowed(uuid) from public,anon,authenticated;

create function public.factory_create(p_input jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid:=(p_input->>'organizationId')::uuid; project uuid:=(p_input->>'projectId')::uuid;
 owner_id uuid:=(p_input->>'ownerId')::uuid; a factory.adapters; j factory.jobs; instance uuid;
 digest text:=encode(pg_catalog.sha256(convert_to(p_input::text,'UTF8')),'hex'); quota bigint:=(p_input->>'storageQuotaBytes')::bigint;
begin
 if not public.has_resource_permission('factory.create',org,project) then raise exception 'Factory creation denied' using errcode='42501'; end if;
 if not exists(select 1 from public.support_projects where id=project and organization_id=org and archived_at is null)
 then raise exception 'Invalid project scope' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles p where p.id=owner_id and p.is_active and not p.login_activation_pending
 and (p.organization_id=org or p.id=auth.uid())) then raise exception 'Owner identity is not linked to this scope' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid Factory request' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(p_input) x where jsonb_typeof(x.value)='null')
 or exists(select 1 from jsonb_each(p_input) x where x.key not in ('storageQuotaBytes','monthlyBudgetCents','addons') and jsonb_typeof(x.value)<>'string')
 or (select count(*) from jsonb_object_keys(p_input))<>15
 or not(p_input ?& array['productId','version','organizationId','projectId','ownerId','name','customerName','domain','region','accountMode','emailMode','storageQuotaBytes','monthlyBudgetCents','idempotencyKey','addons'])
 or jsonb_typeof(p_input->'addons') is distinct from 'array'
 or length(btrim(p_input->>'name')) not between 2 and 120 or length(btrim(p_input->>'customerName')) not between 2 and 120
 or p_input->>'domain' !~ '^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
 or p_input->>'idempotencyKey' !~ '^[A-Za-z0-9_-]{16,128}$' or quota not between 1 and 1000000000000
 or p_input->>'region' not in ('eu','eea','us')
 or p_input->>'accountMode' not in ('DEDICATED_MANAGED','LIMITED_STANDALONE','MANAGED_RESOURCE_ISOLATION')
 or p_input->>'emailMode' not in ('none','routing','transactional','mailbox')
 or (p_input->>'monthlyBudgetCents')::integer not between 0 and 1000000
 then raise exception 'Invalid Factory request' using errcode='22023'; end if;
 if jsonb_array_length(p_input->'addons')>20 or exists(select 1 from jsonb_array_elements(p_input->'addons') x where jsonb_typeof(x)<>'string')
 or (select count(*) from jsonb_array_elements(p_input->'addons'))<>(select count(distinct value) from jsonb_array_elements(p_input->'addons'))
 then raise exception 'Invalid product add-ons' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(org::text,0));
 select * into j from factory.jobs where organization_id=org and idempotency_key=p_input->>'idempotencyKey';
 if found then
  if j.input_hash<>digest then raise exception 'Idempotency key reused with changed input' using errcode='22023'; end if;
  return j.id;
 end if;
 if (select count(*) from factory.jobs where organization_id=org and created_at>now()-interval '1 hour')>=5
 or (select count(*) from factory.jobs where organization_id=org and state in ('APPROVED','PROVISIONING','VERIFYING'))>=3
 then raise exception 'Factory rate/concurrency limit' using errcode='54000'; end if;
 select * into a from factory.adapters where product_id=p_input->>'productId' and version=p_input->>'version'
 and status in ('ADAPTER_IN_DEVELOPMENT','READY_FOR_PROVISIONING');
 if not found then raise exception 'Unapproved product/version' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_input->'addons') x where not exists(select 1 from jsonb_array_elements(a.template) s where s->>'id'=x and s->>'type'='EXTERNAL'))
 then raise exception 'Unknown or non-external product add-on' using errcode='22023'; end if;
 insert into factory.instances(organization_id,project_id,owner_id,product_id,version,name,domain,region,quota_bytes)
 values(org,project,owner_id,a.product_id,a.version,p_input->>'name',p_input->>'domain',p_input->>'region',quota) returning id into instance;
 insert into factory.jobs(instance_id,organization_id,project_id,created_by,approved_session_id,idempotency_key,input_hash,input,checklist)
 values(instance,org,project,auth.uid(),(auth.jwt()->>'session_id')::uuid,p_input->>'idempotencyKey',digest,p_input,
 (select jsonb_agg(value||jsonb_build_object('instanceId',instance,'ownerId',owner_id)||case when (p_input->'addons') ? (value->>'id') then jsonb_build_object('required',true,'status','WAITING_FOR_PROVIDER') else '{}'::jsonb end) from jsonb_array_elements(a.template))) returning * into j;
 perform factory.audit(j.id,'requested',jsonb_build_object('execution_mode','MOCK','live_provisioning',false));
 return j.id;
end $$;

create function public.factory_catalog() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'executionMode','MOCK','liveProvisioning',false,
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',a.product_id,'name',coalesce(a.label,a.product_id),'version',a.version,'status',a.status,'liveApproved',a.live_approved,'provenance',a.provenance,'addons',coalesce((select jsonb_agg(jsonb_build_object('id',s->>'id','title',s->>'title')) from jsonb_array_elements(a.template) s where s->>'type'='EXTERNAL'),'[]'::jsonb))) from factory.adapters a),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'organizationId',p.organization_id,'name',p.name,'canCreate',public.has_resource_permission('factory.create',p.organization_id,p.id)))
 from public.support_projects p where p.archived_at is null and public.has_resource_permission('factory.read',p.organization_id,p.id)),'[]'::jsonb),
 'owners',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'organizationId',u.organization_id,'label',coalesce(u.full_name,u.email,'Användare')))
 from public.profiles u where u.is_active and not u.login_activation_pending and (u.id=auth.uid() or exists(select 1 from public.support_projects p
 where p.organization_id=u.organization_id and public.has_resource_permission('factory.create',p.organization_id,p.id)))),'[]'::jsonb))
 where auth.uid() is not null;
$$;
create function public.factory_list(p_after timestamptz default null,p_after_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 with visible as materialized(select j.id,j.instance_id,j.organization_id,j.project_id,j.state,j.created_at,j.last_error,
 i.name,i.product_id,i.version,i.owner_id,i.execution_mode,i.status as instance_status,i.quota_bytes,i.used_bytes,i.reserved_bytes
 from factory.jobs j join factory.instances i on i.id=j.instance_id
 where public.has_resource_permission('factory.read',j.organization_id,j.project_id)
 and (p_after is null or (j.created_at,j.id)<(p_after,p_after_id)) order by j.created_at desc,j.id desc limit 51)
 select jsonb_build_object('items',coalesce((select jsonb_agg(x) from(select * from visible order by created_at desc,id desc limit 50)x),'[]'::jsonb),'hasMore',(select count(*)>50 from visible));
$$;
create function public.factory_operation(p_instance uuid,p_operation text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare i factory.instances; request_id uuid; job uuid;
begin
 select * into strict i from factory.instances where id=p_instance;
 if not public.has_resource_permission('factory.manage',i.organization_id,i.project_id) then raise exception 'Factory operation denied' using errcode='42501'; end if;
 if p_operation not in ('upgrade','suspend','backup','restore','cleanup-review') or length(btrim(p_reason)) not between 10 and 1000 then raise exception 'Invalid operation request' using errcode='22023'; end if;
 insert into factory.operation_requests(instance_id,actor_id,operation,reason) values(i.id,auth.uid(),p_operation,p_reason) returning id into request_id;
 select id into strict job from factory.jobs where instance_id=i.id;
 perform factory.audit(job,'operation_requested',jsonb_build_object('operation',p_operation,'request_id',request_id,'executed',false));
 return request_id;
end $$;

create function public.factory_snapshot(p_job uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('job',to_jsonb(j)-'lease_token'-'approved_session_id'-'input_hash','instance',to_jsonb(i),
 'resources',coalesce((select jsonb_agg(jsonb_build_object('step',r.step,'id',r.resource_id,'provider',r.provider_id,'evidence',r.evidence)) from factory.resources r where r.job_id=j.id),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(x) from(select id,created_at,action,metadata from public.support_admin_audit where target_type='factory_job' and target_id=j.id::text order by id)x),'[]'::jsonb))
 from factory.jobs j join factory.instances i on i.id=j.instance_id
 where j.id=p_job and public.has_resource_permission('factory.read',j.organization_id,j.project_id);
$$;
create function public.factory_resume(p_job uuid) returns void language plpgsql security definer set search_path='' as $$
declare j factory.jobs;
begin
 select * into strict j from factory.jobs where id=p_job for update;
 if not public.has_resource_permission('factory.manage',j.organization_id,j.project_id)
 or not public.has_resource_permission('factory.create',j.organization_id,j.project_id) then raise exception 'Factory resume denied' using errcode='42501'; end if;
 if j.lease_until>now() then raise exception 'Job is leased' using errcode='40001'; end if;
 if j.state in ('READY','MANUAL_RECOVERY') then raise exception 'Job requires separate operation/recovery review' using errcode='22023'; end if;
 update factory.jobs set state='APPROVED',approved_session_id=(auth.jwt()->>'session_id')::uuid,created_by=auth.uid(),last_error=null,revision=revision+1 where id=p_job;
 perform factory.audit(p_job,'resumed');
end $$;
create function public.factory_manual(p_job uuid,p_step text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare j factory.jobs; item jsonb; next jsonb:='[]'; matched boolean:=false;
begin
 select * into strict j from factory.jobs where id=p_job for update;
 if not public.has_resource_permission('factory.manage',j.organization_id,j.project_id) then raise exception 'Manual checklist denied' using errcode='42501'; end if;
 if j.lease_until>now() or p_note is null or length(btrim(p_note)) not between 10 and 1000 then raise exception 'Invalid manual update' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(j.checklist) loop
  if item->>'id'=p_step then
   if item->>'type'<>'MANUAL' then raise exception 'Technical/external checks require provider evidence' using errcode='42501'; end if;
   item:=item||jsonb_build_object('status','VERIFIED','verifiedAt',now(),'evidence',jsonb_build_object('method','manual-attestation','actor',auth.uid(),'note',p_note));matched:=true;
  end if;
  next:=next||jsonb_build_array(item);
 end loop;
 if not matched then raise exception 'Unknown checklist item' using errcode='22023'; end if;
 update factory.jobs set checklist=next,revision=revision+1 where id=p_job;
 perform factory.audit(p_job,'manual_attestation',jsonb_build_object('step',p_step));
end $$;

-- Worker endpoints are never granted to authenticated/anon callers.
create function public.factory_worker_claim(p_job uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j factory.jobs;
begin
 select * into j from factory.jobs where id=p_job and state in ('APPROVED','PROVISIONING','VERIFYING')
 and (lease_until is null or lease_until<now()) for update skip locked;
 if not found then return null; end if;
 if not factory.initiator_allowed(j.id) then
  update factory.jobs set state='BLOCKED',last_error='AUTHORIZATION_REVOKED',revision=revision+1 where id=j.id;
  perform factory.audit(j.id,'blocked_authorization');return null;
 end if;
 update factory.jobs set lease_token=p_token,lease_until=now()+interval '60 seconds',state='PROVISIONING',revision=revision+1 where id=j.id returning * into j;
 perform factory.audit(j.id,'claimed');return to_jsonb(j);
end $$;
create function public.factory_worker_save(p_job uuid,p_token uuid,p_revision integer,p_state text,p_checklist jsonb,p_error text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j factory.jobs;
begin
 select * into strict j from factory.jobs where id=p_job for update;
 if j.lease_token is distinct from p_token or j.revision<>p_revision or j.lease_until<=now() then raise exception 'Stale worker lease' using errcode='40001'; end if;
 if not factory.initiator_allowed(j.id) then
  update factory.jobs set state='BLOCKED',last_error='AUTHORIZATION_REVOKED',lease_token=null,lease_until=null,revision=revision+1 where id=j.id;
  perform factory.audit(j.id,'blocked_authorization');return null;
 end if;
 update factory.jobs set state=p_state,checklist=p_checklist,last_error=p_error,updated_at=now(),revision=revision+1,
 lease_until=case when p_state in ('PROVISIONING','VERIFYING') then now()+interval '60 seconds' else null end,
 lease_token=case when p_state in ('PROVISIONING','VERIFYING') then p_token else null end where id=j.id returning * into j;
 update factory.instances set status=case when p_state='READY' then 'SIMULATED' else p_state end where id=j.instance_id;
 perform factory.audit(j.id,'state',jsonb_build_object('state',p_state,'step_states',(select jsonb_object_agg(x->>'id',x->>'status') from jsonb_array_elements(p_checklist)x)));
 return to_jsonb(j);
end $$;

create function public.factory_reserve(p_instance uuid,p_key text,p_bytes bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare i factory.instances; r factory.upload_reservations;
begin
 select * into strict i from factory.instances where id=p_instance for update;
 if not public.has_resource_permission('factory.storage.write',i.organization_id,i.project_id) then raise exception 'Storage denied' using errcode='42501'; end if;
 if p_bytes is null or p_key is null or p_bytes<=0 or p_key !~ '^[a-zA-Z0-9_-]{16,128}$' then raise exception 'Invalid reservation' using errcode='22023'; end if;
 select * into r from factory.upload_reservations where instance_id=p_instance and upload_key=p_key;
 if found then if r.bytes<>p_bytes then raise exception 'Upload key conflict' using errcode='22023'; end if; return r.id; end if;
 if i.storage_blocked or i.used_bytes+i.reserved_bytes+p_bytes>i.quota_bytes then raise exception 'Storage quota exceeded' using errcode='53100'; end if;
 insert into factory.upload_reservations(instance_id,upload_key,bytes,created_by) values(p_instance,p_key,p_bytes,auth.uid()) returning * into r;
 update factory.instances set reserved_bytes=reserved_bytes+p_bytes where id=p_instance;
 perform factory.audit((select id from factory.jobs where instance_id=p_instance),'storage_reserved',jsonb_build_object('reservation_id',r.id,'bytes',p_bytes));return r.id;
end $$;
create function public.factory_worker_complete_upload(p_reservation uuid,p_observed_bytes bigint) returns text
language plpgsql security definer set search_path='' as $$
declare r factory.upload_reservations; i factory.instances;
begin
 -- The worker supplies a verified provider HEAD size, not client Content-Length.
 select * into strict r from factory.upload_reservations where id=p_reservation;
 select * into strict i from factory.instances where id=r.instance_id for update;
 select * into strict r from factory.upload_reservations where id=p_reservation for update;
 if r.status<>'RESERVED' then return r.status; end if;
 if p_observed_bytes is null or p_observed_bytes<0 then raise exception 'Invalid object size' using errcode='22023'; end if;
 if p_observed_bytes>r.bytes then
  update factory.upload_reservations set status='QUARANTINED',object_bytes=p_observed_bytes where id=r.id;
  update factory.instances set storage_blocked=true where id=i.id;
  perform factory.audit((select id from factory.jobs where instance_id=i.id),'storage_quarantined',jsonb_build_object('reservation_id',r.id));return 'QUARANTINED';
 end if;
 update factory.instances set reserved_bytes=reserved_bytes-r.bytes,used_bytes=used_bytes+p_observed_bytes where id=i.id;
 update factory.upload_reservations set status='COMMITTED',object_bytes=p_observed_bytes where id=r.id;
 perform factory.audit((select id from factory.jobs where instance_id=i.id),'storage_committed',jsonb_build_object('reservation_id',r.id,'observed_bytes',p_observed_bytes));return 'COMMITTED';
end $$;

-- Complete inventory and aborted-upload proof are supplied only by the trusted
-- provider worker. Never infer deletion/absence from a timeout or client input.
create function public.factory_worker_cancel_upload(p_reservation uuid,p_verified_absent boolean) returns void
language plpgsql security definer set search_path='' as $$
declare r factory.upload_reservations; i factory.instances;
begin
 select * into strict r from factory.upload_reservations where id=p_reservation;
 select * into strict i from factory.instances where id=r.instance_id for update;
 select * into strict r from factory.upload_reservations where id=p_reservation for update;
 if p_verified_absent is distinct from true or r.status not in ('RESERVED','CANCELLED') then raise exception 'Upload absence/abort is unverified' using errcode='22023'; end if;
 if r.status='CANCELLED' then return; end if;
 update factory.instances set reserved_bytes=reserved_bytes-r.bytes where id=i.id;
 update factory.upload_reservations set status='CANCELLED' where id=r.id;
 perform factory.audit((select id from factory.jobs where instance_id=i.id),'storage_reservation_cancelled',jsonb_build_object('reservation_id',r.id));
end $$;
create function public.factory_worker_reconcile_storage(p_instance uuid,p_observation uuid,p_manifest_hash text,p_observed bigint,p_complete boolean) returns void
language plpgsql security definer set search_path='' as $$
declare i factory.instances; o factory.storage_observations;
begin
 select * into strict i from factory.instances where id=p_instance for update;
 if p_complete is distinct from true or p_observation is null or p_manifest_hash is null or p_manifest_hash !~ '^[a-f0-9]{64}$' or p_observed is null or p_observed<0
 then raise exception 'Complete verified inventory required' using errcode='22023'; end if;
 select * into o from factory.storage_observations where instance_id=p_instance and observation_id=p_observation;
 if found then
  if o.observed_bytes<>p_observed or o.manifest_hash<>p_manifest_hash then raise exception 'Observation conflict' using errcode='22023'; end if;return;
 end if;
 -- Keep ambiguous and quarantined reservations charged until separately reviewed.
 insert into factory.storage_observations(instance_id,observation_id,manifest_hash,observed_bytes) values(p_instance,p_observation,p_manifest_hash,p_observed);
 update factory.instances set used_bytes=p_observed,storage_blocked=(p_observed+reserved_bytes>=quota_bytes or exists(select 1 from factory.upload_reservations where instance_id=i.id and status='QUARANTINED')) where id=p_instance;
 perform factory.audit((select id from factory.jobs where instance_id=p_instance),'storage_reconciled',jsonb_build_object('observation_id',p_observation,'observed_bytes',p_observed));
end $$;
create function public.factory_storage_status(p_instance uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('used_bytes',used_bytes,'reserved_bytes',reserved_bytes,'quota_bytes',quota_bytes,'blocked',storage_blocked,
 'warning',case when used_bytes+reserved_bytes>=quota_bytes then 100 when (used_bytes+reserved_bytes)::numeric/quota_bytes>=0.9 then 90 when (used_bytes+reserved_bytes)::numeric/quota_bytes>=0.8 then 80 else 0 end)
 from factory.instances where id=p_instance and public.has_resource_permission('factory.read',organization_id,project_id);
$$;

-- Zero direct client writes; RLS applies even when a guessed ID is sent via REST.
alter table factory.adapters enable row level security;
alter table factory.instances enable row level security;
alter table factory.jobs enable row level security;
alter table factory.resources enable row level security;
alter table factory.upload_reservations enable row level security;
alter table factory.mock_resources enable row level security;
alter table factory.operation_requests enable row level security;
alter table factory.storage_observations enable row level security;
alter table factory.local_objects enable row level security;
create policy instances_read on factory.instances for select to authenticated using(public.has_resource_permission('factory.read',organization_id,project_id));
create policy jobs_read on factory.jobs for select to authenticated using(public.has_resource_permission('factory.read',organization_id,project_id));
create policy resources_read on factory.resources for select to authenticated using(exists(select 1 from factory.jobs j where j.id=job_id and public.has_resource_permission('factory.read',j.organization_id,j.project_id)));
grant select on factory.instances,factory.jobs,factory.resources to authenticated;
grant all on all tables in schema factory to service_role;
grant usage,select on all sequences in schema factory to service_role;
revoke all on all functions in schema factory from public,anon,authenticated;
revoke all on function public.factory_create(jsonb),public.factory_catalog(),public.factory_snapshot(uuid),public.factory_resume(uuid),public.factory_manual(uuid,text,text),public.factory_reserve(uuid,text,bigint) from public,anon;
grant execute on function public.factory_create(jsonb),public.factory_catalog(),public.factory_snapshot(uuid),public.factory_resume(uuid),public.factory_manual(uuid,text,text),public.factory_reserve(uuid,text,bigint) to authenticated;
revoke all on function public.factory_list(timestamptz,uuid),public.factory_operation(uuid,text,text) from public,anon;
grant execute on function public.factory_list(timestamptz,uuid),public.factory_operation(uuid,text,text) to authenticated;
revoke all on function public.factory_worker_claim(uuid,uuid),public.factory_worker_save(uuid,uuid,integer,text,jsonb,text),public.factory_worker_complete_upload(uuid,bigint) from public,anon,authenticated;
grant execute on function public.factory_worker_claim(uuid,uuid),public.factory_worker_save(uuid,uuid,integer,text,jsonb,text),public.factory_worker_complete_upload(uuid,bigint) to service_role;
revoke all on function public.factory_worker_cancel_upload(uuid,boolean),public.factory_worker_reconcile_storage(uuid,uuid,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.factory_worker_cancel_upload(uuid,boolean),public.factory_worker_reconcile_storage(uuid,uuid,text,bigint,boolean) to service_role;
revoke all on function public.factory_storage_status(uuid) from public,anon;
grant execute on function public.factory_storage_status(uuid) to authenticated;
revoke all on function public.factory_local_object(uuid,uuid) from public,anon;
grant execute on function public.factory_local_object(uuid,uuid) to authenticated;
commit;
