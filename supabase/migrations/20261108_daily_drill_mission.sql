-- An automatic "drill of the day" that the teacher never has to create.
--
-- The generator is deterministic and subject-parameterised, so no AI call is
-- needed: for mathematics it builds five randomised operations over whole
-- numbers, integers, fractions and decimals, each with a worked explanation.
-- Other subjects get a short conceptual check-in for now.
--
-- One row per classroom per day, worth a flat 5 XP on completion, expiring at
-- the end of the Manila day. The existing deadline triggers from 20261101 lock
-- both first submissions and retries once it lapses.

alter table public.missions
  add column if not exists is_auto_daily boolean not null default false;
alter table public.missions
  add column if not exists auto_daily_date date;
alter table public.missions
  add column if not exists subject text;

create index if not exists idx_missions_auto_daily
  on public.missions(classroom_id, auto_daily_date)
  where is_auto_daily;

-- One row per classroom, subject and day. A teacher with two Math sections in
-- one classroom therefore gets a separate drill for each.
create unique index if not exists idx_missions_one_auto_daily_per_day
  on public.missions(classroom_id, coalesce(subject, ''), auto_daily_date)
  where is_auto_daily and auto_daily_date is not null;

-- A daily drill is flat-value, not proportional: full completion is 5 XP.
alter table public.missions drop constraint if exists missions_auto_daily_xp;
alter table public.missions add constraint missions_auto_daily_xp
  check (not is_auto_daily or xp_reward = 5);

-- ── item builders ────────────────────────────────────────────────────────
-- Each builder returns one question plus a student-facing explanation of the
-- method, so a wrong answer still teaches the skill.

-- Multiple-choice grading compares the submitted *option index* against the
-- answer key, so every builder must return an options array plus the index of
-- the correct one. Distractors sit near the real answer so a guess is unlikely
-- to be right by accident.

create or replace function public.drill_options(p_correct numeric, p_scale integer default 0)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_correct numeric := p_correct;
  v_step numeric := case when p_scale = 0 then 1 else 10::numeric / power(10, p_scale) end;
  v_pool numeric[];
  v_picked numeric[] := '{}';
  v_candidate numeric;
  v_index integer;
  v_try integer := 0;
  v_delta integer;
begin
  -- Four options: the correct value plus three distinct near misses.
  v_pool := array[
    v_correct,
    v_correct + v_step,
    v_correct - v_step,
    v_correct + 2 * v_step,
    v_correct - 2 * v_step
  ];

  v_index := floor(random() * 5)::integer;
  for v_try in 1..12 loop
    v_delta := floor(random() * 5)::integer;
    if v_delta = v_index then continue; end if;
    v_candidate := v_pool[v_delta + 1];
    if v_candidate <> v_correct and not (v_candidate = any(v_picked)) then
      v_picked := v_picked || v_candidate;
    end if;
    exit when array_length(v_picked, 1) = 3;
  end loop;

  -- Fall back to sequential fills if randomness kept colliding.
  while array_length(v_picked, 1) < 3 loop
    v_picked := v_picked || (v_correct + (array_length(v_picked, 1) + 1) * v_step);
  end loop;

  -- Rebuild the array with the correct answer placed at v_index.
  v_picked := (
    select coalesce(array_agg(x order by ord), '{}'::numeric[])
    from (
      select case when ord = v_index + 1 then v_correct else elem end as x, ord
      from unnest(v_picked || v_correct) with ordinality as u(elem, ord)
    ) s
  );

  return jsonb_build_object(
    'options', to_jsonb(v_picked),
    'answer_index', v_index,
    'answer', v_correct
  );
end;
$$;

create or replace function public.drill_fraction(n integer)
returns jsonb language plpgsql immutable as $$
declare
  v_d1 integer := greatest(1, floor(random() * 8)::integer + 1);
  v_d2 integer := floor(random() * 8)::integer + 2;
  v_d3 integer := floor(random() * 8)::integer + 2;
  v_num integer;
  v_den integer;
  v_label text;
  v_value numeric;
  v_opts jsonb;
