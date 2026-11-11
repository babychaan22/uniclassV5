-- Remove linter warnings from active notification and mission helpers without
-- changing their business behaviour.

create or replace function public.mission_classroom_ids(p_mission public.missions)
returns uuid[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ids uuid[] := array[]::uuid[];
begin
  if p_mission.applies_to_all_classes then
    select coalesce(array_agg(c.id), array[]::uuid[]) into v_ids from public.classrooms c
    where c.teacher_id = p_mission.created_by and exists (select 1 from public.group_accounts ga where ga.classroom_id = c.id);
    return v_ids;
  end if;
  if cardinality(coalesce(p_mission.target_classroom_ids, array[]::uuid[])) > 0 then
    select coalesce(array_agg(c.id), array[]::uuid[]) into v_ids from unnest(p_mission.target_classroom_ids) as wanted(id)
    join public.classrooms c on c.id = wanted.id
    where c.teacher_id = p_mission.created_by and exists (select 1 from public.group_accounts ga where ga.classroom_id = c.id);
    return v_ids;
  end if;
  if p_mission.classroom_id is not null then return array[p_mission.classroom_id]; end if;
  if p_mission.mission_source = 'daily_foundation' then
    select coalesce(array_agg(distinct c.id), array[]::uuid[]) into v_ids from public.classrooms c
    where public.foundation_class_serves_power_up(c.subject) and exists (select 1 from public.group_accounts ga where ga.classroom_id = c.id);
  end if;
  return v_ids;
end;
$$;

create or replace function public.notify_classroom(p_classroom_id uuid, p_audience text, p_kind text, p_title text, p_body text, p_link text default null)
returns uuid[] language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[] := array[]::uuid[]; v_new uuid;
begin
  if p_audience = 'teacher' then
    for v_new in insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
      select p_classroom_id, c.teacher_id, 'teacher', p_kind, p_title, p_body, p_link from public.classrooms c
      where c.id = p_classroom_id and c.teacher_id is not null returning id loop
      v_ids := array_append(v_ids, v_new);
    end loop;
  else
    for v_new in insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
      select p_classroom_id, ga.user_id, 'student', p_kind, p_title, p_body, p_link from public.group_accounts ga
      where ga.classroom_id = p_classroom_id and ga.is_approved = true and ga.user_id is not null returning id loop
      v_ids := array_append(v_ids, v_new);
    end loop;
  end if;
  return v_ids;
end;
$$;

create or replace function public.validate_observability_json_size(p_value jsonb, p_max_bytes integer default 65536)
returns boolean language plpgsql stable set search_path = public, pg_temp as $$
begin
  if p_value is null then return true; end if;
  return octet_length(convert_to(p_value::text, 'UTF8')) <= p_max_bytes;
end;
$$;

create or replace function public.sanitize_mission_for_student(p_mission public.missions)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare v_result jsonb; v_content jsonb; v_questions jsonb;
begin
  if p_mission.id is null then return null; end if;
  v_result := to_jsonb(p_mission) - 'answer_key';
  if p_mission.ai_content is null then return v_result; end if;
  begin
    v_content := p_mission.ai_content::jsonb;
    v_content := v_content - 'feedback' - 'solution_steps' - 'why_wrong' - 'remember' - 'retry_variants' - 'misconceptions';
    if jsonb_typeof(v_content -> 'questions') = 'array' then
      select coalesce(jsonb_agg(q.value - 'answer_index' - 'correct_index' - 'correct_answer' - 'answer' - 'explanation' - 'feedback' - 'student_feedback' - 'solution_steps' - 'why_wrong' - 'remember' - 'misconception' order by q.ordinality), '[]'::jsonb)
        into v_questions from jsonb_array_elements(v_content -> 'questions') with ordinality q(value, ordinality);
      v_content := jsonb_set(v_content, '{questions}', v_questions);
    end if;
    return jsonb_set(v_result, '{ai_content}', to_jsonb(v_content::text), true);
  exception when others then
    return jsonb_set(v_result, '{ai_content}', 'null'::jsonb, true);
  end;
end;
$$;
