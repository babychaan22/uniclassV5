-- Mission attempts and XP belong to the individual student who completes them.
-- Group totals still include every member's redeemed participation points.

alter table public.mission_submissions
  add column if not exists group_member_id uuid references public.group_members(id) on delete cascade;

-- Keep historical submissions available. When the submitting student can be
-- identified, link the historical attempt to that student as well.
update public.mission_submissions s
set group_member_id = ga.group_member_id
from public.group_accounts ga
where s.group_member_id is null
  and ga.user_id = s.graded_by
  and ga.group_id = s.group_id
  and ga.group_member_id is not null;

drop index if exists public.idx_one_submission_per_group_mission;
create unique index if not exists idx_one_submission_per_member_mission
  on public.mission_submissions(mission_id, group_member_id)
  where group_member_id is not null;
create index if not exists idx_mission_submissions_member_created
  on public.mission_submissions(group_member_id, created_date desc);

drop function if exists public.submit_mission(uuid,uuid,numeric,text,uuid);
create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text,
  p_retry_attempt_id uuid default null
)
returns public.mission_submissions language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_account public.group_accounts%rowtype;
  v_m public.missions%rowtype;
  v_group public.groups%rowtype;
  v_result public.mission_submissions%rowtype;
  v_answers jsonb;
  v_raw_answer_key jsonb;
  v_answer_key jsonb;
  v_questions jsonb;
  v_score numeric;
  v_max numeric;
  v_correct integer;
  v_retry public.mission_retry_attempts%rowtype;
