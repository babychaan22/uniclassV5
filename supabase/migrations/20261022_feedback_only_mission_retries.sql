-- A retry is formative feedback only. The group's recorded mission score and
-- XP always remain the first submitted attempt; retry results are stored in
-- mission_retry_attempts for private review only.
drop function if exists public.submit_mission(uuid,uuid,numeric,text,uuid);
create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text,
  p_retry_attempt_id uuid default null
)
returns public.mission_submissions language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_m public.missions%rowtype; v_group public.groups%rowtype; v_result public.mission_submissions%rowtype;
  v_answers jsonb; v_raw_answer_key jsonb; v_answer_key jsonb; v_questions jsonb; v_score numeric; v_max numeric; v_correct integer;
  v_retry public.mission_retry_attempts%rowtype;
begin
  select * into v_group from public.groups where id=p_group_id;
  if not found or not exists (select 1 from public.group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true) then raise exception 'You are not approved for this group'; end if;
  select * into v_m from public.missions where id=p_mission_id and is_active=true and (classroom_id=v_group.classroom_id or ((applies_to_all_classes or v_group.classroom_id=any(target_classroom_ids)) and exists(select 1 from public.classrooms c where c.id=v_group.classroom_id and c.teacher_id=missions.created_by))) for update;
  if not found then raise exception 'Mission is not active'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  begin v_answers := coalesce(nullif(p_answers,'')::jsonb,'{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  v_questions := v_m.ai_content::jsonb->'questions';
  v_raw_answer_key := v_m.answer_key::jsonb;
  v_answer_key := case when jsonb_typeof(v_raw_answer_key)='object' and v_raw_answer_key ? 'answers' then v_raw_answer_key->'answers' else v_raw_answer_key end;
  if p_retry_attempt_id is not null then
    select * into v_retry from public.mission_retry_attempts where id=p_retry_attempt_id and mission_id=p_mission_id and group_id=p_group_id and created_by=v_user and completed_at is null for update;
    if not found then raise exception 'Retry attempt is unavailable'; end if;
    v_questions := v_retry.questions; v_answer_key := v_retry.answer_key;
  end if;
  if v_m.formative_type in ('true_false','multiple_choice') then
    select count(*) into v_correct from jsonb_array_elements(v_questions) with ordinality as q(item,idx)
      where (v_answers->((q.idx-1)::text))=(v_answer_key->((q.idx-1)::integer));
    v_score:=v_correct; v_max:=jsonb_array_length(v_questions);
  elsif v_m.formative_type='drag_drop' then
    select count(*) into v_correct from jsonb_each(v_answer_key) a(key,value) where v_answers->>a.key=trim(both '"' from a.value::text);
    v_score:=v_correct; select count(*) into v_max from jsonb_object_keys(v_answer_key);
  else v_score:=greatest(0,least(coalesce(p_score,0),v_m.max_score)); v_max:=v_m.max_score; end if;

  if p_retry_attempt_id is not null then
    update public.mission_retry_attempts set submitted_answers=v_answers,score=v_score,completed_at=now() where id=p_retry_attempt_id;
    select * into v_result from public.mission_submissions where mission_id=p_mission_id and group_id=p_group_id;
    if not found then raise exception 'The original mission submission is unavailable'; end if;
    return v_result;
  end if;

  insert into public.mission_submissions(mission_id,group_id,classroom_id,score,xp_earned,graded_by,answers)
    values(v_m.id,p_group_id,v_group.classroom_id,v_score,greatest(0,round((v_score/nullif(v_max,0))*v_m.xp_reward)),v_user,p_answers)
    on conflict(mission_id,group_id) do update set score=mission_submissions.score,xp_earned=mission_submissions.xp_earned,graded_by=mission_submissions.graded_by,answers=mission_submissions.answers
    returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.submit_mission(uuid,uuid,numeric,text,uuid) from public;
grant execute on function public.submit_mission(uuid,uuid,numeric,text,uuid) to authenticated;
