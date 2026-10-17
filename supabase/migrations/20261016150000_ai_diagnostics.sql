-- Forward-only extension of existing AI conversations and project permissions.
insert into public.support_permissions(key,description,requires_mfa) values
 ('ai.use','Begära AI-diagnostik med uttryckligt godkännande och projektbegränsat underlag',false);
insert into public.support_role_permissions(role_key,permission_key) values
 ('BERRYIT_SUPPORT_SUPER_ADMIN','ai.use'),('BERRYIT_SUPPORT_ADMIN','ai.use'),
 ('BERRYIT_SUPPORT_TECHNICIAN','ai.use'),('BERRYIT_DEVELOPER','ai.use');
alter table public.ai_conversations add column incident_id uuid,
 add constraint ai_incident_tenant foreign key(incident_id,organization_id) references public.incidents(id,organization_id) on delete restrict;
create function public.can_use_ai_context(p_org uuid,p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_project is null then public.can_use_ai_for_organization(p_org)
 else public.has_resource_permission('ai.use',p_org,p_project)
 and public.has_resource_permission('projects.read',p_org,p_project) end;
$$;
create function berryit_private.ai_incident_matches(p_incident uuid,p_org uuid,p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.can_use_ai_context(p_org,p_project) and (p_incident is null or exists(select 1 from public.incidents i
 left join public.infra_services s on s.id=i.service_id and s.organization_id=i.organization_id
 where i.id=p_incident and i.organization_id=p_org
 and (i.project_id is null or s.project_id is null or i.project_id=s.project_id)
 and coalesce(i.project_id,s.project_id) is not distinct from p_project));
$$;
create or replace function public.can_access_ai_conversation(p_conversation_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ai_conversations c where c.id=p_conversation_id
 and public.can_use_ai_context(c.organization_id,c.project_id)
 and berryit_private.ai_incident_matches(c.incident_id,c.organization_id,c.project_id)
 and (not p_write or c.project_id is not null or public.can_use_ai_for_organization(c.organization_id,true)));
$$;
create function public.guard_ai_diagnostic_scope() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.incidents; linked_project uuid;
begin
 if tg_op='UPDATE' and new.incident_id is distinct from old.incident_id then
 raise exception 'AI incident context is immutable' using errcode='42501'; end if;
 if new.incident_id is not null then
 select * into i from public.incidents where id=new.incident_id and organization_id=new.organization_id;
 if not found then raise exception 'Incident context denied' using errcode='42501'; end if;
 select project_id into linked_project from public.infra_services where id=i.service_id and organization_id=i.organization_id;
 if i.project_id is not null and linked_project is not null and i.project_id<>linked_project then
 raise exception 'Inconsistent incident project' using errcode='42501'; end if;
 if coalesce(i.project_id,linked_project) is distinct from new.project_id then
 raise exception 'Incident project mismatch' using errcode='42501'; end if;
 end if;
 return new;
end;
$$;
create trigger ai_diagnostic_scope before insert or update on public.ai_conversations for each row execute function public.guard_ai_diagnostic_scope();
drop policy ai_conversations_select on public.ai_conversations;
drop policy ai_conversations_insert on public.ai_conversations;
drop policy ai_conversations_update on public.ai_conversations;
-- Do not query the new conversation through a STABLE helper here: INSERT
-- RETURNING must see the new row as well, while still checking incident scope.
create policy ai_conversations_select on public.ai_conversations for select to authenticated using(
 public.can_use_ai_context(organization_id,project_id) and berryit_private.ai_incident_matches(incident_id,organization_id,project_id));
create policy ai_conversations_insert on public.ai_conversations for insert to authenticated with check(
 created_by=auth.uid() and public.can_use_ai_context(organization_id,project_id)
 and (project_id is not null or public.can_use_ai_for_organization(organization_id,true)));
create policy ai_conversations_update on public.ai_conversations for update to authenticated
 using(public.can_access_ai_conversation(id,true)) with check(public.can_access_ai_conversation(id,true));
-- Old additive knowledge policies must not expose another project's material.
create policy ai_knowledge_project_bound on public.ai_knowledge_entries as restrictive for all to authenticated
 using(public.can_use_ai_context(organization_id,project_id)) with check(public.can_use_ai_context(organization_id,project_id));

create function public.ai_diagnostic_targets() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'organization_id',p.organization_id,'name',p.name) order by p.id)
 from public.support_projects p where public.can_use_ai_context(p.organization_id,p.id)),'[]'::jsonb),
 'incidents',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'organization_id',i.organization_id,'project_id',coalesce(i.project_id,s.project_id),'title',i.title) order by i.id)
 from public.incidents i left join public.infra_services s on s.id=i.service_id and s.organization_id=i.organization_id
 where (i.project_id is null or s.project_id is null or i.project_id=s.project_id)
 and public.can_use_ai_context(i.organization_id,coalesce(i.project_id,s.project_id))),'[]'::jsonb));
