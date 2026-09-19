-- Teachers upload mission-question visuals into a folder owned by their user id.
-- The bucket is public for student rendering, while writes remain owner-scoped.
insert into storage.buckets (id, name, public)
values ('mission-images', 'mission-images', true)
on conflict (id) do update set public = true;

drop policy if exists mission_images_teacher_upload on storage.objects;
create policy mission_images_teacher_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'mission-images'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.classrooms where teacher_id = auth.uid())
);

drop policy if exists mission_images_teacher_delete on storage.objects;
create policy mission_images_teacher_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'mission-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
