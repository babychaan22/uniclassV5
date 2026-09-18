-- Let students claim a representative-created member record explicitly.
-- Name matching remains available for older clients, but the new flow sends
-- the selected member id so duplicate names and spelling differences are safer.

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
      where id=p_group_member_id and group_id=v_group.id and classroom_id=v_classroom.id
      for update;
    if not found then raise exception 'That member is not in the selected group'; end if;
    if exists (select 1 from group_accounts where group_member_id=v_member.id) then
      raise exception 'That member already has an account';
    end if;
    update group_members set is_account_holder=true where id=v_member.id returning * into v_member;
  else
    select * into v_existing from group_members
      where group_id=v_group.id
        and upper(last_name)=upper(trim(p_last_name))
        and upper(first_name)=upper(trim(p_first_name))
      limit 1;
    if found then
      if exists (select 1 from group_accounts where group_member_id=v_existing.id) then
        raise exception 'Someone already enrolled under that name in this group';
      end if;
      raise exception 'That name is already listed in this group. Select the existing member instead.';
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
           select 1 from group_members where group_id=v_group.id
             and upper(last_name)=upper(trim(v_teammate->>'last_name'))
             and upper(first_name)=upper(trim(v_teammate->>'first_name'))
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
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'group_id',m.group_id,'first_name',m.first_name,'last_name',m.last_name) order by m.last_name,m.first_name),'[]'::jsonb)
    into v_members
    from group_members m
    where m.classroom_id=v_classroom.id
      and not exists (select 1 from group_accounts a where a.group_member_id=m.id);
  return jsonb_build_object(
    'classroom',jsonb_build_object('id',v_classroom.id,'grade_level',v_classroom.grade_level,'section',v_classroom.section,'school_year',v_classroom.school_year,'uses_groups',coalesce(v_classroom.uses_groups,true)),
    'groups',v_groups,'accounts',v_accounts,'members',v_members
  );
end;
$$;