begin
  v_d2 := case when v_d2 = 1 then 2 else v_d2 end;
  v_d3 := case when v_d3 = 1 then 2 else v_d3 end;

  case floor(random() * 3)::integer
    when 0 then
      v_label := format('%s/%s + %s/%s', v_d1, v_d2, v_d3, v_d2);
      v_value := (v_d1::numeric / v_d2) + (v_d3::numeric / v_d2);
    when 1 then
      v_label := format('%s/%s - %s/%s', v_d1 + v_d2, v_d2, v_d3, v_d2);
      v_value := ((v_d1 + v_d2)::numeric / v_d2) - (v_d3::numeric / v_d2);
      if v_value < 0 then
        v_label := format('%s/%s - %s/%s', v_d3, v_d2, v_d1 + v_d2, v_d2);
        v_value := (v_d3::numeric / v_d2) - ((v_d1 + v_d2)::numeric / v_d2);
      end if;
    else
      v_label := format('%s/%s x %s/%s', v_d1, v_d2, v_d3, v_d2);
      v_value := (v_d1::numeric / v_d2) * (v_d3::numeric / v_d2);
  end case;

  v_den := v_d2 * v_d2;
  v_num := round(v_value * v_den)::integer;

  -- A negative result is legitimate, so the options are built on the value
  -- itself rather than assuming a positive answer.
  v_opts := drill_options(v_num);

  return jsonb_build_object(
    'prompt', format('What is %s? Give the numerator and denominator of your answer.', v_label),
    'options', v_opts->'options',
    'answer_index', v_opts->'answer_index',
    'explanation', format(
      'Convert both fractions to the common denominator %s first. Then work left to right: for multiplication multiply the numerators together and the denominators together, and for addition or subtraction keep the denominator and add or subtract the numerators. That gives %s/%s.',
      v_den, v_num, v_den
    )
  );
end;
$$;

create or replace function public.drill_decimal(n integer)
returns jsonb language plpgsql immutable as $$
declare
  v_place text := (array['tenths','hundredths','thousandths'])[floor(random() * 3)::integer + 1];
  v_scale integer := case v_place when 'tenths' then 1 when 'hundredths' then 2 else 3 end;
  v_op text := (array['+','-','x'])[floor(random() * 3)::integer + 1];
  v_a numeric := (floor(random() * 9000)::integer + 100) / 100;
  v_b numeric := (floor(random() * 900)::integer + 10) / 100;
  v_value numeric;
  v_opts jsonb;
  v_a_text text;
  v_b_text text;
begin
  v_a_text := to_char(v_a, 'FM9999990.00');
  v_b_text := to_char(v_b, 'FM9999990.00');

  v_value := round(case when v_op = '+' then v_a + v_b
                        when v_op = '-' then v_a - v_b
                        else v_a * v_b end, v_scale);

  v_opts := drill_options(v_value, v_scale);

  return jsonb_build_object(
    'prompt', format('Calculate %s %s %s. Round your answer to %s.', v_a_text, v_op, v_b_text, v_place),
    'options', v_opts->'options',
    'answer_index', v_opts->'answer_index',
    'explanation', format(
      'Line up the decimal points so the ones sit under the ones, then work right to left keeping every digit in its own column. %s = %s. Keep the decimal point in the same column all the way through, then count back to confirm the answer is rounded to %s.',
      format('%s %s %s', v_a_text, v_op, v_b_text),
      to_char(v_value, 'FM9999990.' || repeat('9', greatest(v_scale, 2))),
      v_place
    )
  );
end;
$$;

create or replace function public.drill_whole(n integer)
returns jsonb language plpgsql immutable as $$
declare
  v_op text := (array['+','-','x'])[floor(random() * 3)::integer + 1];
  v_a numeric;
  v_b numeric;
  v_value numeric;
  v_opts jsonb;
  v_a_text text;
  v_b_text text;
