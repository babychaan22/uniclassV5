-- Guardian self-onboarding: one durable family link per learner (#2 in the audit).
--
-- The per-period reply links work only for the week/month/term the teacher
-- printed them with, so a family that scans last month's QR hits a dead end.
-- This adds ONE standing link per learner that guardians can save to their
-- phone home screen and reuse all term:
--   /family/<share_token>
-- Opening it shows the same minimal card as the per-period reply page
-- (learner display name + class only) and posts the reply onto the CURRENT
-- week's invite, auto-created on demand, so the teacher's existing inbox
-- keeps working unchanged.
--
-- Safety properties carried over from 20261226:
--   * The link leaks nothing but the student display name and class.
--   * Replies are append-only rows on family_summary_replies.
--   * A standing link can never be used for a transferred-out learner.
--   * The same soft flood guard (5 replies/hour/invite) applies.

create table if not exists public.family_member_links (
  id uuid primary key default gen_random_uuid(),
  share_token uuid not null default gen_random_uuid() unique,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  member_id uuid not null references public.group_members(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_date timestamptz not null default now(),
  unique (member_id)
);

-- ── RLS: the standing link table is teacher-read only ────────────────────────
-- Guardians never select from it; they go through the RPC pair below.
alter table public.family_member_links enable row level security;
drop policy if exists family_member_links_teacher_select
  on public.family_member_links;
create policy family_member_links_teacher_select
  on public.family_member_links for select
  to authenticated
  using (exists (
    select 1 from public.classrooms c
    where c.id = family_member_links.classroom_id and c.teacher_id = auth.uid()
  ));

-- ── Teacher: create (or reuse) the standing family link for a learner ────────
create or replace function public.ensure_family_member_link(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.family_member_links%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.assert_family_member_teacher(p_member_id);

  insert into public.family_member_links(classroom_id, member_id, created_by)
  select gm.classroom_id, p_member_id, auth.uid()
  from public.group_members gm
  where gm.id = p_member_id
  on conflict (member_id) do nothing;

  select * into v_link from public.family_member_links where member_id = p_member_id;
  return jsonb_build_object('shareToken', v_link.share_token, 'linkId', v_link.id);
end;
$$;

-- ── Guardian (no login): read the standing link card ─────────────────────────
-- Same minimal payload as read_family_summary_invite: display name + class.
-- Transferred-out learners intentionally read as invalid, like the per-period link.
create or replace function public.read_family_member_link(p_share_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_first text; v_last text; v_grade text; v_section text;
begin
  if p_share_token is null then raise exception 'Invalid family link.'; end if;
  select gm.first_name, gm.last_name, c.grade_level, c.section
    into v_first, v_last, v_grade, v_section
  from public.family_member_links l
  join public.group_members gm on gm.id = l.member_id
  join public.classrooms c on c.id = l.classroom_id
  where l.share_token = p_share_token and not gm.is_transferred;
  if v_first is null then raise exception 'Invalid family link.'; end if;
  return jsonb_build_object(
    'studentName', btrim(v_first || ' ' || coalesce(nullif(left(v_last, 1), ''), '') || '.'),
    'className', btrim(coalesce(v_grade, '') || ' ' || coalesce(v_section, ''))
  );
end;
$$;

-- ── Guardian (no login): reply through the standing link ─────────────────────
-- Auto-creates the current Manila week's invite so the reply appears in the
-- teacher's regular Family summaries inbox. Same flood guard as per-period.
create or replace function public.submit_family_standing_reply(
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
  v_member_id uuid;
  v_invite_id uuid;
  v_recent int;
  v_week_start date;
  v_week_end date;
begin
  if p_share_token is null then raise exception 'Invalid family link.'; end if;
  if p_reaction not in ('acknowledged', 'needs_help', 'question') then
    raise exception 'Choose one of the three reply options.';
  end if;

  select l.member_id into v_member_id
  from public.family_member_links l
  join public.group_members gm on gm.id = l.member_id
  where l.share_token = p_share_token and not gm.is_transferred;
  if v_member_id is null then raise exception 'Invalid family link.'; end if;

  -- Current Monday..Sunday window in Asia/Manila, matching getWeekStartManila.
  v_week_start := date_trunc('week', now() at time zone 'Asia/Manila')::date;
  v_week_end := v_week_start + 6;

  insert into public.family_summary_invites(
    classroom_id, member_id, period_kind, period_label, period_start, period_end, created_by
  )
  select gm.classroom_id, v_member_id, 'week', 'This week', v_week_start, v_week_end,
         coalesce(
           (select ga.user_id from public.group_accounts ga where ga.group_member_id = gm.id limit 1),
           c.teacher_id
         )
  from public.group_members gm
  join public.classrooms c on c.id = gm.classroom_id
  where gm.id = v_member_id
  on conflict (member_id, period_kind, period_start, period_end) do nothing;

  select i.id into v_invite_id
  from public.family_summary_invites i
  join public.family_member_links l on l.member_id = i.member_id
  where l.share_token = p_share_token
    and i.period_kind = 'week'
    and i.period_start = v_week_start
    and i.period_end = v_week_end;
  if v_invite_id is null then raise exception 'Could not record this reply. Please try again later.'; end if;

  insert into public.family_summary_replies(invite_id, reaction, guardian_name, note)
  values (
    v_invite_id,
    p_reaction,
    nullif(btrim(coalesce(p_guardian_name, '')), ''),
    nullif(btrim(coalesce(p_note, '')), '')
  );

  select count(*) into v_recent
  from public.family_summary_replies
  where invite_id = v_invite_id and created_date > now() - interval '1 hour';
  if v_recent > 5 then
    raise exception 'Too many replies for this update right now. Please try again later.';
  end if;
  return true;
end;
$$;

revoke all on function
  public.ensure_family_member_link(uuid),
  public.read_family_member_link(uuid),
  public.submit_family_standing_reply(uuid, text, text, text)
from public;
grant execute on function
  public.ensure_family_member_link(uuid)
to authenticated;
-- The guardian-facing pair must be callable without a Supabase session.
grant execute on function
  public.read_family_member_link(uuid),
  public.submit_family_standing_reply(uuid, text, text, text)
to anon;

do $$
begin
  -- Smoke check: the standing-link read must reject unknown tokens.
  begin
    perform public.read_family_member_link(gen_random_uuid());
    raise exception 'BAD_MIGRATION: unknown token should fail';
  exception when others then
    if sqlerrm = 'BAD_MIGRATION: unknown token should fail' then raise; end if;
  end;
end $$;
