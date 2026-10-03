-- 20261144 — turn the notification pipeline on.
--
-- Everything needed to deliver a notification already existed: the table, the
-- bell, the realtime subscription, the push edge function, the subscription
-- registry. Not one event ever wrote a row. notify_classroom had no callers,
-- so the bell had been permanently empty.
--
-- Two things were missing to make it work.
--
-- Addressing. notify_classroom can only reach a whole classroom or its
-- teacher, which is the wrong size for most of what students need to hear:
-- "your badge was approved" cannot be broadcast to the class without telling
-- everyone else's business. notify_user, notify_group and notify_member add the
-- missing sizes.
--
-- Emitters. Notifications are emitted by triggers rather than by each call
-- site, because most of these rows are written inside SECURITY DEFINER
-- functions (set_mission_approval, review_badge_claim, review_activity_score_
-- edit). A trigger fires for those too, so the notification cannot be
-- forgotten by a code path that never knew notifications existed.
--
-- Also fixed here: the realtime guard checked for a table called
-- "notifications" instead of "app_notifications", so if that unrelated table
-- was already in the publication the bell's live updates were never enabled.

-- The four helpers below are deliberately NOT granted to authenticated. They are
-- only ever called from inside other SECURITY DEFINER functions and triggers,
-- which run with the definer's rights. Leaving them callable would let any
-- signed-in student write a notification into anybody's bell.

