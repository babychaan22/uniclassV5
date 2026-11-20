-- 20261228 — fix the duplicate-key failure when a student links to an
-- already-claimed record, and make rejecting such a request non-destructive.
--
-- Bug 1 (user-reported): selecting an existing roster name on the classroom
-- whose record already has a sign-in inserts a SECOND group_accounts row for
-- the same group_members.id. The production constraint uq_group_accounts_member
-- enforces one sign-in row per member, so the insert fails with
-- "duplicate key value violates unique constraint uq_group_accounts_member"
-- and the student is stuck.
--
-- Bug 2 (found while fixing): the teacher's reject button for a pending
-- request called remove_student_from_class, which deletes the member row and
-- the learner's history (scores, attendance, badges, assessments). For a
-- reclaim request, rejecting the link would have erased the record the
-- student was trying to recover.
--
-- Fix: a reclaim becomes an update in place of the member's single sign-in
-- row (remembering the previous holder), and rejecting restores the previous
-- holder instead of deleting anything. Teacher approval keeps working: the
-- row was the member's real sign-in all along, so approving grants the new
-- login to the existing record and its full history.

alter table public.group_accounts
  add column if not exists previous_user_id uuid,
  add column if not exists previous_email text,
  add column if not exists previous_is_approved boolean;

-- ── Joining, with reclaim-as-update ────────────────────────────────────────
create or replace function public.join_classroom(
  p_join_code text,
  p_group_id uuid,
  p_last_name text,
  p_first_name text,
  p_email text,
  p_wants_representative boolean default false,
  p_teammates jsonb default '[]'::jsonb,
  p_group_member_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_classroom classrooms%rowtype;
  v_group groups%rowtype;
  v_member group_members%rowtype;
  v_existing group_members%rowtype;
  v_existing_account group_accounts%rowtype;
  v_teammate jsonb;
  v_is_rep boolean;
  v_uses_groups boolean;
  v_claimed boolean;
  v_name text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select * into v_classroom from classrooms where upper(join_code)=upper(trim(p_join_code)) limit 1;
  if not found then raise exception 'Invalid join code'; end if;
  if exists (select 1 from group_accounts where user_id=v_user and classroom_id=v_classroom.id) then
    raise exception 'You are already enrolled in this class';
  end if;
  if exists (select 1 from group_accounts where classroom_id=v_classroom.id and lower(email)=lower(trim(p_email))) then
    raise exception 'That email is already enrolled';
  end if;

  v_uses_groups := coalesce(v_classroom.uses_groups, true);

  if p_group_member_id is not null then
    -- The student selected a roster name. Follow that record's own group: the
    -- person's history lives with the row, not with the group picked on the
    -- previous screen.
    select * into v_member from group_members
      where id=p_group_member_id and classroom_id=v_classroom.id
        and not coalesce(is_transferred, false)
      for update;
    if not found then raise exception 'That student is not in this class'; end if;
    if v_member.group_id is null then raise exception 'That student has no group yet'; end if;
    select * into v_group from groups where id=v_member.group_id and classroom_id=v_classroom.id for update;
    if not found then raise exception 'That student is not in this class'; end if;

    -- One sign-in row per member (uq_group_accounts_member). A reclaim request
    -- therefore updates the existing row in place instead of adding a second
    -- one, and remembers the previous holder so the teacher can restore it.
    select * into v_existing_account
      from group_accounts where group_member_id=v_member.id for update;
    v_claimed := found;
    if v_claimed then
      update group_accounts set
        user_id = v_user,
        email = trim(p_email),
        is_approved = false,
        is_reclaim_request = true,
        previous_user_id = v_existing_account.user_id,
        previous_email = v_existing_account.email,
        previous_is_approved = v_existing_account.is_approved
      where id = v_existing_account.id;
      return jsonb_build_object(
        'classroom',jsonb_build_object('id',v_classroom.id,'grade_level',v_classroom.grade_level,'section',v_classroom.section,'school_year',v_classroom.school_year),
        'group_id',v_group.id,'group_member_id',v_member.id,'reclaim_request',true,'status','pending'
      );
    end if;

    update group_members set is_account_holder=true where id=v_member.id returning * into v_member;
  else
    if v_uses_groups then
      select * into v_group from groups where id=p_group_id and classroom_id=v_classroom.id for update;
      if not found then raise exception 'Invalid group for this classroom'; end if;
    else
      insert into groups(classroom_id,group_number,group_name)
        values(v_classroom.id,0,upper(trim(p_last_name))||', '||upper(trim(p_first_name)))
        returning * into v_group;
    end if;

    -- A typed name is matched across the whole classroom, not just the selected
    -- group: a representative can file a student under the wrong group, and
    -- that must not be a way to end up with two rows for one person.
    v_name := public.normalised_person_name(p_first_name, p_last_name);

    select * into v_existing
      from group_members m
      where m.classroom_id = v_classroom.id
        and not coalesce(m.is_transferred, false)
        and public.normalised_person_name(m.first_name, m.last_name) = v_name
      order by m.created_date
      limit 1;

    if found then
      if exists (select 1 from group_accounts where group_member_id = v_existing.id) then
        raise exception '% % already has a class record with a sign-in. If that is you, go back and select your name on the roster to send your teacher a link request.', v_existing.first_name, v_existing.last_name;
      end if;

      raise exception 'That name is already on this class roster. Go back and select the existing student instead of typing it.';
    end if;

    insert into group_members(group_id,classroom_id,last_name,first_name,is_account_holder)
      values(v_group.id,v_classroom.id,upper(trim(p_last_name)),upper(trim(p_first_name)),true)
      returning * into v_member;
  end if;

  v_is_rep := case when v_uses_groups then p_wants_representative else true end;

  -- A claim (or reclaim) of a roster row never takes the representative role
  -- from the group: the existing member record keeps it.
  if v_is_rep and v_uses_groups then
    if exists (select 1 from group_accounts where group_id=v_group.id and is_representative) then
      raise exception 'This group already has a representative';
    end if;
    for v_teammate in select * from jsonb_array_elements(coalesce(p_teammates,'[]'::jsonb)) loop
      if nullif(trim(v_teammate->>'last_name'),'') is not null
         and nullif(trim(v_teammate->>'first_name'),'') is not null
         and not exists (
           select 1 from group_members m
           where m.classroom_id = v_classroom.id
             and public.normalised_person_name(m.first_name, m.last_name)
                 = public.normalised_person_name(v_teammate->>'first_name', v_teammate->>'last_name')
         ) then
        insert into group_members(group_id,classroom_id,last_name,first_name,is_account_holder)
          values(v_group.id,v_classroom.id,upper(trim(v_teammate->>'last_name')),upper(trim(v_teammate->>'first_name')),false);
      end if;
    end loop;
  end if;

  insert into group_accounts(user_id,group_id,classroom_id,group_member_id,last_name,first_name,email,is_approved,is_representative)
    values(v_user,v_group.id,v_classroom.id,v_member.id,v_member.last_name,v_member.first_name,trim(p_email),false,v_is_rep);
  return jsonb_build_object(
    'classroom',jsonb_build_object('id',v_classroom.id,'grade_level',v_classroom.grade_level,'section',v_classroom.section,'school_year',v_classroom.school_year),
    'group_id',v_group.id,'group_member_id',v_member.id,'linked_existing_member',p_group_member_id is not null,'reclaim_request',false,'status','pending'
  );
end;
$$;

revoke all on function public.join_classroom(text,uuid,text,text,text,boolean,jsonb,uuid) from public;
grant execute on function public.join_classroom(text,uuid,text,text,text,boolean,jsonb,uuid) to authenticated;

-- ── Reject a pending request without destroying learner data ───────────────
-- Reclaim request → restore the previous holder (owner keeps their record).
-- Fresh join request → remove only the pending sign-in and its brand-new
-- member row; nothing yet attaches to it, so no history can be lost.
create or replace function public.reject_group_account_request(p_group_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account group_accounts%rowtype;
  v_deleted_member boolean := false;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_account from group_accounts where id=p_group_account_id for update;
  if not found then raise exception 'Request not found'; end if;
  if not public.auth_is_teacher_of(v_account.classroom_id) then
    raise exception 'Only the class teacher can review this request';
  end if;

  if coalesce(v_account.is_reclaim_request, false) then
    update group_accounts set
      user_id = coalesce(v_account.previous_user_id, user_id),
      email = coalesce(v_account.previous_email, email),
      is_approved = coalesce(v_account.previous_is_approved, false),
      is_reclaim_request = false,
      previous_user_id = null,
      previous_email = null,
      previous_is_approved = null
    where id = v_account.id;
  else
    delete from group_accounts where id = v_account.id;
    if v_account.group_member_id is not null and not exists (
      select 1 from group_accounts where group_member_id = v_account.group_member_id
    ) then
      delete from group_members where id = v_account.group_member_id;
      v_deleted_member := true;
    end if;
  end if;

  return jsonb_build_object('rejected', true, 'restoredHolder', coalesce(v_account.is_reclaim_request, false), 'deletedMember', v_deleted_member);
end;
$$;

revoke all on function public.reject_group_account_request(uuid) from public;
grant execute on function public.reject_group_account_request(uuid) to authenticated;

-- ── Verification ──────────────────────────────────────────────────────────
do $$
declare
  v_defs text;
  v_problems text[] := '{}';
begin
  select pg_get_functiondef('public.join_classroom(text,uuid,text,text,text,boolean,jsonb,uuid)'::regprocedure) into v_defs;
  if position('previous_user_id' in v_defs) = 0 then
    v_problems := array_append(v_problems, 'a reclaim still tries to add a second sign-in row');
  end if;
  select pg_get_functiondef('public.reject_group_account_request(uuid)'::regprocedure) into v_defs;
  if position('previous_user_id' in v_defs) = 0 then
    v_problems := array_append(v_problems, 'rejecting a reclaim does not restore the previous holder');
  end if;
  if array_length(v_problems, 1) is not null then
    raise exception 'Reclaim fix did not install: %', array_to_string(v_problems, '; ');
  end if;
  raise notice 'verified: reclaim updates the single sign-in row in place and rejection restores the previous holder';
end;
$$;
