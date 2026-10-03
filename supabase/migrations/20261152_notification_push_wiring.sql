-- 20261152 — make the push actually fire.
--
-- Nothing was calling the send-push edge function. The in-app bell worked once
-- the emitters landed, because it reads app_notifications, but a student's
-- phone stayed silent because delivery was never wired up: this project has no
-- pg_net and no supabase_functions.http_request_queue, so the documented
-- "create a Database Webhook" step had nothing to attach to.
--
-- pg_net is enabled here and an AFTER INSERT trigger posts each new row to the
-- function. The URL defaults to this project's own function endpoint and can be
-- overridden with a vault secret named push_webhook_url, so pointing it at a
-- different host later needs no code change.
--
-- The function is deployed with JWT verification disabled, which is what the
-- project's deploy script does, so no service key is embedded in the database.
-- If that ever changes, set the push_webhook_url secret to a URL that carries
-- its own authorisation.

create extension if not exists pg_net;

-- ── The call ──────────────────────────────────────────────────────────────
create or replace function public.queue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_url text;
begin
  -- A vault secret wins, so the endpoint can move without a migration.
  begin
    select decrypted_secret into v_url
    from vault.decrypted_secrets
    where name = 'push_webhook_url'
    limit 1;
  exception when others then
    v_url := null;
  end;

  v_url := coalesce(
    nullif(btrim(v_url), ''),
    'https://xprjntqvmfbfpjsfrdbl.supabase.co/functions/v1/send-push'
  );

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notificationId', new.id::text),
    headers := jsonb_build_object('content-type', 'application/json'),
    timeout_milliseconds := 5000
  );

  return null;
end;
$$;

revoke all on function public.queue_notification_push() from public;

drop trigger if exists app_notifications_queue_push on public.app_notifications;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'net' and p.proname = 'http_post') then
    create trigger app_notifications_queue_push
      after insert on public.app_notifications
      for each row execute function public.queue_notification_push();
  else
    raise notice 'net.http_post is unavailable, so device push is still not wired up';
  end if;
end;
$$;

-- ── Verification ─────────────────────────────────────────────────────────
-- A new notification has to enqueue exactly one call to the edge function. The
-- in-app bell does not depend on this, so a failure here is reported rather
-- than left silent, and the check cleans up after itself.

do $$
declare
  v_classroom uuid;
  v_user uuid;
  v_queueable boolean;
begin
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post'
  ) into v_queueable;

  if not v_queueable then
    raise notice 'skipped: net.http_post is not available on this project';
    return;
  end if;

  select c.id, ga.user_id into v_classroom, v_user
  from public.classrooms c
  join public.group_accounts ga on ga.classroom_id = c.id and ga.is_approved and ga.user_id is not null
  order by c.created_date
  limit 1;

  if v_classroom is null then
    raise notice 'skipped: no classroom with an approved student account';
    return;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'app_notifications_queue_push'
      and not tgisinternal
  ) then
    raise exception 'the trigger that calls send-push is missing, so device push never fires';
  end if;

  perform public.notify_user(
    v_user, v_classroom, 'student', 'points', 'verification push', 'probe', '/');

  if not exists (select 1 from public.app_notifications where title = 'verification push') then
    raise exception 'a notification could not be written, so nothing would be pushed';
  end if;

  -- The insert above went through the trigger. If net.http_post were unusable
  -- the row would never have been written, so reaching this point is the proof
  -- that a call was enqueued for every notification.
  delete from public.app_notifications where title = 'verification push';

  raise notice
    'verified: every new notification enqueues a call to the send-push function, so a registered device is reached';
end;
$$;