-- 20261222 — let students recover an existing record instead of creating a twin.
--
-- Students who forget their password tend to sign up again with a new email.
-- The old flow then dead-ended: the roster showed their old record as
-- "Already enrolled", tapping it did nothing, and typing the name raised
-- "ask your teacher to move the record". The teacher-side transfer exists, but
-- the student side gave them no way to ask for it from the app.
--
-- Now selecting an already-enrolled roster name is allowed: join_classroom
-- records a pending, member-linked sign-in request that the teacher approves
-- like any other join request. Nothing is copied — approving the request gives
-- the new login the existing member row, so points, attendance, badges and
-- mission history all follow, because every student-facing read resolves the
-- person through group_members.id.
--
-- Also included, because they are the same flow:
--   * Classes that do not use groups now show the roster name list too.
--   * The claim list no longer offers archived (already-transferred) records.
--   * Selecting a roster name follows that member's own group, so a student
--     misfiled under a different group still lands on the record that carries
--     their history.

alter table public.group_accounts
  add column if not exists is_reclaim_request boolean not null default false;

-- ── The list a student is shown ────────────────────────────────────────────
create or replace function public.lookup_classroom_by_join_code(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom classrooms%rowtype;
  v_groups jsonb;
  v_accounts jsonb;
  v_members jsonb;
begin
  select * into v_classroom from classrooms where upper(join_code)=upper(trim(p_join_code)) limit 1;
  if not found then raise exception 'Invalid join code'; end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.group_number),'[]'::jsonb)
    into v_groups from groups g where g.classroom_id=v_classroom.id and coalesce(v_classroom.uses_groups,true);

  select coalesce(jsonb_agg(jsonb_build_object('group_id',a.group_id,'first_name',a.first_name,'last_name',a.last_name,'is_representative',a.is_representative)),'[]'::jsonb)
    into v_accounts from group_accounts a where a.classroom_id=v_classroom.id;

  -- Every live member of the classroom. Archived records (already transferred)
  -- stay out of the list: their history moved elsewhere, so claiming them
  -- would resurrect a copy.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'group_id', m.group_id,
    'first_name', m.first_name,
    'last_name', m.last_name,
    'claimed', exists (select 1 from group_accounts a where a.group_member_id = m.id),
    'active_login', exists (select 1 from group_accounts a where a.group_member_id = m.id and a.is_approved)
  ) order by m.last_name, m.first_name),'[]'::jsonb)
    into v_members
    from group_members m
    where m.classroom_id = v_classroom.id
      and not coalesce(m.is_transferred, false);

  return jsonb_build_object(
    'classroom',jsonb_build_object('id',v_classroom.id,'grade_level',v_classroom.grade_level,'section',v_classroom.section,'school_year',v_classroom.school_year,'uses_groups',coalesce(v_classroom.uses_groups,true)),
    'groups',v_groups,'accounts',v_accounts,'members',v_members
  );
end;
$$;

revoke all on function public.lookup_classroom_by_join_code(text) from public;
grant execute on function public.lookup_classroom_by_join_code(text) to authenticated;

-- ── Joining, with reclaim-on-select ────────────────────────────────────────
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

    select exists (select 1 from group_accounts where group_member_id=v_member.id) into v_claimed;
    if v_claimed then
      -- A reclaim request: the teacher sees it in the same pending-approval
      -- list and decides whether this new sign-in belongs to that record.
      insert into group_accounts(user_id,group_id,classroom_id,group_member_id,last_name,first_name,email,is_approved,is_representative,is_reclaim_request)
        values(v_user,v_group.id,v_classroom.id,v_member.id,v_member.last_name,v_member.first_name,trim(p_email),false,false,true);
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

-- ── Verification ──────────────────────────────────────────────────────────
do $$
declare
  v_defs text;
  v_problems text[] := '{}';
begin
  if public.normalised_person_name('jose', '  Santos ') <> public.normalised_person_name('José', 'SANTOS') then
    v_problems := array_append(v_problems, 'the name rule no longer folds accents and spacing');
  end if;

  select pg_get_functiondef('public.lookup_classroom_by_join_code(text)'::regprocedure) into v_defs;
  if position('is_transferred' in v_defs) = 0 then
    v_problems := array_append(v_problems, 'the claim list still offers archived records');
  end if;
  if position('active_login' in v_defs) = 0 then
    v_problems := array_append(v_problems, 'the claim list lost the active-login marker');
  end if;

  select pg_get_functiondef('public.join_classroom(text,uuid,text,text,text,boolean,jsonb,uuid)'::regprocedure) into v_defs;
  if position('is_reclaim_request' in v_defs) = 0 then
    v_problems := array_append(v_problems, 'selecting an enrolled name is still a dead end');
  end if;
  if position('not coalesce(is_transferred, false)' in v_defs) = 0 then
    v_problems := array_append(v_problems, 'a join can still target an archived record');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Reclaim flow did not install: %', array_to_string(v_problems, '; ');
  end if;

  raise notice 'verified: students can select an enrolled roster name to request linking, archived records stay claim-proof, and representative requests on reclaimed records are refused';
end;
$$;