$$;

create function public.ai_diagnostic_context(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c public.ai_conversations; facts jsonb:='[]'; part jsonb; missing jsonb;
begin
 select * into c from public.ai_conversations where id=p_conversation;
 if not found or not public.can_access_ai_conversation(c.id,true) or
 (c.project_id is null and c.incident_id is null) then raise exception 'Diagnostic scope denied' using errcode='42501'; end if;
 -- Structured values only: no titles, addresses, config, detail, raw logs,
 -- arbitrary source strings, descriptions or customer correspondence.
 select coalesce(jsonb_agg(x.fact order by x.id),'[]') into part from (
 select i.id,jsonb_build_object('id','INC-'||i.id,'kind','incident','at',coalesce(i.last_seen_at,i.opened_at),
 'text','Incident status='||i.status||'; severity='||i.severity||'; observations='||i.observation_count||
 '; metric='||case when i.metric_key in ('cpu_percent','memory_used_percent','memory_available_bytes','disk_used_percent','disk_available_bytes','response_time_ms','containers_running','containers_unhealthy','uptime_seconds') then i.metric_key else 'unknown' end,
 'origin','monitoring-registry') fact
 from public.incidents i left join public.infra_services s on s.id=i.service_id and s.organization_id=i.organization_id
 where i.organization_id=c.organization_id
 and (i.project_id is null or s.project_id is null or i.project_id=s.project_id)
 and ((c.incident_id is not null and i.id=c.incident_id) or (c.incident_id is null and coalesce(i.project_id,s.project_id)=c.project_id))
 order by i.id limit 20) x;
 facts:=facts||part;
 select coalesce(jsonb_agg(x.fact order by x.id),'[]') into part from (
 select distinct on (h.service_id) h.id,jsonb_build_object('id','STATUS-'||h.id,'kind','status','at',h.checked_at,
 'text','Service '||h.service_id||': status='||h.status_key||coalesce('; latency_ms='||h.latency_ms,''),
 'origin',h.source,'stale',h.checked_at<now()-interval '15 minutes') fact
 from public.service_status_checks h join public.infra_services s on s.id=h.service_id and s.organization_id=h.organization_id
 where h.organization_id=c.organization_id and s.project_id=c.project_id
 and (c.incident_id is null or exists(select 1 from public.incidents i where i.id=c.incident_id and i.service_id=s.id))
 order by h.service_id,h.checked_at desc,h.id limit 30) x;
 facts:=facts||part;
 select coalesce(jsonb_agg(x.fact order by x.id),'[]') into part from (
 select distinct on (m.service_id,m.metric_key) m.id,jsonb_build_object('id','METRIC-'||m.id,'kind','metric','at',m.collected_at,
 'text','Service '||m.service_id||': '||m.metric_key||'='||m.value,
 'origin',case when m.source in ('agent','docker','http','github','vercel','supabase') then m.source else 'registered-collector' end,
 'stale',m.collected_at<now()-interval '15 minutes') fact
 from public.monitoring_samples m join public.infra_services s on s.id=m.service_id and s.organization_id=m.organization_id
 where m.organization_id=c.organization_id and s.project_id=c.project_id
 and m.metric_key in ('cpu_percent','memory_used_percent','memory_available_bytes','disk_used_percent','disk_available_bytes','response_time_ms','containers_running','containers_unhealthy','uptime_seconds')
 and (c.incident_id is null or exists(select 1 from public.incidents i where i.id=c.incident_id and i.service_id=s.id))
 order by m.service_id,m.metric_key,m.collected_at desc,m.id limit 50) x;
 facts:=facts||part;
 -- Shared-node samples may concern other customers and are never included.
 select coalesce(jsonb_agg(x.fact order by x.id),'[]') into part from (
 select e.id,jsonb_build_object('id','EVENT-'||e.id,'kind','event','at',e.created_at,
 'text','Incident '||i.id||': event='||e.event_type||'; actor_kind='||e.actor_kind,
 'origin','incident-audit') fact
 from public.incident_events e join public.incidents i on i.id=e.incident_id and i.organization_id=e.organization_id
 left join public.infra_services s on s.id=i.service_id and s.organization_id=i.organization_id
 where i.organization_id=c.organization_id and (i.project_id is null or s.project_id is null or i.project_id=s.project_id)
 and ((c.incident_id is not null and i.id=c.incident_id) or (c.incident_id is null and coalesce(i.project_id,s.project_id)=c.project_id))
 order by e.created_at desc,e.id limit 20) x;
 facts:=facts||part;
 missing:=jsonb_build_array('Inga direkta serverkontroller har utförts. Endast registrerade observationer ingår.',
 'Råloggar och fria feltexter är inte anslutna för AI-delning; inga serverloggar har undersökts.',
 'Nodövergripande mätvärden utelämnas för att skydda andra projekt på delade servrar.',
 'Underlaget är begränsat till högst 20 incidenter, 30 tjänstestatusar, 50 senaste tjänstemätvärden och 20 händelser.');
 if not exists(select 1 from jsonb_array_elements(facts) f where f->>'kind'='status') then missing:=missing||jsonb_build_array('Ingen registrerad tjänstestatus finns i valt scope.'); end if;
 if not exists(select 1 from jsonb_array_elements(facts) f where f->>'kind'='metric') then missing:=missing||jsonb_build_array('Inga tillgängliga tjänstemätvärden finns i valt scope.'); end if;
 if exists(select 1 from jsonb_array_elements(facts) f where (f->>'stale')::boolean) then missing:=missing||jsonb_build_array('Föråldrade observationer är märkta stale; de bevisar inte aktuell driftstatus.'); end if;
 return jsonb_build_object('version',1,'organizationId',c.organization_id,'projectId',c.project_id,'incidentId',c.incident_id,'facts',facts,'missingInformation',missing);
end;
$$;
revoke all on function public.can_use_ai_context(uuid,uuid),public.ai_diagnostic_targets(),public.ai_diagnostic_context(uuid),public.guard_ai_diagnostic_scope() from public,anon;
grant execute on function public.can_use_ai_context(uuid,uuid),public.ai_diagnostic_targets(),public.ai_diagnostic_context(uuid) to authenticated;
revoke all on function public.guard_ai_diagnostic_scope() from authenticated;
revoke all on function berryit_private.ai_incident_matches(uuid,uuid,uuid) from public,anon;
grant execute on function berryit_private.ai_incident_matches(uuid,uuid,uuid) to authenticated;

-- Preserve the existing workflow guard; extend only its AI self-requester exception
-- to a separately authorized project technician. No other customer identity is allowed.
create or replace function public.guard_support_ticket_workflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare customer_org uuid;
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.reference is distinct from old.reference
      or new.requester_id is distinct from old.requester_id or new.organization_id is distinct from old.organization_id
      or new.source is distinct from old.source or new.external_id is distinct from old.external_id
      or new.description is distinct from old.description or new.subject is distinct from old.subject
      or new.contact_name is distinct from old.contact_name or new.contact_email is distinct from old.contact_email
      or new.contact_phone is distinct from old.contact_phone or new.created_at is distinct from old.created_at then
      raise exception 'Ärendets kundidentitet och originaluppgifter är oföränderliga' using errcode='42501';
    end if;
  else
    select p.organization_id into customer_org from public.profiles p where p.id=new.requester_id and p.is_active;
    if not found then raise exception 'Kunden saknas eller är inaktiv' using errcode='42501'; end if;
    -- AI/API may use the acting technician as requester in their delegated
    -- scope. This is not permission to select another customer's identity.
    if new.organization_id is distinct from customer_org and not (
      new.source='api' and (public.is_trusted_backend() or
        (new.requester_id=auth.uid() and (public.is_staff() or public.has_support_permission('tickets.write',new.organization_id) or (new.project_id is not null and new.external_channel='onarly-ai' and public.has_resource_permission('tickets.write',new.organization_id,new.project_id)))))
    ) then
      raise exception 'Ärende och kund tillhör olika organisationer' using errcode='42501';
    end if;
    if auth.uid() is not null then
      new.reference:=null; new.created_at:=clock_timestamp();
      new.first_response_at:=null; new.resolved_at:=null; new.closed_at:=null;
    end if;
  end if;
  if new.assignee_id is not null and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id)
    and not berryit_private.technician_eligible(new.assignee_id,new.organization_id) then
    raise exception 'Teknikern saknar aktiv behörighet i ärendets scope' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.status_key in ('lost','stangt') and new.status_key not in ('lost','stangt') then
    if length(btrim(coalesce(new.reopen_reason,''))) not between 3 and 1000 then
      raise exception 'Ange en orsak till återöppningen' using errcode='22023';
    end if;
  else new.reopen_reason:=null; end if;
  return new;
end;
$$;
