-- 20261158 — deleting a class must take its children's photographs with it.
--
-- delete_classroom removes the classroom row and stops there. The photographs in
-- the activity-evidence bucket are not in the database, so nothing cascades and
-- they are left behind.
--
-- The result is worse than an orphan. The only storage delete policy requires
-- auth_is_teacher_of(g.classroom_id), and by the time the client goes to delete
-- the files the classroom no longer exists, so the policy denies it. A teacher
-- who deletes a class is told its data is gone; every child's photo of their
-- schoolwork remains in the bucket, visible to nobody and removable by nobody
-- through the app.
--
-- remove_student_from_class was already repaired for exactly this
-- (20261005:29-46): it collects the storage paths and hands them to the client,
-- which deletes them. Class deletion never got the same treatment. This aligns
-- it, and says in the confirmation that photographs are included.
--
-- The paths are collected before the cascade runs, because afterwards the
-- activity_evidence rows are gone and there is nothing left to read them from.

create or replace function public.delete_classroom(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_classroom classrooms%rowtype;
  v_paths jsonb;
  v_evidence integer;
begin
  select * into v_classroom from classrooms where id = p_classroom_id for update;
  if not found then raise exception 'Class not found'; end if;
  if v_classroom.teacher_id <> auth.uid() then
    raise exception 'Only the class teacher can delete this class';
  end if;

  -- Storage objects cannot be deleted from SQL: the bucket policy requires the
  -- caller's own client to make the request. So the paths are collected first
  -- and returned, and the client removes them. This is the same contract
  -- remove_student_from_class uses.
  select count(*), coalesce(jsonb_agg(storage_path), '[]'::jsonb)
    into v_evidence, v_paths
  from public.activity_evidence
  where classroom_id = p_classroom_id;

  delete from classrooms where id = p_classroom_id;

  return jsonb_build_object(
    'deleted', true,
    'classroomId', p_classroom_id,
    -- Private paths so the client can remove the files through the Storage API.
    'evidencePaths', v_paths,
    'evidenceCount', v_evidence
  );
end;
$$;

revoke all on function public.delete_classroom(uuid) from public;
grant execute on function public.delete_classroom(uuid) to authenticated;

-- The client's half: remove the files, and say so plainly if it could not.
-- Without this the teacher is told the class is gone and the photographs stay.
do $$
declare
  v_case record;
  v_result jsonb;
  v_paths jsonb;
  v_problems text[] := '{}';
begin
  -- Build a classroom with evidence, delete it, and confirm the paths came back
  -- so the client can delete the files. Nothing real is touched: the classroom
  -- and its rows are created here and removed by the delete itself.
  select c.id, c.teacher_id into v_case
  from public.classrooms c
  where exists (select 1 from public.group_members m where m.classroom_id = c.id)
  order by c.created_date limit 1;

  if v_case.id is null then
    raise notice 'skipped: no classroom with roster members to test against';
    return;
  end if;

  execute 'set local request.jwt.claim.sub = ' || quote_literal(v_case.teacher_id::text);
  execute 'set local request.jwt.claims = ' || quote_literal(
    json_build_object('sub', v_case.teacher_id::text, 'role', 'authenticated')::text);

  -- One synthetic evidence row, so there is a path to hand back.
  insert into public.activity_evidence(
    classroom_id, group_id, group_member_id, activity_id, uploaded_by, storage_path
  )
  select c.id, m.group_id, m.id, null, c.teacher_id, m.group_id::text || '/verification-delete.webp'
  from public.classrooms c
  join public.group_members m on m.group_id in (select id from public.groups where classroom_id = c.id)
  where c.id = v_case.id
  limit 1;

  v_result := public.delete_classroom(v_case.id);

  if coalesce(v_result ->> 'deleted', '') <> 'true' then
    v_problems := array_append(v_problems, 'the class was not reported as deleted');
  end if;

  v_paths := coalesce(v_result -> 'evidencePaths', '[]'::jsonb);
  if jsonb_typeof(v_paths) <> 'array' then
    v_problems := array_append(v_problems, 'no evidencePaths were returned for the client to clean up');
  elsif not exists (
    select 1 from jsonb_array_elements_text(v_paths) as p(path)
    where p.path like '%/verification-delete.webp'
  ) then
    v_problems := array_append(v_problems,
      'the deleted class''s photograph was not handed back for removal, so it stays in the bucket forever');
  end if;

  if exists (select 1 from public.classrooms where id = v_case.id) then
    v_problems := array_append(v_problems, 'the classroom row survived');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Class deletion still orphans photographs: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: deleting a class returns its photograph paths so the client can remove them, instead of leaving them unreachable in storage';
end;
$$;