-- 20261120 — ai_content must remain JSON *text* in student payloads.
--
-- 20261111 stripped answers with jsonb_set(..., '{ai_content}', <jsonb object>),
-- which turned the text column into a JSON object. Every client calls
-- JSON.parse(mission.ai_content), so the object stringified to "[object Object]",
-- the parse threw, and the mission rendered with zero questions
-- ("This mission has no questions available yet") even though the rows were fine.
-- to_jsonb(text) re-wraps the stripped object back into a JSON string.

create or replace function public.sanitize_mission_for_student(p_mission public.missions)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_result   jsonb;
  v_stripped jsonb;
begin
  if p_mission.id is null then return null; end if;

  -- answer_key is a column, the per-item answer is buried in ai_content.
  v_result := to_jsonb(p_mission) - 'answer_key';

  if p_mission.ai_content is null then return v_result; end if;

  begin
    if jsonb_typeof(p_mission.ai_content::jsonb -> 'questions') = 'array' then
      v_stripped :=
        (p_mission.ai_content::jsonb - 'questions')
        || jsonb_build_object(
          'questions',
          (
            select coalesce(
              jsonb_agg(
                (item.value
                  - 'answer_index' - 'correct_index' - 'correct_answer' - 'answer'
                  - 'explanation' - 'feedback' - 'student_feedback')
                order by item.ordinality
              ),
              '[]'::jsonb
            )
            from jsonb_array_elements(p_mission.ai_content::jsonb -> 'questions')
              with ordinality as item(value, ordinality)
          )
        );

      -- to_jsonb(..::text) keeps ai_content a JSON string, which is what
      -- JSON.parse on the client expects.
      v_result := jsonb_set(v_result, '{ai_content}', to_jsonb(v_stripped::text), true);
    end if;
  exception when others then
    -- Unreadable ai_content must not hide the rest of the mission.
    null;
  end;

  return v_result;
end;
$$;

revoke all on function public.sanitize_mission_for_student(public.missions) from public;
grant execute on function public.sanitize_mission_for_student(public.missions) to authenticated;

