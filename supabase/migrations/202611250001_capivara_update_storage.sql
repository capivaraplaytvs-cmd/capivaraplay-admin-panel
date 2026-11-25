-- APK release parts live in a public-read bucket. Writes and cleanup are admin-only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'capivara-updates',
  'capivara-updates',
  true,
  47185920,
  array['application/octet-stream', 'application/vnd.android.package-archive']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Capivara update parts are readable" on storage.objects;
create policy "Capivara update parts are readable"
on storage.objects for select to public
using (bucket_id = 'capivara-updates');

drop policy if exists "Capivara admins upload update parts" on storage.objects;
create policy "Capivara admins upload update parts"
on storage.objects for insert to authenticated
with check (bucket_id = 'capivara-updates' and public.is_capivara_panel_admin());

drop policy if exists "Capivara admins delete update parts" on storage.objects;
create policy "Capivara admins delete update parts"
on storage.objects for delete to authenticated
using (bucket_id = 'capivara-updates' and public.is_capivara_panel_admin());
