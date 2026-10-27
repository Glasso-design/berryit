-- Forward-only LOCAL review migration; not in the production migration chain.
begin;
do $$ begin
 if current_setting('factory.install_environment',true) is distinct from 'isolated-test'
 or to_regclass('factory.jobs') is null then raise exception 'Isolated Factory schema required'; end if;
end $$;
create table factory.account_mode_approvals(
 job_id uuid primary key references factory.jobs(id), mode text not null check(mode in('DEDICATED_MANAGED','LIMITED_STANDALONE','MANAGED_RESOURCE_ISOLATION')),
 actor_id uuid not null references public.profiles(id),approved_session_id uuid not null references auth.sessions(id),reason text not null,created_at timestamptz not null default now()
);
create table factory.external_accounts(
 account_id text primary key check(account_id ~ '^[a-f0-9]{32}$'), mode text not null,
 owner_instance uuid unique references factory.instances(id),
 check((mode='MANAGED_RESOURCE_ISOLATION' and owner_instance is null) or (mode in('DEDICATED_MANAGED','LIMITED_STANDALONE') and owner_instance is not null))
);
create table factory.provider_intents(
 id uuid primary key default gen_random_uuid(),job_id uuid not null references factory.jobs(id),instance_id uuid not null references factory.instances(id),
 step text not null,input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
 state text not null default 'PENDING' check(state in('PENDING','IN_FLIGHT','AMBIGUOUS','VERIFIED')),
 lease_token uuid,lease_until timestamptz,attempts integer not null default 0,result jsonb,
 external_ref text unique,unique(job_id,step)
);
-- Signed URLs and credentials never go in these tables, evidence or audit.
create table factory.provider_status(
 instance_id uuid primary key references factory.instances(id), observed_at timestamptz not null default now(),
 verification text not null check(verification in('SYNTHETIC_HTTP','LIVE_READ_ONLY','LIVE_VERIFIED')),
 account_mode text not null,capabilities jsonb not null,missing_permissions jsonb not null,blockers jsonb not null,
 dns_status text not null,email_status text not null,tls_status text not null,cost_estimate jsonb not null
);
-- A binding belongs to ONE product instance. Only the product server holds its
-- random secret, its fixed tenant mapping and limited worker connection.
create table factory.storage_bindings(
 id uuid primary key default gen_random_uuid(),instance_id uuid not null unique references factory.instances(id),
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),product_tenant_id text not null check(length(product_tenant_id) between 1 and 128),
 account_id text not null check(account_id ~ '^[a-f0-9]{32}$'),bucket text not null,
 jurisdiction text not null check(jurisdiction in('eu','us')),revoked_at timestamptz
);
create table factory.multipart_uploads(
 reservation_id uuid primary key references factory.upload_reservations(id),binding_id uuid not null references factory.storage_bindings(id),
 subject_id uuid not null,object_key text not null unique,upload_id text,
 state text not null default 'PENDING' check(state in('PENDING','CREATING','OPEN','COMPLETING','COMMITTED','QUARANTINED','AMBIGUOUS')),
 part_bytes bigint not null check(part_bytes>=5242880 and part_bytes<=5368709120),
 lease_token uuid,lease_until timestamptz,created_at timestamptz not null default now()
);
create table factory.multipart_parts(
 reservation_id uuid not null references factory.multipart_uploads(reservation_id),part_number integer not null check(part_number between 1 and 10000),
 bytes bigint not null check(bytes>0),content_md5 text not null,primary key(reservation_id,part_number)
);
alter table factory.instances add column storage_revision bigint not null default 0;

create function public.factory_approve_account_mode(p_job uuid,p_mode text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare j factory.jobs;
begin
 select * into strict j from factory.jobs where id=p_job for update;
 if not public.has_resource_permission('factory.manage',j.organization_id,j.project_id)
 or not public.has_resource_permission('factory.create',j.organization_id,j.project_id) then raise exception 'Account mode approval denied' using errcode='42501'; end if;
 if j.lease_until>now() or p_mode not in('DEDICATED_MANAGED','LIMITED_STANDALONE','MANAGED_RESOURCE_ISOLATION')
 or p_reason is null or length(btrim(p_reason)) not between 15 and 500 then raise exception 'Invalid mode approval' using errcode='22023'; end if;
 insert into factory.account_mode_approvals(job_id,mode,actor_id,approved_session_id,reason) values(j.id,p_mode,auth.uid(),(auth.jwt()->>'session_id')::uuid,p_reason)
 on conflict(job_id) do update set mode=excluded.mode,actor_id=excluded.actor_id,approved_session_id=excluded.approved_session_id,reason=excluded.reason,created_at=now();
 perform factory.audit(j.id,'account_mode_approved',jsonb_build_object('requested',j.input->>'accountMode','approved',p_mode));
end $$;

create function factory.account_mode_allowed(p_job uuid,p_mode text) returns boolean
language plpgsql security definer set search_path='' as $$
declare a factory.account_mode_approvals;j factory.jobs;saved text;allowed boolean;
begin
 select * into j from factory.jobs where id=p_job;
 select * into a from factory.account_mode_approvals where job_id=p_job and mode=p_mode;
 if not found then return false;end if;
 if not exists(select 1 from auth.sessions where id=a.approved_session_id and user_id=a.actor_id and aal='aal2' and (not_after is null or not_after>now())) then return false;end if;
 saved:=current_setting('request.jwt.claims',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a.actor_id,'role','authenticated','aal','aal2','session_id',a.approved_session_id)::text,true);
 allowed:=public.has_resource_permission('factory.manage',j.organization_id,j.project_id) and public.has_resource_permission('factory.create',j.organization_id,j.project_id);
 perform set_config('request.jwt.claims',coalesce(saved,''),true);return coalesce(allowed,false);
