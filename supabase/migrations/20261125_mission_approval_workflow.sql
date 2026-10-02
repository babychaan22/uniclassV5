-- 20261125 — missions are published only after a teacher approves them.
--
-- Until now a Daily Math Power-Up inserted itself with is_active = true, and
-- ensure_daily_drill re-activated the row if anyone switched it off, so a
-- teacher never got to review what students were about to see. The same was
-- true of teacher-authored and AI-authored missions, which were born inactive
-- but were only ever a single on/off switch away from the whole class.
--
-- This adds an explicit review record and a real approval step:
--
--   approval_status  pending   -> generated or authored, not yet reviewed
--                   approved  -> reviewed by a teacher, visible to students
--                   rejected  -> reviewed and withheld
--   is_active        the live switch students actually see, so a past day's
--                    Power-Up can still be closed without being "unapproved"
--
-- A Power-Up is now created pending. It renders for a student only after a
-- teacher approves it, and approving is one action that publishes it to every
-- class at once.

alter table public.missions
  add column if not exists approval_status text not null default 'pending',
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'missions_approval_status_check'
  ) then
    alter table public.missions
      add constraint missions_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

-- Teachers filter their own list by this constantly.
create index if not exists idx_missions_approval_queue
  on public.missions(classroom_id, approval_status, created_date desc);

-- Missions that already exist were, by definition, never held back for review:
-- they were live the moment they were written. Record them as reviewed so the
-- new column does not retroactively hide a classroom's existing work.
update public.missions
set approval_status = 'approved',
    reviewed_at = coalesce(reviewed_at, created_date)
where is_active
  and approval_status = 'pending'
  and reviewed_at is null;

-- ── 1. Review a single mission ────────────────────────────────────────────
-- Approving is what makes a mission live. Rejecting or sending it back keeps it
-- hidden but leaves the review trail. Editing a live mission must not silently
-- unpublish it, so a plain update is allowed below rather than through here.

create or replace function public.set_mission_approval(
  p_mission_id uuid,
  p_status text,
  p_classroom_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_mission public.missions%rowtype;
  v_teacher uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  if lower(coalesce(btrim(p_status), '')) not in ('pending', 'approved', 'rejected') then
    raise exception 'Unknown approval status "%". Use pending, approved or rejected.', p_status;
  end if;

  select * into v_mission from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found.'; end if;

  select c.teacher_id into v_teacher
  from public.classrooms c
  where c.id = v_mission.classroom_id
    and (p_classroom_id is null or c.id = p_classroom_id);
  if not found then raise exception 'Classroom not found.'; end if;

  if v_user <> v_teacher and not auth_is_teacher_of(v_mission.classroom_id) then
    raise exception 'Only the teacher of this class can review a mission.';
  end if;

  update public.missions m
  set approval_status = lower(btrim(p_status)),
      reviewed_by = v_user,
      reviewed_at = now(),
      -- Approval is what publishes. Anything else withdraws it again.
      is_active = (lower(btrim(p_status)) = 'approved')
  where m.id = p_mission_id
  returning * into v_mission;

  return jsonb_build_object(
    'id', v_mission.id,
    'title', v_mission.title,
    'approval_status', v_mission.approval_status,
    'is_active', v_mission.is_active
  );
end;
$$;

revoke all on function public.set_mission_approval(uuid, text, uuid) from public;
grant execute on function public.set_mission_approval(uuid, text, uuid) to authenticated;

-- ── 2. Approve one mission across every class, in one action ─────────────
-- A Power-Up is generated per classroom, so a teacher looking at one classroom
-- would have to approve seven times. This publishes a mission to all of the
-- teacher's Mathematics classes at once.

create or replace function public.approve_power_up_for_all_classes(
  p_auto_daily_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_today  date := coalesce(p_auto_daily_date, (now() at time zone 'Asia/Manila')::date);
  v_count  integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  update public.missions m
  set approval_status = 'approved',
      is_active = true,
      reviewed_by = v_user,
      reviewed_at = now()
  where m.mission_source = 'daily_foundation'
    and m.auto_daily_date = v_today
    and m.approval_status <> 'approved'
and exists (
        select 1 from public.classrooms c
        where c.id = m.classroom_id
          and (c.teacher_id = v_user or auth_is_teacher_of(c.id))
      );

  get diagnostics v_count = row_count;

  if v_count = 0 then
    return jsonb_build_object(
      'approved', 0,
      'date', v_today,
      'message', 'Every Power-Up for ' || v_today || ' is already approved.'
    );
  end if;

  return jsonb_build_object(
    'approved', v_count,
    'date', v_today,
    'message', 'Published ' || v_count || ' Power-Up' || (case when v_count = 1 then '' else 's' end)
      || ' for ' || v_today || ' across your classes.'
  );
end;
$$;

revoke all on function public.approve_power_up_for_all_classes(date) from public;
grant execute on function public.approve_power_up_for_all_classes(date) to authenticated;

-- ── 3. Edit a mission, including one that is already live ─────────────────
-- A published mission is still the teacher's to correct. Editing must not
-- quietly withdraw it from students, so approval is preserved.

create or replace function public.update_mission(
  p_mission_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_mission public.missions%rowtype;
  v_teacher uuid;
  v_patch   jsonb;
  v_allowed text[] := array[
    'title', 'description', 'xp_reward', 'max_score', 'deadline', 'deadline_at',
    'image_url', 'formative_type', 'ai_content', 'answer_key',
    'applies_to_all_classes', 'target_classroom_ids', 'target_statuses'
  ];
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select * into v_mission from public.missions where id = p_mission_id;
  if not found then raise exception 'Mission not found.'; end if;

  select c.teacher_id into v_teacher
  from public.classrooms c where c.id = v_mission.classroom_id;
  if v_teacher is null then raise exception 'Classroom not found.'; end if;

  if v_user <> v_teacher and not auth_is_teacher_of(v_mission.classroom_id) then
    raise exception 'Only the teacher of this class can edit a mission.';
  end if;

  -- Only the columns a teacher owns are writable. is_active, approval_status,
  -- mission_source and the auto-daily bookkeeping are not, so an edit can
  -- neither publish a mission nor forge its provenance.
  v_patch := (
    select jsonb_object_agg(key, value)
    from jsonb_each(p_patch)
    where key = any(v_allowed)
  );

  if v_patch is null or v_patch = '{}'::jsonb then
    raise exception 'Nothing to update.';
  end if;

  execute (
    select 'update public.missions set '
      || string_agg(format('%I = ($1->>%L)::%s', key, key,
          case key
            when 'xp_reward' then 'numeric'
            when 'max_score' then 'numeric'
            when 'target_classroom_ids' then 'uuid[]'
            when 'target_statuses' then 'text[]'
            when 'deadline' then 'date'
            when 'deadline_at' then 'timestamptz'
            else 'text'
          end), ', ')
      || ' where id = $2 returning *'
    from jsonb_object_keys(v_patch) as k(key)
  )
  into v_mission
  using v_patch, p_mission_id;

  return jsonb_build_object(
    'id', v_mission.id,
    'approval_status', v_mission.approval_status,
    'is_active', v_mission.is_active
  );
end;
$$;

revoke all on function public.update_mission(uuid, jsonb) from public;
grant execute on function public.update_mission(uuid, jsonb) to authenticated;
