-- Forward-only ISOLATED REVIEW patch, outside the production migration chain.
-- Apply only after 001_factory.sql and 002_provider_broker.sql are approved.
-- No extension relocation, compatibility alias, new permission or table change.
begin;
do $$ begin
 if current_setting('factory.install_environment',true) is distinct from 'isolated-test'
 or to_regprocedure('public.factory_broker_reserve(uuid,text,text,uuid,text,bigint,bigint)') is null
 or to_regprocedure('public.factory_broker_upload(uuid,text,text,uuid,uuid,text,jsonb)') is null
 then raise exception 'Existing isolated Factory broker required'; end if;
end $$;

create or replace function public.factory_broker_reserve(p_binding uuid,p_secret text,p_tenant text,p_subject uuid,p_key text,p_bytes bigint,p_part_bytes bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b factory.storage_bindings; i factory.instances;r factory.upload_reservations;u factory.multipart_uploads;
begin
 select * into strict b from factory.storage_bindings where id=p_binding and product_tenant_id=p_tenant and revoked_at is null
 and secret_hash=encode(pg_catalog.sha256(pg_catalog.convert_to(p_secret,'UTF8')),'hex');
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

create or replace function public.factory_broker_upload(p_binding uuid,p_secret text,p_tenant text,p_subject uuid,p_reservation uuid,p_action text,p_value jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare b factory.storage_bindings;i factory.instances;u factory.multipart_uploads;r factory.upload_reservations;part factory.multipart_parts;expected bigint;n integer;lease uuid;
begin
 select * into strict b from factory.storage_bindings where id=p_binding and product_tenant_id=p_tenant and revoked_at is null
 and secret_hash=encode(pg_catalog.sha256(pg_catalog.convert_to(p_secret,'UTF8')),'hex');
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

-- CREATE OR REPLACE preserves the reviewed owner and EXECUTE ACLs.
commit;
