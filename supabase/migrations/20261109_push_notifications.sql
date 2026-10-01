-- Device push notifications.
--
-- Web Push needs no external service: the browser holds a subscription and
-- Supabase Edge Functions can send to it using the standard Web Push protocol
-- with the VAPID keys generated below. Nothing here is enabled until the
-- student or teacher opts in from the UI.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  classroom_id uuid references public.classrooms(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  failure_count integer not null default 0
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);
create index if not exists idx_push_subscriptions_classroom on public.push_subscriptions(classroom_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists own_push_subscriptions on public.push_subscriptions;
create policy own_push_subscriptions on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A student's notifications are about their own classroom.
drop policy if exists teacher_read_classroom_push on public.push_subscriptions;
create policy teacher_read_classroom_push on public.push_subscriptions for select to authenticated
  using (auth_is_teacher_of(classroom_id));

-- In-app feed. Push is best-effort, so the same events are also stored here and
-- surfaced on the dashboard, which means a student who denies the permission
-- prompt still finds out what changed.
--
-- Named app_notifications because an unrelated public.notifications table
-- (columns user_id/title/body/created_at) already exists in this project and
-- is not part of this feature.
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  classroom_id uuid references public.classrooms(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  audience text not null default 'student'
             check (audience in ('student', 'teacher')),
  kind text not null
             check (kind in ('announcement', 'mission', 'mission_status', 'badge', 'badge_award', 'score_edit', 'attendance', 'reward', 'points')),
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  pushed_at timestamptz
);

create index if not exists idx_app_notifications_recipient on public.app_notifications(recipient_user_id, created_at desc);
create index if not exists idx_app_notifications_classroom on public.app_notifications(classroom_id, created_at desc);

alter table public.app_notifications enable row level security;

drop policy if exists own_app_notifications on public.app_notifications;
create policy own_app_notifications on public.app_notifications for select to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists teacher_read_classroom_app_notifications on public.app_notifications;
create policy teacher_read_classroom_app_notifications on public.app_notifications for select to authenticated
  using (auth_is_teacher_of(classroom_id));

drop policy if exists own_mark_app_notification_read on public.app_notifications;
create policy own_mark_app_notification_read on public.app_notifications for update to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- Fan a single event out to every enrolled student (or the teacher) of a
-- classroom and return the ids so the edge function can push to each device.
create or replace function public.notify_classroom(
  p_classroom_id uuid,
  p_audience text,
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := '{}';
begin
  if p_audience = 'teacher' then
    insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
    select p_classroom_id, c.teacher_id, 'teacher', p_kind, p_title, p_body, p_link
    from public.classrooms c where c.id = p_classroom_id
    returning id into v_ids[1];

    return v_ids;
  end if;

  -- Only students actually enrolled in this classroom.
  v_ids := '{}';
  insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
  select p_classroom_id, ga.user_id, 'student', p_kind, p_title, p_body, p_link
  from public.group_accounts ga
  where ga.classroom_id = p_classroom_id and ga.is_approved = true
  returning id into v_ids;

  return v_ids;
end;
$$;

revoke all on function public.notify_classroom(uuid, text, text, text, text, text) from public;
grant execute on function public.notify_classroom(uuid, text, text, text, text, text) to authenticated;

-- Unread count for the header bell. Cheap enough to call on every page load.
create or replace function public.get_unread_notification_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.app_notifications
  where recipient_user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.get_unread_notification_count() from public;
grant execute on function public.get_unread_notification_count() to authenticated;

create or replace function public.list_notifications(p_limit integer default 30)
returns table (
  id uuid,
  kind text,
  title text,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select n.id, n.kind, n.title, n.body, n.link, n.read_at, n.created_at
  from public.app_notifications n
  where n.recipient_user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke all on function public.list_notifications(integer) from public;
grant execute on function public.list_notifications(integer) to authenticated;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update public.app_notifications
  set read_at = now()
  where recipient_user_id = auth.uid()
    and read_at is null
    and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Register or refresh this device.
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_classroom uuid;
  v_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select classroom_id into v_classroom
  from public.group_accounts
  where user_id = v_user and is_approved = true
  order by created_date asc limit 1;

  insert into public.push_subscriptions(user_id, classroom_id, endpoint, p256dh, auth_key, user_agent, last_seen_at, failure_count)
  values (v_user, v_classroom, p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300), now(), 0)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        classroom_id = excluded.classroom_id,
        p256dh = excluded.p256dh,
        auth_key = excluded.auth_key,
        user_agent = excluded.user_agent,
        last_seen_at = now(),
        failure_count = 0
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

create or replace function public.unregister_push_subscription(p_endpoint text)
returns boolean
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid()
  returning true;
$$;

revoke all on function public.unregister_push_subscription(text) from public;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- Expire stale or broken subscriptions. The push sender calls this when the
-- push service reports 404/410 so dead endpoints do not retry forever.
create or replace function public.drop_push_subscriptions(p_endpoints text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.drop_push_subscriptions(text[]) from public;
grant execute on function public.drop_push_subscriptions(text[]) to service_role;

-- The device push sender is an Edge Function invoked by a Database Webhook on
-- INSERT into public.app_notifications. Set the secrets first:
--   npx web-push generate-vapid-keys
--   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com
--   supabase functions deploy send-push --no-verify-jwt
-- Without the webhook, events still land in the in-app bell feed. To wire it:
--   insert into supabase_functions.http_request_queue ...
-- or create the webhook in Dashboard -> Database -> Webhooks, POST to
--   https://<project-ref>.supabase.co/functions/v1/send-push  body {"notificationId":"{{record.id}}"}
-- Then add the same public key to the app environment as VITE_VAPID_PUBLIC_KEY
-- so the browser can subscribe.

-- Live in-app updates: the header badge refreshes the moment something lands.
-- Adding a table to a publication twice is an error, so check membership first.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.app_notifications;
  end if;
end;
$$;