begin
  if v_op = 'x' then
    v_a := floor(random() * 12)::integer + 2;
    v_b := floor(random() * 12)::integer + 2;
  elsif v_op = '-' then
    v_a := floor(random() * 90)::integer + 20;
    v_b := floor(random() * 80)::integer + 1;
  else
    v_a := floor(random() * 900)::integer + 50;
    v_b := floor(random() * 400)::integer + 10;
  end if;

  if v_op = '+' then v_value := v_a + v_b;
  elsif v_op = '-' then v_value := v_a - v_b;
  else v_value := v_a * v_b;
  end if;

  v_a_text := v_a::text;
  v_b_text := v_b::text;
  v_opts := drill_options(v_value);

  return jsonb_build_object(
    'prompt', format('What is %s %s %s?', v_a_text, v_op, v_b_text),
    'options', v_opts->'options',
    'answer_index', v_opts->'answer_index',
    'explanation', format(
      case v_op
        when '+' then 'Start at %s and count forward %s. You land on %s.'
        when '-' then 'Start at %s and count back %s. You land on %s.'
        else 'Think of %s as %s groups of %s, then count them all to get %s.'
      end,
      v_a_text, v_b_text, v_value,
      v_a_text, v_b_text, v_value
    )
  );
end;
$$;

create or replace function public.drill_integer(n integer)
returns jsonb language plpgsql immutable as $$
declare
  v_op text := (array['+','-','x'])[floor(random() * 3)::integer + 1];
  v_a integer := floor(random() * 19)::integer - 9;
  v_b integer := floor(random() * 19)::integer - 9;
  v_value numeric;
  v_opts jsonb;
  v_a_text text;
  v_b_text text;
begin
  -- Mixed signs are the point of this drill, so negatives stay in play.
  if v_op = 'x' then
    v_a := greatest(-6, least(6, v_a));
    v_b := greatest(-6, least(6, v_b));
  end if;

  if v_op = '+' then v_value := v_a + v_b;
  elsif v_op = '-' then v_value := v_a - v_b;
  else v_value := v_a * v_b;
  end if;

  v_a_text := v_a::text;
  v_b_text := v_b::text;
  v_opts := drill_options(v_value);

  return jsonb_build_object(
    'prompt', format('What is %s %s %s?', v_a_text, v_op, v_b_text),
    'options', v_opts->'options',
    'answer_index', v_opts->'answer_index',
    'explanation', format(
      case v_op
        when '+' then 'Two negatives add to a positive, and two positives add to a positive, so %s + %s = %s.'
        when '-' then 'Subtracting a negative is the same as adding its positive, so %s - (%s) is really %s + %s = %s.'
        else 'Multiply the magnitudes and then take the sign from the operation: a negative times a positive stays negative, and two negatives give a positive. So %s x %s = %s.'
      end,
      v_a_text, v_b_text, v_value,
      v_a_text, v_b_text, v_a_text, abs(v_b)::text, v_value,
      v_a_text, v_b_text, v_value
    )
  );
end;
$$;

-- ── daily drill creation ─────────────────────────────────────────────────

