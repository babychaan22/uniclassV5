-- Save a manual group grade and the corresponding individual wallet entries
-- atomically. Historical group grades are intentionally not backfilled.
create or replace function public.grade_manual_mission_group(p_mission_id uuid, p_group_id uuid, p_score numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_group public.groups%rowtype; v_mission public.missions%rowtype;
  v_group_submission uuid; v_xp numeric; v_count integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_group from public.groups where id = p_group_id;
  if not found or not public.auth_is_teacher_of(v_group.classroom_id) then raise exception 'Teacher access to this classroom is required'; end if;
  select * into v_mission from public.missions where id = p_mission_id and created_by = v_user and formative_type = 'manual'
    and (classroom_id = v_group.classroom_id or applies_to_all_classes or v_group.classroom_id = any(target_classroom_ids));
  if not found then raise exception 'Manual mission is not assigned to this class'; end if;
  if p_score is null or p_score < 0 or p_score > v_mission.max_score or v_mission.max_score <= 0 then raise exception 'Score must be between zero and the maximum score'; end if;
  v_xp := greatest(0, round((p_score / v_mission.max_score) * v_mission.xp_reward));
  perform pg_advisory_xact_lock(hashtextextended(p_mission_id::text || ':' || p_group_id::text, 0));
  select id into v_group_submission from public.mission_submissions where mission_id = p_mission_id and group_id = p_group_id and group_member_id is null order by created_date limit 1;
  if v_group_submission is null then
    insert into public.mission_submissions(mission_id, group_id, classroom_id, score, xp_earned, graded_by)
    values (p_mission_id, p_group_id, v_group.classroom_id, p_score, v_xp, v_user);
  else
    update public.mission_submissions set score = p_score, xp_earned = v_xp, graded_by = v_user where id = v_group_submission;
  end if;
  insert into public.mission_submissions(mission_id, group_id, group_member_id, classroom_id, score, xp_earned, graded_by)
    select p_mission_id, p_group_id, gm.id, v_group.classroom_id, p_score, v_xp, v_user
    from public.group_members gm where gm.group_id = p_group_id
  on conflict (mission_id, group_member_id) where group_member_id is not null
    do update set score = excluded.score, xp_earned = excluded.xp_earned, graded_by = excluded.graded_by;
  get diagnostics v_count = row_count;
  return jsonb_build_object('score', p_score, 'xpPerStudent', v_xp, 'students', v_count);
end;
$$;
revoke all on function public.grade_manual_mission_group(uuid, uuid, numeric) from public;
grant execute on function public.grade_manual_mission_group(uuid, uuid, numeric) to authenticated;
