-- Teacher-authored optional badges and compressed activity evidence.
create table if not exists public.badge_definitions (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null,
  description text,
  icon text not null default '🏅',
  badge_scope text not null default 'group' check (badge_scope in ('group','personal')),
  points numeric not null default 10 check (points >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_evidence (
  id uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  group_member_id uuid references public.group_members(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null,
  uploaded_by uuid not null references auth.users(id),
  storage_path text not null,
  original_name text,
  file_size integer,
  mime_type text not null default 'image/webp',
  created_at timestamptz not null default now()
);

alter table public.badges add column if not exists badge_definition_id uuid references public.badge_definitions(id) on delete set null;
alter table public.badges add column if not exists member_id uuid references public.group_members(id) on delete set null;

alter table public.badge_definitions enable row level security;
alter table public.activity_evidence enable row level security;

drop policy if exists teacher_manage_badge_definitions on public.badge_definitions;
create policy teacher_manage_badge_definitions on public.badge_definitions for all to authenticated
  using (auth_is_teacher_of(classroom_id)) with check (auth_is_teacher_of(classroom_id));
drop policy if exists classroom_read_badge_definitions on public.badge_definitions;
create policy classroom_read_badge_definitions on public.badge_definitions for select to authenticated
  using (auth_in_classroom(classroom_id));

drop policy if exists classroom_read_activity_evidence on public.activity_evidence;
create policy classroom_read_activity_evidence on public.activity_evidence for select to authenticated
  using (auth_in_classroom(classroom_id));
drop policy if exists student_upload_activity_evidence on public.activity_evidence;
create policy student_upload_activity_evidence on public.activity_evidence for insert to authenticated
  with check (auth_in_classroom(classroom_id) and uploaded_by = auth.uid());

insert into storage.buckets (id, name, public) values ('activity-evidence', 'activity-evidence', false)
on conflict (id) do nothing;

drop policy if exists activity_evidence_upload on storage.objects;
create policy activity_evidence_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'activity-evidence' and (storage.foldername(name))[1] in (select id::text from public.groups where exists (select 1 from public.group_accounts where group_id = groups.id and user_id = auth.uid() and is_approved = true)));
drop policy if exists activity_evidence_read on storage.objects;
create policy activity_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'activity-evidence' and exists (select 1 from public.groups g where g.id::text = (storage.foldername(name))[1] and (exists (select 1 from public.group_accounts where group_id = g.id and user_id = auth.uid() and is_approved = true) or auth_is_teacher_of(g.classroom_id))));

create or replace function public.claim_badge_definition(p_definition_id uuid, p_group_id uuid, p_member_id uuid default null)
returns badges language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid(); v_def badge_definitions%rowtype; v_group groups%rowtype;
  v_account group_accounts%rowtype; v_result badges%rowtype; v_week date;
begin
  if extract(dow from (now() at time zone 'Asia/Manila')) not in (0, 6) then raise exception 'Optional badges can be claimed on Saturday or Sunday.'; end if;
  select * into v_def from badge_definitions where id=p_definition_id and is_active=true;
  if not found then raise exception 'Badge is no longer available'; end if;
  select * into v_group from groups where id=p_group_id and classroom_id=v_def.classroom_id;
  if not found then raise exception 'Invalid group'; end if;
  select * into v_account from group_accounts where user_id=v_user and group_id=p_group_id and is_approved=true limit 1;
  if not found then raise exception 'Approved classroom account required'; end if;
  if v_def.badge_scope='personal' and (p_member_id is null or p_member_id <> v_account.group_member_id) then raise exception 'Personal badges can only be claimed for your own student profile'; end if;
  v_week := (now() at time zone 'Asia/Manila')::date - extract(isodow from (now() at time zone 'Asia/Manila'))::integer + 1;
  insert into badges(group_id,classroom_id,badge_type,week_start_date,points_awarded,redeemed_by,badge_definition_id,member_id)
    values(p_group_id,v_def.classroom_id,'custom:'||v_def.id::text,v_week,v_def.points,v_user,p_definition_id,case when v_def.badge_scope='personal' then p_member_id else null end)
    returning * into v_result;
  if v_def.badge_scope='group' then
    insert into participation_logs(group_member_id,group_id,classroom_id,points_awarded,event_type,multiplier,note)
      select gm.id,p_group_id,v_def.classroom_id,v_def.points / nullif((select count(*) from group_members where group_id=p_group_id),0),'badge',1,v_def.title
      from group_members gm where gm.group_id=p_group_id;
  else
    insert into participation_logs(group_member_id,group_id,classroom_id,points_awarded,event_type,multiplier,note)
      values(p_member_id,p_group_id,v_def.classroom_id,v_def.points,'badge',1,v_def.title);
  end if;
  return v_result;
exception when unique_violation then raise exception 'This badge has already been claimed this week.';
end;
$$;
revoke all on function public.claim_badge_definition(uuid,uuid,uuid) from public;
grant execute on function public.claim_badge_definition(uuid,uuid,uuid) to authenticated;