create or replace function public.ensure_daily_drill(p_classroom_id uuid default null)
returns public.missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_end timestamptz := ((now() at time zone 'Asia/Manila')::date + time '23:59:59') at time zone 'Asia/Manila';
  v_classroom public.classrooms%rowtype;
  v_existing public.missions%rowtype;
  v_mission public.missions%rowtype;
  v_subject text;
  v_is_math boolean;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_i integer;
  v_kinds text[];
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_classroom
  from public.classrooms
  where id = coalesce(p_classroom_id, (select classroom_id from public.group_accounts where user_id = v_user and is_approved = true order by created_date asc limit 1));

  if not found then raise exception 'Classroom not found'; end if;

  -- Teachers can always trigger it for their class; students get their own.
  if not auth_is_teacher_of(v_classroom.id) then
    if not exists (
      select 1 from public.group_accounts
      where user_id = v_user and classroom_id = v_classroom.id and is_approved = true
    ) then
      raise exception 'Approved classroom account required';
    end if;
  end if;

  select * into v_existing
  from public.missions
  where is_auto_daily
    and auto_daily_date = v_today
    and classroom_id = v_classroom.id
    and coalesce(subject, '') = coalesce(nullif(trim(v_classroom.subject), ''), 'General Studies');

  if found then
    return v_existing;
  end if;

  v_subject := coalesce(nullif(trim(v_classroom.subject), ''), 'General Studies');
  v_is_math := lower(v_subject) ~ '(math|matemat|mathemat|maths|mathematics|arithmetic|algebra|geometry)';

  -- Only mathematics has a generator we can trust today. Rather than emit
  -- generic questions for other subjects, which would be unverified content
  -- presented as fundamentals, those classrooms simply get no drill yet.
  if not v_is_math then
    raise exception 'Automatic daily missions are available for Mathematics classes only. Add your own missions for %s.', v_subject;
  end if;

  -- Rotate the numeric domain by day of year so a week covers all four.
  v_kinds := (array[
    case when mod(abs(floor(extract(doy from now()))::integer), 4) = 0 then 'whole'    else 'integer'  end,
    case when mod(abs(floor(extract(doy from now()))::integer), 4) = 1 then 'whole'    else 'fraction' end,
    case when mod(abs(floor(extract(doy from now()))::integer), 4) = 2 then 'integer' else 'decimal'  end,
    case when mod(abs(floor(extract(doy from now()))::integer), 4) = 3 then 'fraction' else 'decimal'  end
  ]);

  for v_i in 1..5 loop
    v_item := case v_kinds[v_i]
      when 'whole' then drill_whole(v_i)
      when 'integer' then drill_integer(v_i)
      when 'fraction' then drill_fraction(v_i)
      else drill_decimal(v_i)
    end;

    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('id', v_i));
  end loop;

  insert into public.missions(
    classroom_id, title, description, xp_reward, max_score, deadline,
    deadline_at, is_active, created_by, formative_type, ai_content,
    answer_key, is_auto_daily, auto_daily_date, subject
  )
  values (
    v_classroom.id,
    format('Drill of the day · %s', v_subject),
    'Five quick mixed number problems to keep your fundamentals sharp. Finish today to earn 5 XP.',
    5,
    5,
    v_today,
    v_end,
    true,
    v_classroom.teacher_id,
    'multiple_choice',
    jsonb_build_object(
      'questions', v_items,
      'auto_generated', true,
      'learning_target', 'I can work confidently with whole numbers, integers, fractions and decimals.',
      'student_instructions', 'Answer all five questions. Every question includes an explanation you can read afterwards.',
      'estimated_minutes', 4
    )::text,
    -- Grading compares the submitted option index against this key, so the key
    -- holds each item's answer_index rather than its value.
    jsonb_build_object('answers', (
      select jsonb_agg(q->'answer_index')
      from jsonb_array_elements(v_items) q
    ))::text,
    true,
    v_today,
    v_subject
  )
  returning * into v_mission;

  return v_mission;
end;
$$;

revoke all on function public.ensure_daily_drill(uuid) from public;
grant execute on function public.ensure_daily_drill(uuid) to authenticated;

-- Materialise today's drill on first read so the student list always has one,
-- and so an expired drill stays visible as an expired row rather than vanishing.
create or replace function public.ensure_daily_drill_for_student(p_classroom_id uuid)
returns public.missions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_mission public.missions%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if not exists (
    select 1 from public.group_accounts
    where user_id = v_user and classroom_id = p_classroom_id and is_approved = true
  ) and not auth_is_teacher_of(p_classroom_id) then
    raise exception 'Approved classroom account required';
  end if;

  select * into v_mission
  from public.missions
  where is_auto_daily
    and auto_daily_date = v_today
    and classroom_id = p_classroom_id
    and coalesce(subject, '') = coalesce(nullif(trim((select c.subject from public.classrooms c where c.id = p_classroom_id)), ''), 'General Studies');

  if found then return v_mission; end if;

  return ensure_daily_drill(p_classroom_id);
end;
$$;

revoke all on function public.ensure_daily_drill_for_student(uuid) from public;
grant execute on function public.ensure_daily_drill_for_student(uuid) to authenticated;

-- Hide yesterday's drill once it is over so it stops competing for attention.
create or replace function public.expire_daily_drills()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_count integer;
begin
  update public.missions
  set is_active = false
  where is_auto_daily
    and auto_daily_date < v_today
    and is_active;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_daily_drills() from public;
grant execute on function public.expire_daily_drills() to authenticated;