-- ── Addressing at the right size ──────────────────────────────────────────
create or replace function public.notify_user(
  p_recipient_user_id uuid,
  p_classroom_id uuid,
  p_audience text,
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_recipient_user_id is null then return null; end if;

  insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
  values (p_classroom_id, p_recipient_user_id, p_audience, p_kind, p_title, p_body, p_link)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.notify_user(uuid, uuid, text, text, text, text, text) from public;

-- One event, several classrooms: a mission approved for a list of classes, or a
-- shared Power-Up that reaches every Mathematics class.
create or replace function public.notify_classrooms(
  p_classroom_ids uuid[],
  p_audience text,
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_classroom uuid;
  v_count integer := 0;
begin
  foreach v_classroom in array coalesce(p_classroom_ids, '{}'::uuid[])
  loop
    v_count := v_count + cardinality(
      public.notify_classroom(v_classroom, p_audience, p_kind, p_title, p_body, p_link)
    );
  end loop;
  return v_count;
end;
$$;

revoke all on function public.notify_classrooms(uuid[], text, text, text, text, text) from public;

-- Everyone in one group, for a group-wide result.
create or replace function public.notify_group(
  p_group_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  -- notify_classroom targets a whole classroom, so a group result is fanned out
  -- to this group's own accounts instead of disturbing the rest of the class.
  with sent as (
    insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
    select g.classroom_id, ga.user_id, 'student', p_kind, p_title, p_body, p_link
    from public.groups g
    join public.group_accounts ga on ga.group_id = g.id
    where g.id = p_group_id and ga.is_approved and ga.user_id is not null
    returning id
  )
  select count(*) into v_count from sent;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.notify_group(uuid, text, text, text, text) from public;

-- One student's account, found from their roster row.
create or replace function public.notify_member(
  p_member_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_classroom uuid;
begin
  if p_member_id is null then return 0; end if;

  for v_classroom in
    select distinct ga.classroom_id
    from public.group_accounts ga
    where ga.group_member_id = p_member_id and ga.is_approved and ga.user_id is not null
  loop
    v_count := v_count + 1;
    perform public.notify_user(
      (select ga.user_id from public.group_accounts ga
        where ga.group_member_id = p_member_id and ga.classroom_id = v_classroom
          and ga.is_approved and ga.user_id is not null
        limit 1),
      v_classroom, 'student', p_kind, p_title, p_body, p_link);
  end loop;

  return v_count;
end;
$$;

revoke all on function public.notify_member(uuid, text, text, text, text) from public;

-- ── Teacher announcements reach the class ────────────────────────────────
create or replace function public.emit_announcement_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_classroom(
    new.classroom_id, 'student', 'announcement',
    case when new.is_pinned then 'Pinned announcement' else 'New announcement' end,
    new.title,
    '/'
  );
  return null;
end;
$$;

drop trigger if exists announcements_notify on public.announcements;
create trigger announcements_notify
  after insert on public.announcements
  for each row execute function public.emit_announcement_notification();

-- ── Missions: approval publishes, a status change is news ────────────────
create or replace function public.announcement_teacher_of(p_classroom_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select c.teacher_id from public.classrooms c where c.id = p_classroom_id;
$$;

revoke all on function public.announcement_teacher_of(uuid) from public;

create or replace function public.mission_classroom_ids(p_mission public.missions)
returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[] := '{}';
begin
  if p_mission.applies_to_all_classes then
    select coalesce(array_agg(c.id), '{}'::uuid[]) into v_ids
    from public.classrooms c
    where exists (select 1 from public.group_accounts ga where ga.classroom_id = c.id);
    return v_ids;
  end if;

  if cardinality(coalesce(p_mission.target_classroom_ids, '{}'::uuid[])) > 0 then
    return p_mission.target_classroom_ids;
  end if;

  if p_mission.classroom_id is not null then
    return array[p_mission.classroom_id];
  end if;

  -- The shared Power-Up belongs to no classroom; it lands on every Mathematics
  -- class that actually has students.
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

create or replace function public.emit_mission_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_published boolean := false;
  v_closed boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_published := new.approval_status = 'approved'
      and (old.approval_status is distinct from 'approved' or new.is_active is distinct from old.is_active);
    v_closed := old.is_active and not new.is_active;
  else
    v_published := new.approval_status = 'approved';
  end if;

  if v_published then
    perform public.notify_classrooms(
      public.mission_classroom_ids(new), 'student', 'mission',
      'New mission: ' || left(coalesce(new.title, 'Mission'), 80),
      case when new.deadline is not null
        then 'Worth ' || coalesce(new.xp_reward, 0) || ' XP. Due ' || new.deadline::text || '.'
        else 'Worth ' || coalesce(new.xp_reward, 0) || ' XP.'
      end,
      '/student/missions'
    );
  elsif v_closed then
    perform public.notify_classrooms(
      public.mission_classroom_ids(new), 'student', 'mission_status',
      'Mission closed: ' || left(coalesce(new.title, 'Mission'), 80),
      'This mission is no longer available.',
      '/student/missions'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists missions_notify on public.missions;
create trigger missions_notify
  after insert or update of approval_status, is_active on public.missions
  for each row execute function public.emit_mission_notification();

-- The morning Power-Up waits for a teacher, so tell the Mathematics teachers.
create or replace function public.emit_power_up_review_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mission_source <> 'daily_foundation' then return null; end if;
  if coalesce(new.approval_status, 'pending') <> 'pending' then return null; end if;

  perform public.notify_classrooms(
    public.mission_classroom_ids(new), 'teacher', 'mission_status',
    'Power-Up waiting for review',
    'The Daily Math Power-Up for ' || coalesce(new.auto_daily_date::text, 'today')
      || ' is ready. Students cannot see it until you approve it.',
    '/teacher/missions'
  );
  return null;
end;
$$;

drop trigger if exists missions_notify_power_up on public.missions;
create trigger missions_notify_power_up
  after insert on public.missions
  for each row execute function public.emit_power_up_review_notification();

-- ── Badges: a claim asks the teacher, a decision tells the student ────────
create or replace function public.badge_label(p_badge public.badges)
returns text language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(
    (select bd.title from public.badge_definitions bd where bd.id = p_badge.badge_definition_id),
    nullif(regexp_replace(p_badge.badge_type, '^custom:[0-9a-f-]+(:[0-9a-f-]+)?$', 'Badge'), ''),
    replace(p_badge.badge_type, '_', ' ')
  );
end;
$$;

revoke all on function public.badge_label(public.badges) from public;

create or replace function public.emit_badge_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_label text;
begin
  v_label := public.badge_label(new);

  if tg_op = 'INSERT' then
    if coalesce(new.approval_status, 'pending') = 'pending' then
      perform public.notify_classrooms(
        array[new.classroom_id], 'teacher', 'badge',
        'Badge requested: ' || left(v_label, 80),
        'A student is waiting for you to review it.',
        '/teacher/badges'
      );
    end if;
    return null;
  end if;

  if new.approval_status is not distinct from old.approval_status then
    -- Still pending, but the student re-sent it with new numbers.
    if coalesce(new.approval_status, 'pending') = 'pending'
       and new.request_snapshot is distinct from old.request_snapshot then
      perform public.notify_classrooms(
        array[new.classroom_id], 'teacher', 'badge',
        'Badge re-requested: ' || left(v_label, 80),
        'The requester updated their stats and asked again.',
        '/teacher/badges'
      );
    end if;
    return null;
  end if;

  if new.approval_status = 'approved' then
    if new.member_id is not null then
      perform public.notify_member(
        new.member_id, 'badge_award',
        'Badge approved: ' || left(v_label, 80),
        'Your teacher approved it. +' || coalesce(new.points_awarded, 0) || ' points added.',
        '/student/badges'
      );
    else
      perform public.notify_group(
        new.group_id, 'badge_award',
        'Badge approved: ' || left(v_label, 80),
        'Your group earned it. +' || coalesce(new.points_awarded, 0) || ' points added to the group.',
        '/student/badges'
      );
    end if;
  elsif new.approval_status = 'rejected' then
    if new.member_id is not null then
      perform public.notify_member(
        new.member_id, 'badge',
        'Badge declined: ' || left(v_label, 80),
        'Your teacher declined this request, so no points were added.',
        '/student/badges'
      );
    else
      perform public.notify_group(
        new.group_id, 'badge',
        'Badge declined: ' || left(v_label, 80),
        'Your teacher declined this request, so no points were added.',
        '/student/badges'
      );
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists badges_notify on public.badges;
create trigger badges_notify
  after insert or update on public.badges
  for each row execute function public.emit_badge_notification();

-- ── Score edits: the student asks, the teacher answers ────────────────────
create or replace function public.emit_score_edit_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_activity text;
begin
  select coalesce(a.title, 'an activity') into v_activity
  from public.activities a where a.id = new.activity_id;

  if tg_op = 'INSERT' then
    perform public.notify_classrooms(
      array[new.classroom_id], 'teacher', 'score_edit',
      'Score change requested',
      new.current_score::text || ' to ' || new.proposed_score::text
        || ' on ' || v_activity || '. Fresh proof is attached for you to check.',
      '/teacher/evidence'
    );
    return null;
  end if;

  if new.status is not distinct from old.status then return null; end if;

  if new.status = 'approved' then
    perform public.notify_member(
      new.group_member_id, 'score_edit',
      'Score change approved',
      v_activity || ' is now ' || new.proposed_score::text || '.',
      '/student/scores'
    );
  elsif new.status = 'rejected' then
    perform public.notify_member(
      new.group_member_id, 'score_edit',
      'Score change declined',
      'Your teacher kept ' || v_activity || ' at ' || new.current_score::text
        || '. Upload fresh proof and ask again.',
      '/student/scores'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists score_edit_requests_notify on public.activity_score_edit_requests;
create trigger score_edit_requests_notify
  after insert or update of status on public.activity_score_edit_requests
  for each row execute function public.emit_score_edit_notification();

-- ── Rewards follow the same request/decide shape ─────────────────────────
create or replace function public.emit_reward_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.approval_status, 'pending') = 'pending' then
      perform public.notify_classrooms(
        array[new.classroom_id], 'teacher', 'reward',
        'Reward requested: ' || left(coalesce(new.reward_title, 'Reward'), 80),
        'A student is waiting for you to review it.',
        '/teacher/rewards'
      );
    end if;
    return null;
  end if;

  if new.approval_status is not distinct from old.approval_status then return null; end if;

  if new.approval_status = 'approved' then
    perform public.notify_group(
      new.group_id, 'reward',
      'Reward approved: ' || left(coalesce(new.reward_title, 'Reward'), 80),
      'Your teacher approved it.',
      '/student/rewards'
    );
  elsif new.approval_status = 'rejected' then
    perform public.notify_group(
      new.group_id, 'reward',
      'Reward declined: ' || left(coalesce(new.reward_title, 'Reward'), 80),
      'Your teacher declined this request.',
      '/student/rewards'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists reward_redemptions_notify on public.reward_redemptions;
create trigger reward_redemptions_notify
  after insert or update of approval_status on public.reward_redemptions
  for each row execute function public.emit_reward_notification();

-- ── A student should hear about points moving in their own account ────────
create or replace function public.emit_points_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_removed boolean := false;
  v_points numeric;
begin
  if new.reversed_at is not null and (tg_op = 'INSERT' or old.reversed_at is null) then
    v_removed := true;
    v_points := coalesce(new.reversed_points, 0);
  elsif new.event_type = 'manual_award' and (tg_op = 'INSERT' or old.points_awarded = 0) then
    v_points := coalesce(new.points_awarded, 0);
  else
    return null;
  end if;

  if new.group_member_id is not null then
    perform public.notify_member(
      new.group_member_id,
      'points',
      case when v_removed then 'Points removed' else 'Points awarded' end,
      case when v_removed
        then 'Your teacher removed ' || v_points::text || ' points'
             || coalesce(' (' || new.reversal_reason || ')', '') || '.'
        else 'Your teacher gave you ' || v_points::text || ' points'
             || coalesce(' for ' || new.note, '') || '.'
      end,
      '/student/history'
    );
  end if;

  return null;
end;
$$;

drop trigger if exists participation_logs_notify on public.participation_logs;
create trigger participation_logs_notify
  after insert or update on public.participation_logs
  for each row execute function public.emit_points_notification();

-- ── Live updates, and the guard that was checking the wrong table name ───
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_notifications'
  ) then
    raise notice 'app_notifications is already in the realtime publication';
  else
    alter publication supabase_realtime add table public.app_notifications;
  end if;
end;
$$;

