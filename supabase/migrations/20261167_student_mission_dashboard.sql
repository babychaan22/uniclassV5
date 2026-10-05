-- 20261167 — deliver only the mission data a student is allowed to see.

create or replace function public.get_student_missions(p_classroom_id uuid)
returns setof jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_member_id uuid;
  v_status text;
begin
  select group_member_id into v_member_id from public.group_accounts
  where user_id = auth.uid() and classroom_id = p_classroom_id and is_approved = true
  order by created_date limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;
  v_status := public.student_mission_status(p_classroom_id, v_member_id);

  return query
  select public.sanitize_mission_for_student(m)
  from public.missions m
  where (
      ((m.is_active and m.archived_at is null)
        or exists (select 1 from public.mission_submissions s where s.mission_id = m.id and s.group_member_id = v_member_id))
    )
    and (
      m.applies_to_all_classes
      or (cardinality(m.target_classroom_ids) > 0 and p_classroom_id = any(m.target_classroom_ids))
      or (not m.applies_to_all_classes and cardinality(m.target_classroom_ids) = 0 and m.classroom_id = p_classroom_id)
    )
    and (
      (m.mission_source = 'daily_foundation' and m.classroom_id is null and m.approval_status = 'approved'
       and coalesce((select public.foundation_class_serves_power_up(c.subject) from public.classrooms c where c.id = p_classroom_id), false))
      or exists (select 1 from public.classrooms c where c.id = p_classroom_id and c.teacher_id = m.created_by)
    )
    -- Completed work stays available for review. New targeted work is only
    -- returned when the server's current learner status is in its audience.
    and (m.mission_source = 'daily_foundation'
      or exists (select 1 from public.mission_submissions s where s.mission_id = m.id and s.group_member_id = v_member_id)
      or coalesce(m.target_statuses, array['On Track', 'Developing', 'At Risk']) @> array[v_status]);
end;
$$;

create or replace function public.get_student_mission_dashboard(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_account public.group_accounts%rowtype;
  v_missions jsonb;
  v_submissions jsonb;
  v_reviews jsonb;
  v_earned numeric;
  v_redeemed numeric;
begin
  select * into v_account from public.group_accounts
  where user_id = auth.uid() and classroom_id = p_classroom_id and is_approved = true
  order by created_date limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved student account required'; end if;

  select coalesce(jsonb_agg(mission), '[]'::jsonb) into v_missions
  from public.get_student_missions(p_classroom_id) mission;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_date desc), '[]'::jsonb), coalesce(sum(s.xp_earned), 0)
    into v_submissions, v_earned
  from public.mission_submissions s
  where s.classroom_id = p_classroom_id and s.group_member_id = v_account.group_member_id;
  select coalesce(sum(l.xp_spent), 0) into v_redeemed
  from public.participation_logs l
  where l.classroom_id = p_classroom_id and l.group_member_id = v_account.group_member_id and l.event_type = 'mission_redemption';
  select coalesce(jsonb_agg(to_jsonb(r) order by r.next_review_at), '[]'::jsonb) into v_reviews
  from (select * from public.learning_reviews where user_id = auth.uid() order by next_review_at limit 20) r;

  return jsonb_build_object(
    'classification', public.student_mission_status(p_classroom_id, v_account.group_member_id),
    'missions', v_missions, 'submissions', v_submissions, 'reviews', v_reviews,
    'earned', v_earned, 'redeemed', v_redeemed
  );
end;
$$;

revoke all on function public.get_student_missions(uuid) from public;
grant execute on function public.get_student_missions(uuid) to authenticated;
revoke all on function public.get_student_mission_dashboard(uuid) from public;
grant execute on function public.get_student_mission_dashboard(uuid) to authenticated;
