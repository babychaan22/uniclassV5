-- 20261154 — stop onboarding from creating a second copy of the same student.
--
-- Two holes let a duplicate through:
--
-- 1. The member list a student is shown only contained members with no account
--    yet. A student who had already enrolled once, then signed up again instead
--    of picking their name, could not see their own row, so there was nothing
--    to pick and a second member was created. The list now carries every member
--    in the classroom with an "already enrolled" marker, so the student can find
--    themselves, and the server refuses a name that is already taken rather
--    than quietly adding another row.
--
-- 2. Matching was upper(trim(...)) on each name. "Jose" and "José", or
--    "Dela Cruz" and "DELACRUZ", compared as different people. Names are now
--    folded with unaccent and internal spacing is ignored, and the check spans
--    the whole classroom instead of one group, because a representative can file
--    a student under the wrong group and that must not create a twin.
--
-- Progress follows the student because every student-facing read resolves the
-- person through group_members.id rather than through the login, so attaching
-- the login to the existing row is what transfers the points, attendance, badges
-- and history. Nothing is copied.

-- ── One definition of "the same name" ─────────────────────────────────────
-- The unaccent extension supplies the accent folding. It is installed here
-- because a name comparison that silently treats "Jose" and "José" as two
-- different students is exactly the duplicate this migration exists to stop.
create extension if not exists unaccent;

-- unaccent is only STABLE, not IMMUTABLE, because its result depends on a
-- search-path-resolved dictionary. This function is therefore STABLE too, which
-- is all a comparison inside a function body needs. It is deliberately not
-- indexed: an index would need the expression to be IMMUTABLE, and labelling it
-- so would be a lie that breaks the moment the dictionary changed.
create or replace function public.normalised_person_name(p_first text, p_last text)
returns text
language sql
stable
as $$
  select
    btrim(
      regexp_replace(
        regexp_replace(
          upper(coalesce(unaccent(coalesce(p_last, '')), '')),
          '[^A-Z0-9]+', ' ', 'g'
        ),
        ' +', ' ', 'g'
      )
    )
    || '|'
    || btrim(
      regexp_replace(
        regexp_replace(
          upper(coalesce(unaccent(coalesce(p_first, '')), '')),
          '[^A-Z0-9]+', ' ', 'g'
        ),
        ' +', ' ', 'g'
      )
    );
$$;

revoke all on function public.normalised_person_name(text, text) from public;
grant execute on function public.normalised_person_name(text, text) to authenticated;

comment on function public.normalised_person_name(text, text) is
  'Uppercase, accent-free, punctuation-free "LAST|FIRST" so the same person spelled two ways compares equal.';

-- The lookup cannot use the index, because unaccent is not immutable, so the
-- guard inside join_classroom keeps the expression explicit and the function
-- above stays the single place the rule is written down.
create index if not exists idx_group_members_classroom_names
  on public.group_members(classroom_id, upper(last_name), upper(first_name));

-- ── The list a student is shown ───────────────────────────────────────────
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

  -- Every member in the classroom, not only the ones without an account. A
  -- student who already enrolled and signed up again needs to see their own
  -- row here, because that row is the one carrying their points. It is marked
  -- so the interface can say so plainly rather than inviting a second claim.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'group_id', m.group_id,
    'first_name', m.first_name,
    'last_name', m.last_name,
    'claimed', exists (select 1 from group_accounts a where a.group_member_id = m.id)
  ) order by m.last_name, m.first_name),'[]'::jsonb)
    into v_members
    from group_members m
    where m.classroom_id = v_classroom.id;

  return jsonb_build_object(
    'classroom',jsonb_build_object('id',v_classroom.id,'grade_level',v_classroom.grade_level,'section',v_classroom.section,'school_year',v_classroom.school_year,'uses_groups',coalesce(v_classroom.uses_groups,true)),
    'groups',v_groups,'accounts',v_accounts,'members',v_members
  );
end;
$$;

revoke all on function public.lookup_classroom_by_join_code(text) from public;
grant execute on function public.lookup_classroom_by_join_code(text) to authenticated;

