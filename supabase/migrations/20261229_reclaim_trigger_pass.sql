-- 20261229 — let the reclaim update pass the student-identity guard triggers.
--
-- Error (user-reported): "Only the classroom teacher may change
-- is_representative or is_approved" when selecting an already-claimed roster
-- name to link a new login.
--
-- Root cause: the reclaim (20261228) rewrites the member's single sign-in row
-- (user_id → new login, is_approved → pending). Two BEFORE UPDATE triggers on
-- group_accounts rightly refuse flag/ownership changes from a student JWT:
--   * tg_prevent_account_self_promotion (20260802/20261160)
--   * tg_prevent_student_identity_changes (20260913)
-- join_classroom runs as security definer but with the student's JWT, so both
-- triggers fired.
--
-- Fix: join_classroom's reclaim arm stamps a transaction-local marker bound to
-- the requesting user (set_config 'app.reclaim_user'). The triggers accept the
-- flag/ownership changes only when ALL hold:
--   * the marker is present and equals the caller,
--   * the row is being turned INTO a reclaim request (is_reclaim_request=true),
--   * it ends up unapproved (is_approved=false) with a changed user_id.
-- No self-promotion is possible: the shape always ends unapproved and flagged;
-- only a teacher session (or the reject/approve RPCs, which run as teacher)
-- can flip is_approved back to true, because the other trigger arms keep the
-- original checks. PostgREST clients cannot set custom GUCs, so the marker
-- cannot be forged from the outside.

create or replace function public._prevent_account_self_promotion()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_representative <> old.is_representative or new.is_approved <> old.is_approved then
    if exists (select 1 from public.classrooms where id = new.classroom_id and teacher_id = auth.uid()) then
      return new;
    end if;
    -- Controlled reclaim takeover: a new login claims the record and parks it
    -- as an unapproved, flagged request for the teacher to review.
    if new.is_reclaim_request
       and not new.is_approved
       and new.is_representative = old.is_representative
       and new.user_id is distinct from old.user_id
       and current_setting('app.reclaim_user', true) = coalesce(auth.uid()::text, '')
       and new.user_id = (nullif(current_setting('app.reclaim_user', true), ''))::uuid
    then
      return new;
    end if;
    raise exception 'Only the classroom teacher may change is_representative or is_approved'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_student_identity_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (
    select 1 from classrooms where id=old.classroom_id and teacher_id=auth.uid()
  ) then
    if new.user_id <> old.user_id or new.classroom_id <> old.classroom_id
       or new.group_id <> old.group_id or new.group_member_id is distinct from old.group_member_id
       or new.is_approved <> old.is_approved or new.is_representative <> old.is_representative then
      -- Same controlled reclaim takeover as the promotion guard above.
      if new.is_reclaim_request
         and not new.is_approved
         and new.is_representative = old.is_representative
         and new.classroom_id = old.classroom_id
         and new.group_id = old.group_id
         and new.group_member_id is not distinct from old.group_member_id
         and new.user_id = (nullif(current_setting('app.reclaim_user', true), ''))::uuid
         and current_setting('app.reclaim_user', true) = coalesce(auth.uid()::text, '')
      then
        return new;
      end if;
      raise exception 'Students cannot change account ownership or approval state';
    end if;
  end if;
  return new;
end;
$$;

-- ── Stamp the marker inside the reclaim arm of join_classroom ──────────────
-- Redefine with the one-line addition (the migration file 20261228 keeps the
-- canonical source; the statement below is its current definition plus the
-- set_config stamp right before the in-place update).
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
    select * into v_member from group_members
      where id=p_group_member_id and classroom_id=v_classroom.id
        and not coalesce(is_transferred, false)
      for update;
    if not found then raise exception 'That student is not in this class'; end if;
    if v_member.group_id is null then raise exception 'That student has no group yet'; end if;
    select * into v_group from groups where id=v_member.group_id and classroom_id=v_classroom.id for update;
    if not found then raise exception 'That student is not in this class'; end if;

    select * into v_existing_account
      from group_accounts where group_member_id=v_member.id for update;
    v_claimed := found;
    if v_claimed then
      -- Bind this transaction to the requesting login so the identity guard
      -- triggers accept exactly this takeover shape.
      perform set_config('app.reclaim_user', v_user::text, true);
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

-- ── Verification ──────────────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_problems text[] := '{}';
begin
  select pg_get_functiondef('public.join_classroom(text,uuid,text,text,text,boolean,jsonb,uuid)'::regprocedure) into v_def;
  if position('app.reclaim_user' in v_def) = 0 then
    v_problems := array_append(v_problems, 'join_classroom does not stamp the reclaim marker');
  end if;
  select pg_get_functiondef('public._prevent_account_self_promotion()'::regprocedure) into v_def;
  if position('app.reclaim_user' in v_def) = 0 then
    v_problems := array_append(v_problems, 'the promotion trigger does not recognise the controlled reclaim');
  end if;
  select pg_get_functiondef('public.prevent_student_identity_changes()'::regprocedure) into v_def;
  if position('app.reclaim_user' in v_def) = 0 then
    v_problems := array_append(v_problems, 'the identity trigger does not recognise the controlled reclaim');
  end if;
  if array_length(v_problems, 1) is not null then
    raise exception 'Reclaim trigger pass did not install: %', array_to_string(v_problems, '; ');
  end if;
  raise notice 'verified: reclaim takeover passes both identity guards only in its controlled shape';
end;
$$;
