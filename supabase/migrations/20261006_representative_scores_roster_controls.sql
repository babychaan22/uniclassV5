-- Representatives need a validated server path for creating an activity and
-- recording its evidence. The old UI attempted a direct activity insert, but
-- activities are teacher-owned under RLS, so uploads failed before storage ran.

drop policy if exists rep_insert_activity_scores on public.activity_scores;
create policy rep_insert_activity_scores on public.activity_scores for insert to authenticated
  with check (
    auth_rep_group_id(classroom_id) = group_id
    and exists (
      select 1 from public.group_members gm
      where gm.id = activity_scores.group_member_id and gm.group_id = activity_scores.group_id
    )
  );

drop policy if exists rep_update_activity_scores on public.activity_scores;
create policy rep_update_activity_scores on public.activity_scores for update to authenticated
  using (auth_rep_group_id(classroom_id) = group_id)
  with check (auth_rep_group_id(classroom_id) = group_id);

create or replace function public.ensure_group_activity(
  p_classroom_id uuid,
  p_group_id uuid,
  p_activity_number integer,
  p_max_score numeric
)
returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity public.activities%rowtype;
begin
  if not exists (
    select 1 from public.group_accounts ga
    where ga.user_id = auth.uid()
      and ga.classroom_id = p_classroom_id
      and ga.group_id = p_group_id
      and ga.is_approved = true
      and ga.is_representative = true
  ) then
    raise exception 'Only the approved representative for this group can create an activity';
  end if;
  if p_activity_number < 1 or p_max_score <= 0 then
    raise exception 'Activity number and maximum score must be positive';
  end if;

  select * into v_activity
  from public.activities
  where classroom_id = p_classroom_id and activity_number = p_activity_number
  order by created_date asc
  limit 1;
  if found then return v_activity; end if;

  insert into public.activities(classroom_id, activity_number, title, max_score)
  values (p_classroom_id, p_activity_number, 'Activity ' || p_activity_number, p_max_score)
  returning * into v_activity;
  return v_activity;
end;
$$;

revoke all on function public.ensure_group_activity(uuid, uuid, integer, numeric) from public;
grant execute on function public.ensure_group_activity(uuid, uuid, integer, numeric) to authenticated;

create or replace function public.record_activity_evidence(
  p_activity_id uuid,
  p_group_member_id uuid,
  p_storage_path text,
  p_original_name text,
  p_file_size integer,
  p_mime_type text default 'image/webp'
)
returns public.activity_evidence
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.group_accounts%rowtype;
  v_activity public.activities%rowtype;
  v_result public.activity_evidence%rowtype;
begin
  select * into v_activity from public.activities where id = p_activity_id;
  if not found then raise exception 'Activity not found'; end if;
  select * into v_account from public.group_accounts
    where user_id = auth.uid()
      and classroom_id = v_activity.classroom_id
      and is_approved = true
    order by created_date asc limit 1;
  if not found then raise exception 'Approved class membership required'; end if;
  if not exists (
    select 1 from public.group_members
    where id = p_group_member_id and group_id = v_account.group_id and classroom_id = v_account.classroom_id
  ) then raise exception 'Select a member from your group'; end if;
  if not v_account.is_representative and v_account.group_member_id <> p_group_member_id then
    raise exception 'Only the representative can upload proof for another member';
  end if;
  if p_storage_path !~ ('^' || v_account.group_id::text || '/') then
    raise exception 'Evidence file must be stored in your group folder';
  end if;

  insert into public.activity_evidence(
    classroom_id, group_id, group_member_id, activity_id, uploaded_by,
    storage_path, original_name, file_size, mime_type
  ) values (
    v_account.classroom_id, v_account.group_id, p_group_member_id, p_activity_id, auth.uid(),
    p_storage_path, nullif(trim(p_original_name), ''), p_file_size, coalesce(nullif(trim(p_mime_type), ''), 'image/webp')
  ) returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.record_activity_evidence(uuid, uuid, text, text, integer, text) from public;
grant execute on function public.record_activity_evidence(uuid, uuid, text, text, integer, text) to authenticated;

create or replace function public.set_group_representative(p_group_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.group_accounts%rowtype;
begin
  select * into v_target from public.group_accounts where id = p_group_account_id for update;
  if not found then raise exception 'Student account not found'; end if;
  if not auth_is_teacher_of(v_target.classroom_id) then raise exception 'Only the class teacher can change the representative'; end if;
  if not v_target.is_approved then raise exception 'Approve this student before making them representative'; end if;
  update public.group_accounts set is_representative = false where group_id = v_target.group_id;
  update public.group_accounts set is_representative = true where id = v_target.id;
  return jsonb_build_object('updated', true, 'groupId', v_target.group_id, 'groupAccountId', v_target.id);
end;
$$;

revoke all on function public.set_group_representative(uuid) from public;
grant execute on function public.set_group_representative(uuid) to authenticated;

create or replace function public.remove_roster_member(p_group_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.group_members%rowtype;
  v_account public.group_accounts%rowtype;
  v_paths jsonb := '[]'::jsonb;
begin
  select * into v_member from public.group_members where id = p_group_member_id for update;
  if not found then raise exception 'Roster member not found'; end if;
  if not auth_is_teacher_of(v_member.classroom_id) then raise exception 'Only the class teacher can remove a roster member'; end if;

  select * into v_account from public.group_accounts where group_member_id = v_member.id limit 1;
  if found then return public.remove_student_from_class(v_account.id); end if;

  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths
    from public.activity_evidence where group_member_id = v_member.id;
  delete from public.activity_evidence where group_member_id = v_member.id;
  delete from public.activity_scores where group_member_id = v_member.id;
  delete from public.attendances where group_member_id = v_member.id;
  delete from public.teacher_assessments where group_member_id = v_member.id;
  delete from public.participation_logs where group_member_id = v_member.id;
  delete from public.badges where member_id = v_member.id;
  update public.qr_codes set used_by_member_id = null where used_by_member_id = v_member.id;
  delete from public.group_members where id = v_member.id;
  return jsonb_build_object('removed', true, 'rosterMemberDeleted', true, 'evidencePaths', v_paths);
end;
$$;

revoke all on function public.remove_roster_member(uuid) from public;
grant execute on function public.remove_roster_member(uuid) to authenticated;
