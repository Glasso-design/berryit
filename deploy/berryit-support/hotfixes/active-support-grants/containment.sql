-- Safe fallback, NOT restoration of the vulnerable body/anonymous ACL.
-- Separately approved operator action only; may interrupt direct client RPCs.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';
revoke all on function public.active_support_grants(uuid),public.max_support_rank(uuid) from public,anon,authenticated;
grant execute on function public.active_support_grants(uuid),public.max_support_rank(uuid) to service_role;
insert into public.support_admin_audit(action,target_type,target_id,scope,reason,metadata)
values('security.hotfix.contained','function','active_support_grants(uuid)','global',
 'Approved fail-closed containment; unsafe helper definition and anonymous ACL not restored',
 jsonb_build_object('change_id','PASS3B-active-support-grants'));
commit;
