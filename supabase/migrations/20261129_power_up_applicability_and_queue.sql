-- 20261129 — only serve the Power-Up where it applies, and populate the
-- teacher's review queue without waiting for a student.
--
-- Two gaps found in the mission-flow audit:
--
--   1. The student's Power-Up section rendered unconditionally, so a student in
--      a non-Mathematics classroom saw "No Power-Up today - your teacher reviews
--      the daily Power-Up", naming an activity their class never receives. The
--      engine already refuses those classrooms; the page just did not know.
--
--   2. Generation is lazy. A Power-Up row appeared only when someone opened the
--      missions page, so a teacher checking their review queue before class saw
--      nothing to approve for most of their Mathematics classes.
--
-- The "is this a Mathematics classroom" rule is lifted into one helper so the
-- engine and the applicability check cannot drift apart.

create or replace function public.foundation_class_serves_power_up(p_subject text)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- The same subject list ensure_daily_drill has always used, which spellings
  -- included. Kept character for character so this changes no classroom.
  select lower(coalesce(nullif(btrim(p_subject), ''), 'General Studies'))
    ~ '(math|matemat|mathemat|maths|mathematics|arithmetic|algebra|geometry)';
$$;

revoke all on function public.foundation_class_serves_power_up(text) from public;
grant execute on function public.foundation_class_serves_power_up(text) to authenticated;

-- ── Does the Power-Up apply to this classroom? ────────────────────────────
-- Answers it for the caller only: their own classroom, and only when they are an
-- approved member or the teacher of it.

create or replace function public.power_up_applies_to_classroom(p_classroom_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_subject text;
begin
  if v_user is null or p_classroom_id is null then return false; end if;

  select c.subject into v_subject
  from public.classrooms c
  where c.id = p_classroom_id;
  if not found then return false; end if;

  if not (
    auth_is_teacher_of(p_classroom_id)
    or exists (
      select 1 from public.group_accounts ga
      where ga.user_id = v_user
        and ga.classroom_id = p_classroom_id
        and ga.is_approved
    )
  ) then
    return false;
  end if;

  return public.foundation_class_serves_power_up(v_subject);
end;
$$;

revoke all on function public.power_up_applies_to_classroom(uuid) from public;
grant execute on function public.power_up_applies_to_classroom(uuid) to authenticated;

-- ── Populate the review queue ─────────────────────────────────────────────
-- A teacher opening their missions page calls this once. It generates today's
-- Power-Up, as pending, for every Mathematics classroom they teach that has
-- students, so there is something in the queue to review before class starts.
-- It publishes nothing: generation and approval stay separate.

create or replace function public.generate_pending_power_ups()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_cids    uuid[];
  v_cid     uuid;
  v_ensured integer := 0;
  v_skipped integer := 0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_cids
  from public.classrooms c
  where (c.teacher_id = v_user or auth_is_teacher_of(c.id))
    and public.foundation_class_serves_power_up(c.subject)
    and exists (
      select 1 from public.group_accounts ga
      where ga.classroom_id = c.id and ga.is_approved
    );

  foreach v_cid in array v_cids loop
    begin
      -- The engine returns today's mission as it stands, generating it only if
      -- it does not exist yet, and never publishes it.
      perform public.ensure_daily_power_up_for_student(v_cid);
      v_ensured := v_ensured + 1;
    exception when others then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object(
    'classrooms', v_ensured,
    'skipped', v_skipped,
    'message', case
      when v_ensured = 0 then 'No Mathematics classes with students yet.'
      else 'Power-Up ready to review for ' || v_ensured || ' class'
           || (case when v_ensured = 1 then '' else 'es' end) || '.'
    end
  );
end;
$$;

revoke all on function public.generate_pending_power_ups() from public;
grant execute on function public.generate_pending_power_ups() to authenticated;

-- ── Verification ──────────────────────────────────────────────────────────
-- The audit's real concern is that the helper and the engine could disagree
-- about which classrooms are served. This proves they agree by construction:
-- for every classroom with students it compares the helper against the engine's
-- actual behaviour, and requires the new generator to leave nothing published.

do $$
declare
  v_c        record;
  v_user     uuid;
  v_student  uuid;
  v_teacher  uuid;
  v_helper   boolean;
  v_engine   boolean;
  v_mid      uuid;
  v_problems text[] := '{}';
  v_checked  integer := 0;
begin
  for v_c in
    select c.id, c.subject from public.classrooms c
    where exists (
      select 1 from public.group_accounts ga
      where ga.classroom_id = c.id and ga.is_approved
    )
  loop
    v_checked := v_checked + 1;

    v_helper := public.foundation_class_serves_power_up(v_c.subject);

    -- What the engine actually does for this classroom, asked as a real member.
    select ga.user_id into v_student
    from public.group_accounts ga
    where ga.classroom_id = v_c.id and ga.is_approved
    order by ga.created_date limit 1;

    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_student::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_student::text, 'role', 'authenticated')::text);

    begin
      perform public.ensure_daily_power_up_for_student(v_c.id);
      v_engine := true;
    exception when others then
      v_engine := false;
    end;

    if v_helper is distinct from v_engine then
      v_problems := array_append(v_problems,
        'classroom ' || left(v_c.id::text, 8) || ' (' || coalesce(v_c.subject, '<blank>')
        || '): helper says ' || coalesce(v_helper::text, 'null')
        || ' but the engine ' || (case when v_engine then 'serves it' else 'refuses it' end));
    end if;

    -- A refused classroom must hold no Power-Up at all.
    if not v_engine and exists (
      select 1 from public.missions m
      where m.classroom_id = v_c.id and m.mission_source = 'daily_foundation'
    ) then
      v_problems := array_append(v_problems,
        'classroom ' || left(v_c.id::text, 8)
        || ' is not served but still holds a Power-Up');
    end if;
  end loop;

  -- The teacher-side generator must populate without publishing anything.
  select c.teacher_id, c.id into v_teacher, v_c.id
  from public.classrooms c
  where public.foundation_class_serves_power_up(c.subject)
    and exists (
      select 1 from public.group_accounts ga
      where ga.classroom_id = c.id and ga.is_approved
    )
  order by c.created_date limit 1;

  if v_teacher is not null then
    execute 'set local request.jwt.claim.sub = ' || quote_literal(v_teacher::text);
    execute 'set local request.jwt.claims = ' || quote_literal(
      json_build_object('sub', v_teacher::text, 'role', 'authenticated')::text);

    perform public.generate_pending_power_ups();

    select m.id into v_mid
    from public.missions m
    where m.classroom_id = v_c.id
      and m.mission_source = 'daily_foundation'
      and m.auto_daily_date = (now() at time zone 'Asia/Manila')::date
      and m.approval_status = 'pending'
      and m.is_active;

    if v_mid is not null then
      v_problems := array_append(v_problems,
        'generate_pending_power_ups published a Power-Up it should only have prepared');
    end if;
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Power-Up applicability broken: %', array_to_string(v_problems, '; ');
  end if;

  raise notice 'verified: helper and engine agree across % classroom(es) with students', v_checked;
end;
$$;