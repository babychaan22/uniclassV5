-- 20261155 — a mission notification must not leave the teacher's own classes.
--
-- mission_classroom_ids, added with the notification emitters, read
-- applies_to_all_classes as "every classroom on the platform". It does not mean
-- that. Throughout this app it means "every class this teacher teaches", which
-- is how get_student_missions gates visibility:
--
--   or exists (select 1 from public.classrooms c
--              where c.id = p_classroom_id and c.teacher_id = m.created_by)
--
-- and how badge definitions are scoped as well. So the emitter was notifying
-- every other teacher's students about a mission they can never open: a leak of
-- another class's content into their bell, and a wall of noise for no reason.
--
-- The Power-Up is the one genuine cross-class mission, and it has its own branch
-- below the teacher-authored ones, so narrowing the first branch costs it
-- nothing.

create or replace function public.mission_classroom_ids(p_mission public.missions)
returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := '{}';
begin
  -- "All classes" means all of the author's classes, and only classes that
  -- actually have a student to notify.
  if p_mission.applies_to_all_classes then
    select coalesce(array_agg(c.id), '{}'::uuid[]) into v_ids
    from public.classrooms c
    where c.teacher_id = p_mission.created_by
      and exists (select 1 from public.group_accounts ga where ga.classroom_id = c.id);
    return v_ids;
  end if;

  -- An explicit target list is honoured, but a classroom the author does not
  -- teach is dropped: the mission is invisible there anyway, so notifying it
  -- would be a false promise.
  if cardinality(coalesce(p_mission.target_classroom_ids, '{}'::uuid[])) > 0 then
    select coalesce(array_agg(c.id), '{}'::uuid[]) into v_ids
    from unnest(p_mission.target_classroom_ids) as wanted(id)
    join public.classrooms c on c.id = wanted.id
    where c.teacher_id = p_mission.created_by
      and exists (select 1 from public.group_accounts ga where ga.classroom_id = c.id);
    return v_ids;
  end if;

  if p_mission.classroom_id is not null then
    return array[p_mission.classroom_id];
  end if;

  -- The shared Power-Up belongs to no classroom and no teacher; it is generated
  -- for the platform and delivered to every Mathematics class with students.
  if p_mission.mission_source = 'daily_foundation' then
    select coalesce(array_agg(distinct c.id), '{}'::uuid[]) into v_ids
    from public.classrooms c
    where public.foundation_class_serves_power_up(c.subject)
      and exists (select 1 from public.group_accounts ga where ga.classroom_id = c.id);
    return v_ids;
  end if;

  return v_ids;
end;
$$;

revoke all on function public.mission_classroom_ids(public.missions) from public;
-- ── Verification ─────────────────────────────────────────────────────────
-- The audience a notification goes to and the audience that can open the
-- mission have to be the same set. This builds a mission owned by one teacher,
-- marked as applying to all of their classes, and asserts that another
-- teacher's classroom with real students is never in the recipient list.

do $$
declare
  v_mission public.missions%rowtype;
  v_teacher uuid;
  v_own uuid;
  v_other uuid;
  v_ids uuid[];
  v_leaked integer;
  v_problems text[] := '{}';
begin
  -- A teacher who owns a class with students, and a different teacher who also
  -- has a class with students.
  select c.teacher_id, c.id into v_teacher, v_own
  from public.classrooms c
  where exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved and ga.user_id is not null)
  order by c.created_date
  limit 1;

  if v_teacher is null then
    raise notice 'skipped: no classroom with students is available to test the audience';
    return;
  end if;

  select c.id into v_other
  from public.classrooms c
  where c.teacher_id is distinct from v_teacher
    and exists (select 1 from public.group_accounts ga
                where ga.classroom_id = c.id and ga.is_approved and ga.user_id is not null)
  order by c.created_date
  limit 1;

  -- The mission is built and thrown away inside this check.
  insert into public.missions(
    title, description, xp_reward, max_score, created_by, is_active,
    approval_status, applies_to_all_classes, classroom_id, formative_type
  )
  values (
    'Verification audience', 'Audience check.', 5, 5, v_teacher, true,
    'approved', true, v_own, 'manual'
  )
  returning * into v_mission;

  v_ids := public.mission_classroom_ids(v_mission);

  select count(*) into v_leaked
  from unnest(v_ids) as reached(id)
  where reached.id = v_own;

  if v_leaked <> 1 then
    v_problems := array_append(v_problems,
      'the author''s own classroom was left out of the audience');
  end if;

  if v_other is not null then
    if v_other = any (v_ids) then
      v_problems := array_append(v_problems,
        'another teacher''s classroom would be told about a mission they cannot open');
    end if;
  end if;

  -- And the Power-Up still reaches every Mathematics class, which is the one
  -- mission that genuinely is not tied to a single author.
  declare v_power_up uuid[]; v_math uuid;
  begin
    select * into v_mission from public.missions
    where mission_source = 'daily_foundation'
    order by auto_daily_date desc nulls last limit 1;

    if v_mission.id is not null then
      v_power_up := public.mission_classroom_ids(v_mission);

      select c.id into v_math
      from public.classrooms c
      where public.foundation_class_serves_power_up(c.subject)
        and exists (select 1 from public.group_accounts ga
                    where ga.classroom_id = c.id and ga.is_approved and ga.user_id is not null)
      order by c.created_date limit 1;

      if v_math is not null and not (v_math = any (v_power_up)) then
        v_problems := array_append(v_problems,
          'the shared Power-Up stopped reaching Mathematics classes');
      end if;
    end if;
  end;

  delete from public.missions where id = v_mission.id;

  if array_length(v_problems, 1) is not null then
    raise exception 'Mission audience is wrong: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: a mission reaches only its author''s classes, and the shared Power-Up still reaches every Mathematics class';
end;
$$;