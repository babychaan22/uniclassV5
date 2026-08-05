-- ============================================================
-- RLS Tightening — UniClass
-- Run in Supabase Dashboard → SQL Editor
--
-- What this does:
--   1. Creates three `security definer` helper functions used by policies
--      (definer so RLS on classrooms/group_accounts isn't re-entered).
--   2. Adds a trigger that prevents a student from self-promoting to
--      representative or self-approving their group_account row.
--   3. Drops the blanket "authenticated_full_access" policies.
--   4. Replaces them with ownership-scoped policies:
--        • Teachers  → full CRUD on their own classroom's rows.
--        • Representatives → write attendance & QR scans for their group only.
--        • All students  → read their classroom; insert participation / missions /
--                          rewards for themselves/their group.
--        • Profiles  → own row only.
--
-- Safe to run on an existing database — all `create policy` statements use
-- unique names, and `drop policy if exists` removes only the blanket policy.
-- ============================================================


-- ============================================================
-- STEP 1 — Helper functions (security definer bypasses RLS inside them)
-- ============================================================

-- Is auth.uid() the teacher of a classroom?
create or replace function auth_is_teacher_of(p_classroom_id uuid)
returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from classrooms
    where id = p_classroom_id
      and teacher_id = auth.uid()
  );
$$;

-- Is auth.uid() an approved member in a classroom?
create or replace function auth_in_classroom(p_classroom_id uuid)
returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from group_accounts
    where user_id      = auth.uid()
      and classroom_id = p_classroom_id
      and is_approved  = true
  );
$$;

-- Return the group_id of auth.uid()'s representative account in a classroom.
-- Returns NULL if the user is not a rep there.
-- (Unique-index on group_accounts ensures at most one rep per group.)
create or replace function auth_rep_group_id(p_classroom_id uuid)
returns uuid
language sql security definer stable as $$
  select group_id
  from   group_accounts
  where  user_id          = auth.uid()
    and  classroom_id     = p_classroom_id
    and  is_representative = true
    and  is_approved       = true
  limit 1;
$$;


-- ============================================================
-- STEP 2 — Trigger: block self-promotion on group_accounts
--
-- Without this, the student_update_own_account policy would let a
-- student flip their own is_representative or is_approved flag.
-- The trigger fires BEFORE any UPDATE and aborts if those columns
-- change via a non-teacher session.
-- ============================================================

create or replace function _prevent_account_self_promotion()
returns trigger
language plpgsql security definer as $$
begin
  if (new.is_representative <> old.is_representative
      or new.is_approved    <> old.is_approved) then
    -- Allow only if the caller is the teacher of that classroom.
    if not exists (
      select 1 from classrooms
      where id = new.classroom_id and teacher_id = auth.uid()
    ) then
      raise exception 'Only the classroom teacher may change is_representative or is_approved'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_prevent_account_self_promotion on group_accounts;
create trigger tg_prevent_account_self_promotion
  before update on group_accounts
  for each row execute procedure _prevent_account_self_promotion();


-- ============================================================
-- STEP 3 — Drop blanket policies
-- ============================================================

do $$
declare tbl text;
begin
  foreach tbl in array array[
    'classrooms','class_settings','grading_terms','groups','group_members',
    'group_accounts','activities','activity_scores','attendances',
    'teacher_assessments','qr_codes','participation_logs','badges',
    'missions','mission_submissions','rewards','reward_redemptions',
    'announcements','profiles'
  ]
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I', tbl
    );
  end loop;
end $$;


-- ============================================================
-- STEP 4 — Scoped policies, table by table
-- ============================================================

