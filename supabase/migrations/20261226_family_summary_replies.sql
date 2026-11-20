-- Guardian two-way engagement on family summaries (#1).
--
-- FamilySummaries is a read-only print/copy update a teacher shares with a
-- family (Messenger, paper). Guardians have no UniClass accounts, so each
-- shared summary gains a reply link + QR that guardians open without login:
--   /family-reply/<share_token>
-- The token is an unguessable UUID bound to one learner + one period. The
-- guardian reply page shows only the learner's display name and class, and
-- posts an acknowledgment / help request / question with an optional note.
-- The teacher reads replies through an inbox RPC scoped to their classrooms.
--
-- Reply writes never touch a learner record, mission, score, or attendance
-- row: they only append rows to family_summary_replies.

create table if not exists public.family_summary_invites (
  id uuid primary key default gen_random_uuid(),
  share_token uuid not null default gen_random_uuid() unique,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete cascade,
  period_kind text not null check (period_kind in ('week', 'month', 'term')),
  period_label text not null,
  period_start date not null,
  period_end date not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_date timestamptz not null default now(),
  unique (member_id, period_kind, period_start, period_end)
);

create table if not exists public.family_summary_replies (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.family_summary_invites(id) on delete cascade,
  reaction text not null check (reaction in ('acknowledged', 'needs_help', 'question')),
  guardian_name text,
  note text check (char_length(note) <= 500),
  created_date timestamptz not null default now()
);

-- ── RLS: invites are visible only to the owning teacher ─────────────────────
alter table public.family_summary_invites enable row level security;
drop policy if exists family_summary_invites_teacher_select
  on public.family_summary_invites;
create policy family_summary_invites_teacher_select
  on public.family_summary_invites for select
  to authenticated
  using (exists (
    select 1 from public.classrooms c
    where c.id = family_summary_invites.classroom_id and c.teacher_id = auth.uid()
  ));

-- Direct inserts are not allowed; creation goes through the RPC so ownership
-- of the learner (not just the classroom) is verified.
drop policy if exists family_summary_invites_teacher_no_insert
  on public.family_summary_invites;

-- ── RLS: replies have no direct access at all ───────────────────────────────
-- Only the RPCs below read replies, and only for the owning teacher.
alter table public.family_summary_replies enable row level security;
drop policy if exists family_summary_replies_teacher_select
  on public.family_summary_replies;
create policy family_summary_replies_teacher_select
  on public.family_summary_replies for select
  to authenticated
  using (exists (
    select 1
    from public.family_summary_invites i
    join public.classrooms c on c.id = i.classroom_id
    where i.id = family_summary_replies.invite_id
      and c.teacher_id = auth.uid()
  ));

-- ── Guard: the calling user owns the classroom that owns this learner ───────
create or replace function public.assert_family_member_teacher(p_member_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1
    from public.group_members gm
    join public.classrooms c on c.id = gm.classroom_id
    where gm.id = p_member_id and c.teacher_id = auth.uid() and not gm.is_transferred
  ) then
    raise exception 'You can only share summaries for learners in your own class.';
  end if;
end;
$$;

-- ── Teacher: create (or reuse) the reply invite for a learner + period ──────
create or replace function public.create_family_summary_invite(
  p_member_id uuid,
  p_period_kind text,
  p_period_label text,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.family_summary_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_period_kind not in ('week', 'month', 'term') then
    raise exception 'Unsupported summary period.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_start > p_period_end then
    raise exception 'Invalid summary period range.';
  end if;
  perform public.assert_family_member_teacher(p_member_id);

  insert into public.family_summary_invites(
    classroom_id, member_id, period_kind, period_label, period_start, period_end, created_by
  )
  select gm.classroom_id, p_member_id, p_period_kind,
         coalesce(nullif(trim(p_period_label), ''), p_period_kind),
         p_period_start, p_period_end, auth.uid()
  from public.group_members gm
  where gm.id = p_member_id
  on conflict (member_id, period_kind, period_start, period_end) do nothing;

  select * into v_invite from public.family_summary_invites
    where member_id = p_member_id
      and period_kind = p_period_kind
      and period_start = p_period_start
      and period_end = p_period_end;

  return jsonb_build_object('shareToken', v_invite.share_token, 'inviteId', v_invite.id);
end;
$$;

-- ── Guardian (no login): read the minimal invite card for a token ───────────
-- Returns only what the printed summary already shows: learner display name
-- (first name + last initial), class, and period. Nothing else.
create or replace function public.read_family_summary_invite(p_share_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_first text; v_last text; v_grade text; v_section text; v_label text;
begin
  if p_share_token is null then raise exception 'Invalid reply link.'; end if;
  select gm.first_name, gm.last_name, c.grade_level, c.section, i.period_label
    into v_first, v_last, v_grade, v_section, v_label
  from public.family_summary_invites i
  join public.group_members gm on gm.id = i.member_id
  join public.classrooms c on c.id = i.classroom_id
  where i.share_token = p_share_token;
  if v_first is null then raise exception 'Invalid reply link.'; end if;
  return jsonb_build_object(
    'studentName', btrim(v_first || ' ' || coalesce(nullif(left(v_last, 1), ''), '') || '.'),
    'className', btrim(coalesce(v_grade, '') || ' ' || coalesce(v_section, '')),
    'periodLabel', v_label
  );
end;
$$;

-- ── Guardian (no login): post an acknowledgment / help request / question ───
create or replace function public.submit_family_summary_reply(
  p_share_token uuid,
  p_guardian_name text,
  p_reaction text,
  p_note text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id uuid;
  v_recent int;
begin
  if p_share_token is null then raise exception 'Invalid reply link.'; end if;
  select id into v_invite_id from public.family_summary_invites where share_token = p_share_token;
  if v_invite_id is null then raise exception 'Invalid reply link.'; end if;
  if p_reaction not in ('acknowledged', 'needs_help', 'question') then
    raise exception 'Choose one of the three reply options.';
  end if;
  insert into public.family_summary_replies(invite_id, reaction, guardian_name, note)
  values (
    v_invite_id,
    p_reaction,
    nullif(btrim(coalesce(p_guardian_name, '')), ''),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  -- Soft flood guard per invite: an open link does not become a message wall.
  select count(*) into v_recent
  from public.family_summary_replies
  where invite_id = v_invite_id and created_date > now() - interval '1 hour';
  if v_recent > 5 then
    raise exception 'Too many replies for this update right now. Please try again later.';
  end if;
  return true;
end;
$$;

-- ── Teacher inbox: invites + replies across all of the teacher's classes ────
create or replace function public.list_family_summary_replies()
returns table (
  invite_id uuid,
  member_id uuid,
  student_name text,
  period_label text,
  period_kind text,
  reaction text,
  guardian_name text,
  note text,
  reply_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, gm.id,
    btrim(gm.first_name || ' ' || gm.last_name),
    i.period_label, i.period_kind,
    r.reaction, r.guardian_name, r.note, r.created_date
  from public.group_members gm
  join public.classrooms c on c.id = gm.classroom_id
  join public.family_summary_invites i on i.member_id = gm.id
  left join public.family_summary_replies r on r.invite_id = i.id
  where c.teacher_id = auth.uid()
  order by r.created_date desc nulls last, gm.first_name
  limit 200;
$$;

revoke all on function
  public.assert_family_member_teacher(uuid),
  public.create_family_summary_invite(uuid, text, text, date, date),
  public.read_family_summary_invite(uuid),
  public.submit_family_summary_reply(uuid, text, text, text),
  public.list_family_summary_replies()
from public;
grant execute on function
  public.create_family_summary_invite(uuid, text, text, date, date),
  public.list_family_summary_replies()
to authenticated;
-- The guardian-facing pair must be callable without a Supabase session.
grant execute on function
  public.read_family_summary_invite(uuid),
  public.submit_family_summary_reply(uuid, text, text, text)
to anon;
