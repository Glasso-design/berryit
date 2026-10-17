-- Existing upgrade-2c fixture, shared by both upgrade suites. Synthetic only.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'kund@example.com'),
  ('10000000-0000-0000-0000-000000000002', 'tekniker@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'superadmin@example.test');
insert into public.organizations (id, name) values
  ('20000000-0000-0000-0000-000000000001', 'Exempelbolaget AB');
update public.profiles set organization_id = '20000000-0000-0000-0000-000000000001'
  where id = '10000000-0000-0000-0000-000000000001';
update public.profiles set role = 'technician' where id = '10000000-0000-0000-0000-000000000002';
insert into public.support_role_grants (grantee_id, role_key, scope, reason)
  values ('10000000-0000-0000-0000-000000000003', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'global', 'Agarbeslut');
insert into public.tickets (organization_id, requester_id, subject, description, category_key)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
          'Skrivaren svarar inte', 'Skrivaren hittar inte natverket langre.', 'skrivare');
insert into public.onarly_support_entitlements (organization_id, product_key, entitlement, reason)
  values ('20000000-0000-0000-0000-000000000001', 'onarly_desk', 'remote_support', 'Kundavtal');
