-- BERRYiT Support Desk – PASS 1: privat lagring för bilagor.
--
-- Bucket "ticket-attachments" är privat: filer hämtas via signed URLs från
-- servern, aldrig via publika länkar. Sökväg: tickets/<ticket_id>/<fil>.
--
-- Körs bara när storage-schemat finns (dvs. i Supabase). Vid lokal validering
-- mot ren PostgreSQL hoppas blocket över.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    raise notice 'storage-schemat saknas – hoppar över bucket och storage-policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'ticket-attachments',
    'ticket-attachments',
    false,
    26214400,
    array[
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
      'application/pdf', 'text/plain', 'text/csv',
      'application/zip',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-outlook',
      'message/rfc822'
    ]
  )
  on conflict (id) do nothing;

  -- Läsning: personal ser allt i bucketen; kunden endast filer som är
  -- registrerade som kundsynliga bilagor på ett ärende hen får se.
  execute $policy$
    create policy ticket_attachments_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'ticket-attachments'
        and (
          public.is_staff()
          or exists (
            select 1
              from public.ticket_attachments a
             where a.storage_path = storage.objects.name
               and a.visibility = 'customer'
               and public.can_view_ticket(a.ticket_id)
          )
        )
      )
  $policy$;

  -- Uppladdning: endast till ett ärende användaren får se, och sökvägen måste
  -- peka på just det ärendet (tickets/<ticket_id>/...).
  execute $policy$
    create policy ticket_attachments_upload on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'ticket-attachments'
        and (storage.foldername(name))[1] = 'tickets'
        and public.can_view_ticket(((storage.foldername(name))[2])::uuid)
      )
  $policy$;

  execute $policy$
    create policy ticket_attachments_staff_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'ticket-attachments' and public.is_staff())
  $policy$;
end;
$$;