begin
  select * into v_account from public.group_accounts
  where user_id = v_user and group_id = p_group_id and is_approved = true
  limit 1;
  if not found or v_account.group_member_id is null then
    raise exception 'Approved student account required';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  select * into v_m from public.missions
  where id = p_mission_id and is_active = true
    and (classroom_id = v_group.classroom_id or (
      (applies_to_all_classes or v_group.classroom_id = any(target_classroom_ids))
      and exists (select 1 from public.classrooms c where c.id = v_group.classroom_id and c.teacher_id = missions.created_by)
    ))
  for update;
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;

  begin
    v_answers := coalesce(nullif(p_answers, '')::jsonb, '{}'::jsonb);
  exception when others then
    raise exception 'Invalid answers';
  end;
  v_questions := v_m.ai_content::jsonb -> 'questions';
  v_raw_answer_key := v_m.answer_key::jsonb;
  v_answer_key := case when jsonb_typeof(v_raw_answer_key) = 'object' and v_raw_answer_key ? 'answers'
    then v_raw_answer_key -> 'answers' else v_raw_answer_key end;

  if p_retry_attempt_id is not null then
    select * into v_retry from public.mission_retry_attempts
    where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id
      and created_by = v_user and completed_at is null
    for update;
    if not found then raise exception 'Retry attempt is unavailable'; end if;
    v_questions := v_retry.questions;
    v_answer_key := v_retry.answer_key;
  end if;

  if v_m.formative_type in ('true_false', 'multiple_choice') then
    select count(*) into v_correct
    from jsonb_array_elements(v_questions) with ordinality as q(item, idx)
    where (v_answers -> ((q.idx - 1)::text)) = (v_answer_key -> ((q.idx - 1)::integer));
    v_score := v_correct;
    v_max := jsonb_array_length(v_questions);
  elsif v_m.formative_type = 'drag_drop' then
    select count(*) into v_correct from jsonb_each(v_answer_key) a(key, value)
    where v_answers ->> a.key = trim(both '"' from a.value::text);
    v_score := v_correct;
    select count(*) into v_max from jsonb_object_keys(v_answer_key);
  else
    v_score := greatest(0, least(coalesce(p_score, 0), v_m.max_score));
    v_max := v_m.max_score;
  end if;

  if p_retry_attempt_id is not null then
    update public.mission_retry_attempts
      set submitted_answers = v_answers, score = v_score, completed_at = now()
      where id = p_retry_attempt_id;
    select * into v_result from public.mission_submissions
      where mission_id = p_mission_id and group_member_id = v_account.group_member_id;
    if not found then raise exception 'Your original mission submission is unavailable'; end if;
    return v_result;
  end if;

  -- First attempt is permanent for scoring. Later submits leave its XP intact.
  insert into public.mission_submissions(
    mission_id, group_id, group_member_id, classroom_id, score, xp_earned, graded_by, answers
  ) values (
    v_m.id, p_group_id, v_account.group_member_id, v_group.classroom_id, v_score,
    greatest(0, round((v_score / nullif(v_max, 0)) * v_m.xp_reward)), v_user, p_answers
  ) on conflict (mission_id, group_member_id) where group_member_id is not null
  do update set
    score = mission_submissions.score,
    xp_earned = mission_submissions.xp_earned,
    graded_by = mission_submissions.graded_by,
    answers = mission_submissions.answers
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.get_mission_submission_review(
  p_mission_id uuid, p_group_id uuid, p_retry_attempt_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_member_id uuid;
  v_m public.missions%rowtype;
  v_submission public.mission_submissions%rowtype;
  v_retry public.mission_retry_attempts%rowtype;
  v_questions jsonb; v_raw_key jsonb; v_key jsonb; v_answers jsonb;
  v_items jsonb := '[]'::jsonb; v_index integer := 0;
  v_question jsonb; v_correct jsonb; v_selected jsonb;
  v_item_key text; v_item_value jsonb; v_expected text; v_selected_category text; v_max integer;
begin
  select group_member_id into v_member_id from public.group_accounts
  where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;
  select * into v_m from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found'; end if;

  if p_retry_attempt_id is null then
    select * into v_submission from public.mission_submissions
      where mission_id = p_mission_id and group_member_id = v_member_id;
    if not found then raise exception 'Submit the mission before viewing feedback'; end if;
    v_questions := v_m.ai_content::jsonb -> 'questions';
    v_raw_key := v_m.answer_key::jsonb;
    v_key := case when jsonb_typeof(v_raw_key) = 'object' and v_raw_key ? 'answers'
      then v_raw_key -> 'answers' else v_raw_key end;
    v_answers := v_submission.answers::jsonb;
  else
    select * into v_retry from public.mission_retry_attempts
      where id = p_retry_attempt_id and mission_id = p_mission_id and group_id = p_group_id
        and created_by = v_user and completed_at is not null;
    if not found then raise exception 'Retry feedback is unavailable'; end if;
    v_questions := v_retry.questions; v_key := v_retry.answer_key; v_answers := v_retry.submitted_answers;
  end if;

  if v_m.formative_type = 'drag_drop' then
    for v_item_key, v_item_value in select key, value from jsonb_each(v_key) loop
      v_expected := trim(both '"' from v_item_value::text);
      v_selected_category := v_answers ->> v_item_key;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'item', v_item_key, 'selected', v_selected_category, 'correct_answer', v_expected,
        'correct', v_selected_category = v_expected,
        'explanation', coalesce(v_m.ai_content::jsonb -> 'feedback' ->> v_item_key, format('%s belongs in %s.', v_item_key, v_expected))
      ));
    end loop;
    select count(*) into v_max from jsonb_object_keys(v_key);
    return jsonb_build_object('items', v_items, 'score', coalesce(v_retry.score, v_submission.score, 0), 'maxScore', v_max);
  end if;

  for v_question in select value from jsonb_array_elements(v_questions) loop
    v_correct := v_key -> v_index;
    v_selected := v_answers -> v_index;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'index', v_index, 'correct', v_selected = v_correct, 'selected', v_selected,
      'correct_answer', v_correct,
      'explanation', coalesce(v_question ->> 'explanation', 'Review this idea with your teacher or lesson notes.')
    ));
    v_index := v_index + 1;
  end loop;
  return jsonb_build_object('items', v_items, 'score', coalesce(v_retry.score, v_submission.score, 0), 'maxScore', jsonb_array_length(v_questions));
end;
$$;

