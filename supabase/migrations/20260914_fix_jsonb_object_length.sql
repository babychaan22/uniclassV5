-- PostgreSQL does not expose jsonb_object_length() in the hosted runtime.
-- Recreate submit_mission with jsonb_object_keys() for drag/drop max scores.

create or replace function public.submit_mission(
  p_mission_id uuid, p_group_id uuid, p_score numeric, p_answers text
)
returns mission_submissions
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_m missions%rowtype; v_result mission_submissions%rowtype;
  v_group_id uuid; v_answers jsonb; v_score numeric; v_max numeric; v_correct integer;
  v_item jsonb; v_idx integer; v_key text; v_is_correct boolean; v_prompt text;
begin
  select group_id into v_group_id from group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true limit 1;
  if v_group_id is null then raise exception 'You are not approved for this group'; end if;
  select * into v_m from missions where id=p_mission_id and classroom_id=(select classroom_id from groups where id=p_group_id) for update;
  if not found or not v_m.is_active then raise exception 'Mission is not active'; end if;
  if v_m.deadline is not null and v_m.deadline < current_date then raise exception 'Mission deadline has passed'; end if;
  begin v_answers := coalesce(nullif(p_answers, '')::jsonb, '{}'::jsonb); exception when others then raise exception 'Invalid answers'; end;
  if v_m.formative_type = 'true_false' or v_m.formative_type = 'multiple_choice' then
    select count(*) into v_correct from jsonb_array_elements(v_m.ai_content::jsonb->'questions') with ordinality as q(item, idx)
      where (v_answers -> ((q.idx - 1)::text)) = (v_m.answer_key::jsonb -> ((q.idx - 1)::text));
    v_score := v_correct; v_max := jsonb_array_length(v_m.ai_content::jsonb->'questions');
  elsif v_m.formative_type = 'drag_drop' then
    select count(*) into v_correct from jsonb_each(v_m.answer_key::jsonb) as a(key, value)
      where v_answers ->> a.key = trim(both '"' from a.value::text);
    v_score := v_correct;
    select count(*) into v_max from jsonb_object_keys(v_m.answer_key::jsonb);
  else
    v_score := greatest(0,least(coalesce(p_score,0),v_m.max_score)); v_max := v_m.max_score;
  end if;
  insert into mission_submissions(mission_id,group_id,classroom_id,score,xp_earned,graded_by,answers)
    values (v_m.id,p_group_id,v_m.classroom_id,v_score,greatest(0,round((v_score/nullif(v_max,0))*v_m.xp_reward)),v_user,p_answers)
    on conflict (mission_id,group_id) do update set score=excluded.score,xp_earned=excluded.xp_earned,graded_by=excluded.graded_by,answers=excluded.answers
    returning * into v_result;
  if v_m.formative_type = 'true_false' or v_m.formative_type = 'multiple_choice' then
    v_idx := 0;
    for v_item in select value from jsonb_array_elements(v_m.ai_content::jsonb->'questions') loop
      v_prompt := coalesce(v_item->>'prompt', 'Question ' || (v_idx + 1)::text);
      v_is_correct := (v_answers -> (v_idx::text)) = (v_m.answer_key::jsonb -> (v_idx::text));
      insert into learning_reviews(user_id,classroom_id,group_id,mission_id,prompt_key,prompt_text,next_review_at,interval_days,last_result)
        values(v_user,v_m.classroom_id,p_group_id,v_m.id,v_idx::text,v_prompt,case when v_is_correct then now() + interval '3 days' else now() end,case when v_is_correct then 3 else 1 end,v_is_correct)
        on conflict (user_id,mission_id,prompt_key) do update set prompt_text=excluded.prompt_text,
          next_review_at=case when excluded.last_result then now() + make_interval(days => least(learning_reviews.interval_days * 2, 60)) else now() end,
          interval_days=case when excluded.last_result then least(learning_reviews.interval_days * 2, 60) else 1 end,last_result=excluded.last_result;
      v_idx := v_idx + 1;
    end loop;
  elsif v_m.formative_type = 'drag_drop' then
    for v_key, v_item in select key, value from jsonb_each(v_m.answer_key::jsonb) loop
      v_is_correct := (v_answers ->> v_key) = trim(both '"' from v_item::text);
      insert into learning_reviews(user_id,classroom_id,group_id,mission_id,prompt_key,prompt_text,next_review_at,interval_days,last_result)
        values(v_user,v_m.classroom_id,p_group_id,v_m.id,v_key,v_key,case when v_is_correct then now() + interval '3 days' else now() end,case when v_is_correct then 3 else 1 end,v_is_correct)
        on conflict (user_id,mission_id,prompt_key) do update set
          next_review_at=case when excluded.last_result then now() + make_interval(days => least(learning_reviews.interval_days * 2, 60)) else now() end,
          interval_days=case when excluded.last_result then least(learning_reviews.interval_days * 2, 60) else 1 end,last_result=excluded.last_result;
    end loop;
  end if;
  return v_result;
end;
$$;