exception when others then perform set_config('request.jwt.claims',coalesce(saved,''),true);raise;
end $$;
revoke all on function factory.account_mode_allowed(uuid,text) from public,anon,authenticated;
grant execute on function factory.account_mode_allowed(uuid,text) to service_role;
-- ResourceRegistry runs as the existing trusted worker role, not the schema
-- owner. These helpers remain inaccessible to every client role.
grant execute on function factory.initiator_allowed(uuid),factory.audit(uuid,text,jsonb) to service_role;

-- Product callers do NOT get Factory roles. The HTTP host authenticates against
-- existing QABGO Core and supplies its fixed binding, tenant and current subject.
-- This RPC is restricted to a new dedicated DB role, not anon/authenticated.
create function public.factory_broker_reserve(p_binding uuid,p_secret text,p_tenant text,p_subject uuid,p_key text,p_bytes bigint,p_part_bytes bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b factory.storage_bindings; i factory.instances;r factory.upload_reservations;u factory.multipart_uploads;
begin
 select * into strict b from factory.storage_bindings where id=p_binding and product_tenant_id=p_tenant and revoked_at is null
 and secret_hash=encode(public.digest(p_secret,'sha256'),'hex');
 select * into strict i from factory.instances where id=b.instance_id for update;
 if p_subject is null or p_bytes is null or p_bytes<=0 or p_key is null or p_key !~ '^[a-zA-Z0-9_-]{16,128}$'
 or p_part_bytes is null or p_part_bytes<5242880 or p_part_bytes>5368709120 or ceil(p_bytes::numeric/p_part_bytes)>10000
 then raise exception 'Invalid upload reservation' using errcode='22023'; end if;
 select * into r from factory.upload_reservations where instance_id=i.id and upload_key=p_key;
 if found then
  select * into strict u from factory.multipart_uploads where reservation_id=r.id;
  if r.bytes<>p_bytes or u.subject_id<>p_subject or u.binding_id<>b.id or u.part_bytes<>p_part_bytes then raise exception 'Upload key conflict' using errcode='22023'; end if;
 else
  if i.storage_blocked or i.used_bytes+i.reserved_bytes+p_bytes>i.quota_bytes then raise exception 'Storage quota exceeded' using errcode='53100'; end if;
  if (select count(*) from factory.multipart_uploads where binding_id=b.id and state<>'COMMITTED')>=128
   or (select count(*) from factory.multipart_uploads where binding_id=b.id and subject_id=p_subject and state<>'COMMITTED')>=32
   then raise exception 'Too many unfinished multipart uploads' using errcode='53100'; end if;
  insert into factory.upload_reservations(instance_id,upload_key,bytes,created_by) values(i.id,p_key,p_bytes,i.owner_id) returning * into r;
  insert into factory.multipart_uploads(reservation_id,binding_id,subject_id,object_key,part_bytes)
   values(r.id,b.id,p_subject,i.id::text||'/'||r.id::text,p_part_bytes) returning * into u;
  update factory.instances set reserved_bytes=reserved_bytes+p_bytes where id=i.id;
  perform factory.audit((select id from factory.jobs where instance_id=i.id),'product_storage_reserved',jsonb_build_object('reservation_id',r.id,'bytes',p_bytes,'product_subject_id',p_subject));
 end if;
 return jsonb_build_object('reservationId',r.id,'key',u.object_key,'state',u.state,'bytes',r.bytes,'partBytes',u.part_bytes);
end $$;

-- Minimal worker login role can be assigned to the product-side broker pool.
-- It has no table access or general service-role privileges.
do $$ begin if not exists(select 1 from pg_roles where rolname='factory_broker') then create role factory_broker nologin; end if; end $$;
revoke all on function public.factory_broker_reserve(uuid,text,text,uuid,text,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function public.factory_broker_reserve(uuid,text,text,uuid,text,bigint,bigint) to factory_broker;

create function factory.storage_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin new.storage_revision:=old.storage_revision+1; return new; end $$;
create trigger storage_revision before update of used_bytes,reserved_bytes,storage_blocked on factory.instances for each row execute function factory.storage_revision();

create function public.factory_broker_upload(p_binding uuid,p_secret text,p_tenant text,p_subject uuid,p_reservation uuid,p_action text,p_value jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare b factory.storage_bindings;i factory.instances;u factory.multipart_uploads;r factory.upload_reservations;part factory.multipart_parts;expected bigint;n integer;lease uuid;
begin
 select * into strict b from factory.storage_bindings where id=p_binding and product_tenant_id=p_tenant and revoked_at is null
 and secret_hash=encode(public.digest(p_secret,'sha256'),'hex');
 select * into strict i from factory.instances where id=b.instance_id for update;
 select * into strict u from factory.multipart_uploads where reservation_id=p_reservation and binding_id=b.id and subject_id=p_subject for update;
 select * into strict r from factory.upload_reservations where id=u.reservation_id and instance_id=i.id for update;
 if p_action='read' then null;
 elsif p_action in('initiate','complete') then
  if u.state='COMMITTED' then null;
  elsif (p_action='initiate' and u.state='PENDING') or (p_action='complete' and (u.state='OPEN' or (u.state='COMPLETING' and u.lease_until<now()))) then
   lease:=(p_value->>'lease')::uuid;
   if lease is null then raise exception 'Lease required';end if;
   update factory.multipart_uploads set state=case when p_action='initiate' then 'CREATING' else 'COMPLETING' end,
    lease_token=lease,lease_until=now()+interval '60 seconds' where reservation_id=r.id returning * into u;
   update factory.instances set storage_revision=storage_revision+1 where id=i.id;
  else raise exception 'Upload requires reconciliation or is busy' using errcode='40001';end if;
 elsif p_action='opened' then
  if u.state<>'CREATING' or u.lease_token is distinct from (p_value->>'lease')::uuid or u.lease_until<=now()
  or length(p_value->>'uploadId') not between 1 and 1024 then raise exception 'Stale upload lease' using errcode='40001';end if;
  update factory.multipart_uploads set state='OPEN',upload_id=p_value->>'uploadId',lease_token=null,lease_until=null where reservation_id=r.id returning * into u;
 elsif p_action='part' then
  if u.state<>'OPEN' or r.status<>'RESERVED' then raise exception 'Upload not open' using errcode='42501';end if;
  n:=(p_value->>'number')::integer;expected:=least(u.part_bytes,r.bytes-(n-1)::bigint*u.part_bytes);
  if n is null or n<1 or n>10000 or expected<=0 or p_value->>'md5' is null or p_value->>'md5' !~ '^[A-Za-z0-9+/]{22}==$' then raise exception 'Invalid part' using errcode='22023';end if;
  insert into factory.multipart_parts(reservation_id,part_number,bytes,content_md5) values(r.id,n,expected,p_value->>'md5')
   on conflict(reservation_id,part_number) do nothing;
  select * into strict part from factory.multipart_parts where reservation_id=r.id and part_number=n;
  if part.content_md5<>p_value->>'md5' then raise exception 'Part digest cannot change' using errcode='22023';end if;
  return jsonb_build_object('uploadId',u.upload_id,'key',u.object_key,'bytes',part.bytes,'number',n,'md5',part.content_md5);
 elsif p_action='committed' then
  if u.state<>'COMMITTED' then
   if u.state<>'COMPLETING' or u.lease_token is distinct from (p_value->>'lease')::uuid or u.lease_until<=now() then raise exception 'Stale completion lease' using errcode='40001';end if;
   if p_value->>'reservationId'<>r.id::text or p_value->>'instanceId'<>i.id::text or (p_value->>'bytes')::bigint<>r.bytes
    or p_value->>'reservationId' is null or p_value->>'instanceId' is null or p_value->>'bytes' is null then
    update factory.instances set storage_blocked=true where id=i.id;
    update factory.multipart_uploads set state='QUARANTINED' where reservation_id=r.id;return jsonb_build_object('state','QUARANTINED');
   end if;
   perform public.factory_worker_complete_upload(r.id,r.bytes);
   update factory.multipart_uploads set state='COMMITTED',lease_token=null,lease_until=null where reservation_id=r.id returning * into u;
  end if;
 else raise exception 'Unknown broker operation' using errcode='22023';end if;
 return jsonb_build_object('reservationId',r.id,'uploadId',u.upload_id,'key',u.object_key,'state',u.state,'bytes',r.bytes,'partBytes',u.part_bytes,
 'parts',coalesce((select jsonb_agg(jsonb_build_object('number',part_number,'bytes',bytes,'md5',content_md5) order by part_number) from factory.multipart_parts where reservation_id=r.id),'[]'));
end $$;
revoke all on function public.factory_broker_upload(uuid,text,text,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.factory_broker_upload(uuid,text,text,uuid,uuid,text,jsonb) to factory_broker;
revoke all on function factory.storage_revision() from public,anon,authenticated,factory_broker;

-- Inventory reads and commits share a revision fence with reservation/completion.
-- An object whose upload is not committed cannot be counted twice or released.
create function public.factory_worker_r2_inventory(p_instance uuid,p_revision bigint,p_objects jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare i factory.instances;object jsonb;total bigint:=0;known boolean;unknown boolean:=false;
begin
 select * into strict i from factory.instances where id=p_instance for update;
 if i.storage_revision<>p_revision or jsonb_typeof(p_objects)<>'array' then raise exception 'Stale or incomplete inventory' using errcode='40001';end if;
 if (select count(*)<>count(distinct x->>'key') from jsonb_array_elements(p_objects)x) then raise exception 'Duplicate object';end if;
 for object in select value from jsonb_array_elements(p_objects) loop
  if object->>'key' is null or object->>'key' not like i.id::text||'/%' or object->>'bytes' is null or (object->>'bytes')::bigint<0 then raise exception 'Foreign or invalid object';end if;
  if exists(select 1 from factory.multipart_uploads u join factory.upload_reservations r on r.id=u.reservation_id where u.object_key=object->>'key' and r.status<>'COMMITTED') then raise exception 'Unsettled upload needs HEAD reconciliation' using errcode='40001';end if;
  select exists(select 1 from factory.multipart_uploads u join factory.upload_reservations r on r.id=u.reservation_id where u.object_key=object->>'key' and r.status='COMMITTED' and r.object_bytes=(object->>'bytes')::bigint) into known;
  unknown:=unknown or not known;total:=total+(object->>'bytes')::bigint;
 end loop;
 update factory.instances set used_bytes=total,storage_blocked=(unknown or total+reserved_bytes>=quota_bytes or exists(select 1 from factory.upload_reservations where instance_id=i.id and status='QUARANTINED')) where id=i.id;
 perform factory.audit((select id from factory.jobs where instance_id=i.id),'r2_inventory',jsonb_build_object('objects',jsonb_array_length(p_objects),'bytes',total,'unknown_objects',unknown));
end $$;
revoke all on function public.factory_worker_r2_inventory(uuid,bigint,jsonb) from public,anon,authenticated,factory_broker;
grant execute on function public.factory_worker_r2_inventory(uuid,bigint,jsonb) to service_role;

create function public.factory_provider_status(p_instance uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('observedAt',s.observed_at,'verification',s.verification,'accountMode',s.account_mode,'capabilities',s.capabilities,
 'missingPermissions',s.missing_permissions,'blockers',s.blockers,'dns',s.dns_status,'email',s.email_status,'tls',s.tls_status,'cost',s.cost_estimate,
 'resources',coalesce((select jsonb_agg(jsonb_build_object('step',step,'state',state,'reference',external_ref,'verification',result->>'verification')) from factory.provider_intents where instance_id=i.id),'[]'),
 'quota',public.factory_storage_status(i.id),'approvedAccountMode',(select a.mode from factory.account_mode_approvals a join factory.jobs j on j.id=a.job_id where j.instance_id=i.id))
 from factory.instances i left join factory.provider_status s on s.instance_id=i.id
 where i.id=p_instance and public.has_resource_permission('factory.read',i.organization_id,i.project_id);
$$;
revoke all on function public.factory_approve_account_mode(uuid,text,text),public.factory_provider_status(uuid) from public,anon;
grant execute on function public.factory_approve_account_mode(uuid,text,text),public.factory_provider_status(uuid) to authenticated;

alter table factory.account_mode_approvals enable row level security;
alter table factory.external_accounts enable row level security;
alter table factory.provider_intents enable row level security;
alter table factory.provider_status enable row level security;
alter table factory.storage_bindings enable row level security;
alter table factory.multipart_uploads enable row level security;
alter table factory.multipart_parts enable row level security;
revoke all on all tables in schema factory from factory_broker;
grant all on factory.account_mode_approvals,factory.external_accounts,factory.provider_intents,factory.provider_status,factory.storage_bindings,factory.multipart_uploads,factory.multipart_parts to service_role;
commit;