create or replace function public.start_mission_retry(p_mission_id uuid, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_member_id uuid; v_m public.missions%rowtype;
  v_variant jsonb; v_attempt public.mission_retry_attempts%rowtype; v_group public.groups%rowtype;
begin
  select group_member_id into v_member_id from public.group_accounts
    where user_id = v_user and group_id = p_group_id and is_approved = true limit 1;
  if v_member_id is null then raise exception 'Approved student account required'; end if;
  select * into v_group from public.groups where id = p_group_id;
  if not exists(select 1 from public.mission_submissions where mission_id = p_mission_id and group_member_id = v_member_id) then
    raise exception 'Submit your mission before starting a retry';
  end if;
  select * into v_m from public.missions where id = p_mission_id and is_active = true;
  if not found or v_m.formative_type not in ('true_false', 'multiple_choice') then raise exception 'A fresh retry is not available for this mission type'; end if;
  v_variant := case when jsonb_typeof(v_m.answer_key::jsonb) = 'object' then v_m.answer_key::jsonb -> 'retry_variants' -> 0 else null end;
  if v_variant is null or jsonb_array_length(coalesce(v_variant -> 'questions', '[]'::jsonb)) = 0 then raise exception 'This mission has no generated retry variant. Ask your teacher to create a new mission.'; end if;
  insert into public.mission_retry_attempts(mission_id, group_id, classroom_id, created_by, questions, answer_key)
    values(p_mission_id, p_group_id, v_group.classroom_id, v_user, v_variant -> 'questions', v_variant -> 'answers')
    returning * into v_attempt;
  return jsonb_build_object('attemptId', v_attempt.id, 'questions', v_attempt.questions);
end;
$$;

drop function if exists public.redeem_mission_points(numeric);
create or replace function public.redeem_mission_points(p_amount numeric, p_classroom_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_account public.group_accounts%rowtype;
  v_earned numeric; v_redeemed numeric; v_points integer;
begin
  if p_amount is null or p_amount < 10 or mod(p_amount, 10) <> 0 then raise exception 'Redeem XP in multiples of 10'; end if;
  select * into v_account from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true limit 1;
  if not found or v_account.group_member_id is null then raise exception 'Approved classroom account required'; end if;
  perform 1 from public.group_members where id = v_account.group_member_id for update;
  select coalesce(sum(xp_earned), 0) into v_earned from public.mission_submissions where group_member_id = v_account.group_member_id;
  select coalesce(sum(xp_spent), 0) into v_redeemed from public.participation_logs
    where group_member_id = v_account.group_member_id and event_type = 'mission_redemption';
  if p_amount > v_earned - v_redeemed then raise exception 'Not enough personal mission XP available'; end if;
  v_points := trunc(p_amount / 10)::integer;
  insert into public.participation_logs(
    group_member_id, group_id, classroom_id, points_awarded, xp_spent, event_type, multiplier, recipient_type, note
  ) values (
    v_account.group_member_id, v_account.group_id, v_account.classroom_id, v_points, p_amount,
    'mission_redemption', 1, 'member', format('%s XP redeemed for %s participation point%s', p_amount::integer, v_points, case when v_points = 1 then '' else 's' end)
  );
  return jsonb_build_object('xpAmount', p_amount::integer, 'pointsAwarded', v_points, 'groupId', v_account.group_id, 'memberId', v_account.group_member_id);
end;
$$;

-- Keep the already-deployed client working during the short interval before
-- its matching frontend release arrives. The new client always sends the
-- classroom id; this compatibility wrapper preserves the previous behavior.
create or replace function public.redeem_mission_points(p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_classroom_id uuid;
begin
  select classroom_id into v_classroom_id from public.group_accounts
  where user_id = auth.uid() and is_approved = true
  order by created_date asc limit 1;
  if v_classroom_id is null then raise exception 'Approved classroom account required'; end if;
  return public.redeem_mission_points(p_amount, v_classroom_id);
end;
$$;

revoke all on function public.submit_mission(uuid,uuid,numeric,text,uuid) from public;
revoke all on function public.get_mission_submission_review(uuid,uuid,uuid) from public;
revoke all on function public.start_mission_retry(uuid,uuid) from public;
revoke all on function public.redeem_mission_points(numeric,uuid) from public;
revoke all on function public.redeem_mission_points(numeric) from public;
grant execute on function public.submit_mission(uuid,uuid,numeric,text,uuid) to authenticated;
grant execute on function public.get_mission_submission_review(uuid,uuid,uuid) to authenticated;
grant execute on function public.start_mission_retry(uuid,uuid) to authenticated;
grant execute on function public.redeem_mission_points(numeric,uuid) to authenticated;
grant execute on function public.redeem_mission_points(numeric) to authenticated;