-- ── classrooms ───────────────────────────────────────────────────────────────
create policy "teacher_own_classrooms"
  on classrooms for all to authenticated
  using  (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

create policy "student_read_classroom"
  on classrooms for select to authenticated
  using (
    id in (
      select classroom_id from group_accounts
      where user_id = auth.uid() and is_approved = true
    )
  );


-- ── class_settings ───────────────────────────────────────────────────────────
create policy "teacher_write_class_settings"
  on class_settings for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_class_settings"
  on class_settings for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── grading_terms ────────────────────────────────────────────────────────────
create policy "teacher_write_grading_terms"
  on grading_terms for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_grading_terms"
  on grading_terms for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── groups ───────────────────────────────────────────────────────────────────
create policy "teacher_write_groups"
  on groups for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_groups"
  on groups for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── group_members ────────────────────────────────────────────────────────────
create policy "teacher_write_group_members"
  on group_members for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_group_members"
  on group_members for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── group_accounts ───────────────────────────────────────────────────────────
-- Teacher: full access to their classroom's accounts (approve, link member, etc.)
create policy "teacher_manage_group_accounts"
  on group_accounts for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

-- Students: read all accounts in their classroom (leaderboard, peer lookups)
create policy "student_read_group_accounts"
  on group_accounts for select to authenticated
  using (auth_in_classroom(classroom_id));

-- Students: insert their own row during onboarding
create policy "student_insert_own_account"
  on group_accounts for insert to authenticated
  with check (user_id = auth.uid());

-- Students: update their own row (name corrections, etc.)
-- is_representative / is_approved changes are blocked by the trigger above.
create policy "student_update_own_account"
  on group_accounts for update to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ── activities ───────────────────────────────────────────────────────────────
create policy "teacher_write_activities"
  on activities for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_activities"
  on activities for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── activity_scores ──────────────────────────────────────────────────────────
-- Only teachers write these (via ScoreImport); students read their own class.
create policy "teacher_write_activity_scores"
  on activity_scores for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_activity_scores"
  on activity_scores for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── attendances — THE critical table ─────────────────────────────────────────
--
-- Attack that this closes:
--   A rep from Group 1 could previously call the Supabase API directly and
--   POST an attendance row with group_member_id = <someone in Group 2>.
--   Now, both the group_id and every group_member_id in the payload are
--   checked against the caller's actual group at the database level.
--
-- Teachers: unrestricted access to their classroom
create policy "teacher_write_attendances"
  on attendances for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

-- All students: read their classroom's attendance
create policy "student_read_attendances"
  on attendances for select to authenticated
  using (auth_in_classroom(classroom_id));

-- Representatives: INSERT — only for members of their own group
create policy "rep_insert_attendances"
  on attendances for insert to authenticated
  with check (
    -- Caller must be a rep in this classroom
    auth_rep_group_id(classroom_id) is not null
    -- Row's group_id must match caller's group
    and group_id = auth_rep_group_id(classroom_id)
    -- Row's group_member_id must belong to caller's group
    and group_member_id in (
      select id from group_members
      where group_id = auth_rep_group_id(classroom_id)
    )
  );

-- Representatives: UPDATE — same ownership check on existing + new row
create policy "rep_update_attendances"
  on attendances for update to authenticated
  using (
    auth_rep_group_id(classroom_id) is not null
    and group_id = auth_rep_group_id(classroom_id)
  )
  with check (
    auth_rep_group_id(classroom_id) is not null
    and group_id = auth_rep_group_id(classroom_id)
    and group_member_id in (
      select id from group_members
      where group_id = auth_rep_group_id(classroom_id)
    )
  );


-- ── teacher_assessments ──────────────────────────────────────────────────────
-- Only teachers write; students read.
create policy "teacher_write_assessments"
  on teacher_assessments for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_assessments"
  on teacher_assessments for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── qr_codes ─────────────────────────────────────────────────────────────────
-- Teachers create/manage QR codes.
create policy "teacher_write_qr_codes"
  on qr_codes for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

-- Students read QR codes to verify hashes during scan.
create policy "student_read_qr_codes"
  on qr_codes for select to authenticated
  using (auth_in_classroom(classroom_id));

-- Students mark a QR code as used — but only:
--   • The code was previously unused (is_used = false in the existing row).
--   • They set is_used = true and used_by_member_id to a member of their own group.
-- This prevents a student from marking codes used for another group's members.
create policy "student_scan_qr_code"
  on qr_codes for update to authenticated
  using (
    auth_in_classroom(classroom_id)
    and is_used = false     -- can only touch unused codes
  )
  with check (
    is_used = true
    and used_by_member_id in (
      select gm.id
      from   group_members gm
      join   group_accounts ga on ga.group_id = gm.group_id
      where  ga.user_id = auth.uid()
        and  ga.is_approved = true
    )
  );


-- ── participation_logs ───────────────────────────────────────────────────────
-- Students insert their own scan logs; teachers read all.
create policy "teacher_read_participation_logs"
  on participation_logs for select to authenticated
  using (auth_is_teacher_of(classroom_id));

create policy "student_read_participation_logs"
  on participation_logs for select to authenticated
  using (auth_in_classroom(classroom_id));

create policy "student_insert_participation_log"
  on participation_logs for insert to authenticated
  with check (
    auth_in_classroom(classroom_id)
    -- The logged member must belong to the caller's own group
    and group_member_id in (
      select ga.group_member_id from group_accounts ga
      where ga.user_id = auth.uid() and ga.is_approved = true
    )
  );

-- Teachers can add manual bonus/penalty logs
create policy "teacher_insert_participation_log"
  on participation_logs for insert to authenticated
  with check (auth_is_teacher_of(classroom_id));


-- ── badges ───────────────────────────────────────────────────────────────────
create policy "teacher_write_badges"
  on badges for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_badges"
  on badges for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── missions ─────────────────────────────────────────────────────────────────
create policy "teacher_write_missions"
  on missions for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_missions"
  on missions for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── mission_submissions ──────────────────────────────────────────────────────
-- Teachers grade and read all submissions; students submit for their own group.
create policy "teacher_manage_submissions"
  on mission_submissions for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_submissions"
  on mission_submissions for select to authenticated
  using (auth_in_classroom(classroom_id));

create policy "student_submit_mission"
  on mission_submissions for insert to authenticated
  with check (
    auth_in_classroom(classroom_id)
    and group_id in (
      select group_id from group_accounts
      where user_id = auth.uid() and is_approved = true
    )
  );


-- ── rewards ──────────────────────────────────────────────────────────────────
create policy "teacher_write_rewards"
  on rewards for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_rewards"
  on rewards for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── reward_redemptions ───────────────────────────────────────────────────────
create policy "teacher_manage_redemptions"
  on reward_redemptions for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_redemptions"
  on reward_redemptions for select to authenticated
  using (auth_in_classroom(classroom_id));

create policy "student_redeem_reward"
  on reward_redemptions for insert to authenticated
  with check (
    auth_in_classroom(classroom_id)
    and group_id in (
      select group_id from group_accounts
      where user_id = auth.uid() and is_approved = true
    )
  );


-- ── announcements ────────────────────────────────────────────────────────────
create policy "teacher_write_announcements"
  on announcements for all to authenticated
  using  (auth_is_teacher_of(classroom_id))
  with check (auth_is_teacher_of(classroom_id));

create policy "student_read_announcements"
  on announcements for select to authenticated
  using (auth_in_classroom(classroom_id));


-- ── profiles ─────────────────────────────────────────────────────────────────
-- Users manage their own profile row; nothing else is accessible.
create policy "own_profile"
  on profiles for all to authenticated
  using  (id = auth.uid())
  with check (id = auth.uid());