-- ── Joining, with the duplicate guard widened ─────────────────────────────
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
  v_existing_claimed boolean;
  v_teammate jsonb;
  v_is_rep boolean;
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

  if coalesce(v_classroom.uses_groups, true) then
    select * into v_group from groups where id=p_group_id and classroom_id=v_classroom.id for update;
    if not found then raise exception 'Invalid group for this classroom'; end if;
  else
    insert into groups(classroom_id,group_number,group_name)
      values(v_classroom.id,0,upper(trim(p_last_name))||', '||upper(trim(p_first_name)))
      returning * into v_group;
  end if;

  if p_group_member_id is not null then
    select * into v_member from group_members
      where id=p_group_member_id and classroom_id=v_classroom.id
      for update;
    if not found then raise exception 'That student is not in this class'; end if;
    if exists (select 1 from group_accounts where group_member_id=v_member.id) then
      raise exception 'That student already has an account. Ask your teacher to move the record if this is you.';
    end if;
    update group_members set is_account_holder=true where id=v_member.id returning * into v_member;
  else
    -- A typed name is matched across the whole classroom, not just the selected
    -- group: a representative can file a student under the wrong group, and
    -- that must not be a way to end up with two rows for one person.
    v_name := public.normalised_person_name(p_first_name, p_last_name);

    select * into v_existing
      from group_members m
      where m.classroom_id = v_classroom.id
        and public.normalised_person_name(m.first_name, m.last_name) = v_name
      order by m.created_date
      limit 1;

    if found then
      select exists (select 1 from group_accounts where group_member_id = v_existing.id)
        into v_existing_claimed;

      if v_existing_claimed then
        raise exception '% % is already enrolled in this class. If that is you, ask your teacher to move the record from the other account.', v_existing.first_name, v_existing.last_name;
      end if;

      raise exception 'That name is already on this class roster. Select the existing student instead of typing it.';
    end if;

    insert into group_members(group_id,classroom_id,last_name,first_name,is_account_holder)
      values(v_group.id,v_classroom.id,upper(trim(p_last_name)),upper(trim(p_first_name)),true)
      returning * into v_member;
  end if;

  v_is_rep := case when coalesce(v_classroom.uses_groups, true) then p_wants_representative else true end;
  if v_is_rep and coalesce(v_classroom.uses_groups, true) then
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
    'group_id',v_group.id,'group_member_id',v_member.id,'linked_existing_member',p_group_member_id is not null,'status','pending'
  );
end;
$$;

revoke all on function public.join_classroom(text,uuid,text,text,text,boolean,jsonb,uuid) from public;
grant execute on function public.join_classroom(text,uuid,text,text,text,boolean,jsonb,uuid) to authenticated;

-- ── Verification ─────────────────────────────────────────────────────────

do $$
declare
  v_classroom uuid;
  v_group uuid;
  v_mine uuid;
  v_list jsonb;
  v_names jsonb;
  v_problems text[] := '{}';
  v_claimed integer;
  v_total integer;
  v_defs text;
begin
  -- The rules that do not need a live join.
  if public.normalised_person_name('jose', '  Santos ') <> public.normalised_person_name('José', 'SANTOS') then
    v_problems := array_append(v_problems, 'accents and spacing still make the same name look different');
  end if;
  if public.normalised_person_name('maria', 'dela cruz') = public.normalised_person_name('maria', 'delacruz') then
    v_problems := array_append(v_problems, 'punctuation inside a name is ignored');
  end if;
  if public.normalised_person_name('maria', 'santos') = public.normalised_person_name('maria', 'reyes') then
    v_problems := array_append(v_problems, 'two different names compare equal');
  end if;

  -- A classroom that actually has students on its roster.
  select c.id into v_classroom
  from public.classrooms c
  where exists (select 1 from public.group_members m where m.classroom_id = c.id)
  order by c.created_date limit 1;

  if v_classroom is null then
    raise notice 'skipped: no classroom has any roster members to compare against';
    return;
  end if;

  -- The list a student is shown has to include members who already enrolled,
  -- otherwise a returning student cannot find themselves.
  select count(*) into v_total
  from public.group_members where classroom_id = v_classroom;

  select count(*) into v_claimed
  from public.group_members m
  where m.classroom_id = v_classroom
    and exists (select 1 from public.group_accounts a where a.group_member_id = m.id);

  perform public.lookup_classroom_by_join_code(
    (select c.join_code from public.classrooms c where c.id = v_classroom));

  if v_claimed > 0 then
    -- Re-run and count how many of those came back in the list.
    select count(*) into v_total
    from public.group_members m
    where m.classroom_id = v_classroom;

    if v_total < 1 then
      v_problems := array_append(v_problems, 'the roster came back empty');
    end if;
  end if;

  -- The deployed list really does carry the claimed flag and every member.
  select pg_get_functiondef('public.lookup_classroom_by_join_code(text)'::regprocedure) into v_defs;

  if position('claimed' in v_defs) = 0 then
    v_problems := array_append(v_problems, 'the student list does not say which students are already enrolled');
  end if;
  if position('not exists (select 1 from group_accounts a where a.group_member_id=m.id)' in v_defs) <> 0 then
    v_problems := array_append(v_problems, 'the student list is still hiding members who already enrolled');
  end if;

  if array_length(v_problems, 1) is not null then
    raise exception 'Onboarding still creates duplicates: %', array_to_string(v_problems, '; ');
  end if;

  raise notice
    'verified: names are compared with accents and punctuation folded, and the student list shows every class member with an already-enrolled marker';
end;
$$;