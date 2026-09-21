-- Representatives may propose roster changes, but only the class teacher can
-- approve them. Direct roster writes remain teacher-only.

create table if not exists public.representative_roster_requests (
  id uuid primary key default gen_random_uuid(),
  created_date timestamptz not null default now(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  requested_by uuid not null references public.group_accounts(id) on delete cascade,
  request_type text not null check (request_type in ('add', 'remove')),
  target_member_id uuid references public.group_members(id) on delete set null,
  first_name text,
  last_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  check (
    (request_type = 'add' and first_name is not null and last_name is not null and target_member_id is null)
    or (request_type = 'remove' and target_member_id is not null)
  )
);

create index if not exists idx_representative_roster_requests_classroom_status
  on public.representative_roster_requests(classroom_id, status, created_date desc);

alter table public.representative_roster_requests enable row level security;
drop policy if exists representative_roster_requests_read on public.representative_roster_requests;
create policy representative_roster_requests_read on public.representative_roster_requests
  for select to authenticated using (
    requested_by in (select id from public.group_accounts where user_id = auth.uid())
    or auth_is_teacher_of(classroom_id)
  );

create or replace function public.request_representative_roster_change(
  p_request_type text,
  p_target_member_id uuid default null,
  p_first_name text default null,
  p_last_name text default null,
  p_classroom_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account public.group_accounts%rowtype;
  v_target public.group_members%rowtype;
  v_request public.representative_roster_requests%rowtype;
begin
  select * into v_account from public.group_accounts
    where user_id = auth.uid() and classroom_id = p_classroom_id and is_approved = true and is_representative = true
    order by created_date asc limit 1;
  if not found then raise exception 'Only the approved group representative can request roster changes'; end if;
  if p_request_type not in ('add', 'remove') then raise exception 'Choose whether to add or remove a member'; end if;

  if p_request_type = 'add' then
    if nullif(trim(p_first_name), '') is null or nullif(trim(p_last_name), '') is null then
      raise exception 'Enter both the first and last name';
    end if;
    if exists (
      select 1 from public.group_members
      where group_id = v_account.group_id
        and upper(first_name) = upper(trim(p_first_name))
        and upper(last_name) = upper(trim(p_last_name))
    ) then raise exception 'That learner is already in this group'; end if;

    insert into public.representative_roster_requests(classroom_id, group_id, requested_by, request_type, first_name, last_name)
    values (v_account.classroom_id, v_account.group_id, v_account.id, 'add', upper(trim(p_first_name)), upper(trim(p_last_name)))
    returning * into v_request;
  else
    select * into v_target from public.group_members
      where id = p_target_member_id and classroom_id = v_account.classroom_id and group_id = v_account.group_id;
    if not found then raise exception 'Choose a learner from your own group'; end if;
    if v_target.id = v_account.group_member_id then raise exception 'Representatives cannot remove themselves'; end if;
    if exists (select 1 from public.group_accounts where group_member_id = v_target.id) then
      raise exception 'Ask the teacher to remove a learner who already has an account';
    end if;

    insert into public.representative_roster_requests(classroom_id, group_id, requested_by, request_type, target_member_id)
    values (v_account.classroom_id, v_account.group_id, v_account.id, 'remove', v_target.id)
    returning * into v_request;
  end if;
  return jsonb_build_object('id', v_request.id, 'status', v_request.status);
end;
$$;

create or replace function public.review_representative_roster_change(p_request_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_request public.representative_roster_requests%rowtype;
  v_target public.group_members%rowtype;
  v_paths jsonb := '[]'::jsonb;
begin
  select * into v_request from public.representative_roster_requests where id = p_request_id for update;
  if not found then raise exception 'Roster request not found'; end if;
  if not auth_is_teacher_of(v_request.classroom_id) then raise exception 'Only the class teacher can review roster requests'; end if;
  if v_request.status <> 'pending' then raise exception 'This roster request has already been reviewed'; end if;

  if p_approve and v_request.request_type = 'add' then
    if exists (select 1 from public.group_members where group_id = v_request.group_id and upper(first_name) = v_request.first_name and upper(last_name) = v_request.last_name) then
      raise exception 'That learner is already in this group';
    end if;
    insert into public.group_members(group_id, classroom_id, last_name, first_name, is_account_holder)
      values (v_request.group_id, v_request.classroom_id, v_request.last_name, v_request.first_name, false);
  elsif p_approve and v_request.request_type = 'remove' then
    select * into v_target from public.group_members where id = v_request.target_member_id for update;
    if not found then raise exception 'That learner is no longer in the roster'; end if;
    if exists (select 1 from public.group_accounts where group_member_id = v_target.id) then
      raise exception 'Use the teacher roster to remove a learner with an account';
    end if;
    select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from public.activity_evidence where group_member_id = v_target.id;
    delete from public.activity_evidence where group_member_id = v_target.id;
    delete from public.activity_scores where group_member_id = v_target.id;
    delete from public.attendances where group_member_id = v_target.id;
    delete from public.teacher_assessments where group_member_id = v_target.id;
    delete from public.participation_logs where group_member_id = v_target.id;
    delete from public.badges where member_id = v_target.id;
    update public.qr_codes set used_by_member_id = null where used_by_member_id = v_target.id;
    delete from public.group_members where id = v_target.id;
  end if;

  update public.representative_roster_requests
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_request.id;
  return jsonb_build_object('id', v_request.id, 'approved', p_approve, 'requestType', v_request.request_type, 'evidencePaths', v_paths);
end;
$$;

revoke all on function public.request_representative_roster_change(text, uuid, text, text, uuid) from public;
grant execute on function public.request_representative_roster_change(text, uuid, text, text, uuid) to authenticated;
revoke all on function public.review_representative_roster_change(uuid, boolean) from public;
grant execute on function public.review_representative_roster_change(uuid, boolean) to authenticated;
