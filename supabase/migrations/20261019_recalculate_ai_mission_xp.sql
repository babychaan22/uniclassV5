-- Recalculate historical AI-mission XP with numeric division. The initial
-- repair restored correct scores, but COUNT values are integers and therefore
-- truncated a partial score during the backfill.
with regraded as (
  select s.id,
    count(*) filter (where (s.answers::jsonb->((q.idx-1)::text)) = (
      (case when jsonb_typeof(m.answer_key::jsonb)='object' and m.answer_key::jsonb ? 'answers' then m.answer_key::jsonb->'answers' else m.answer_key::jsonb end)->((q.idx-1)::integer)
    )) as score,
    count(*) as max_score,
    m.xp_reward
  from public.mission_submissions s
  join public.missions m on m.id=s.mission_id
  cross join lateral jsonb_array_elements(coalesce(m.ai_content::jsonb->'questions','[]'::jsonb)) with ordinality as q(item,idx)
  where m.formative_type in ('true_false','multiple_choice')
  group by s.id,m.xp_reward
)
update public.mission_submissions s
set score=r.score,
    xp_earned=greatest(0,round((r.score::numeric/nullif(r.max_score,0))*r.xp_reward))
from regraded r
where s.id=r.id;
