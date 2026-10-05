-- 20261160 — protect internal push dispatch and remove duplicate delivery races.
--
-- Before applying this migration, configure the SAME high-entropy value in:
--   1. Supabase Edge secret: PUSH_DISPATCH_SECRET
--   2. Supabase Vault secret: push_dispatch_secret
-- The trigger intentionally leaves in-app notifications intact when the Vault
-- secret is absent; device delivery is skipped rather than exposing the Edge
-- Function to the public internet.

alter table public.app_notifications
  add column if not exists push_claimed_at timestamptz,
  add column if not exists push_claim_token uuid;

create index if not exists idx_app_notifications_push_queue
  on public.app_notifications(created_at)
  where pushed_at is null;

-- Pin the policy helpers' lookup path. These security-definer functions are
-- called by RLS policies and must never resolve attacker-controlled objects.
create or replace function public.auth_is_teacher_of(p_classroom_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp
as $$ select exists (select 1 from public.classrooms where id = p_classroom_id and teacher_id = auth.uid()); $$;

create or replace function public.auth_in_classroom(p_classroom_id uuid)
returns boolean language sql security definer stable
set search_path = public, pg_temp
as $$ select exists (select 1 from public.group_accounts where user_id = auth.uid() and classroom_id = p_classroom_id and is_approved = true); $$;

create or replace function public.auth_rep_group_id(p_classroom_id uuid)
returns uuid language sql security definer stable
set search_path = public, pg_temp
as $$
  select group_id from public.group_accounts
  where user_id = auth.uid() and classroom_id = p_classroom_id
    and is_representative = true and is_approved = true
  limit 1;
$$;

create or replace function public._prevent_account_self_promotion()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_representative <> old.is_representative or new.is_approved <> old.is_approved then
    if not exists (select 1 from public.classrooms where id = new.classroom_id and teacher_id = auth.uid()) then
      raise exception 'Only the classroom teacher may change is_representative or is_approved'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

-- Claim rows atomically before sending. A stale claim becomes eligible again
-- after five minutes, which keeps a crashed Edge invocation from blocking all
-- future delivery while preventing normal concurrent requests from duplicating
-- notifications.
create or replace function public.claim_push_notifications(
  p_notification_id uuid default null,
  p_limit integer default 50
)
returns table (
  notification_id uuid,
  classroom_id uuid,
  recipient_user_id uuid,
  kind text,
  title text,
  body text,
  link text,
  claim_token uuid
)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid := gen_random_uuid();
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 50));
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = 'insufficient_privilege';
  end if;

  return query
  with candidates as (
    select n.id
    from public.app_notifications n
    where (p_notification_id is null or n.id = p_notification_id)
      and n.pushed_at is null
      and (n.push_claimed_at is null or n.push_claimed_at < now() - interval '5 minutes')
    order by n.created_at asc
    limit v_limit
    for update skip locked
  ), claimed as (
    update public.app_notifications n
    set push_claimed_at = now(), push_claim_token = v_token
    from candidates c
    where n.id = c.id
    returning n.id, n.classroom_id, n.recipient_user_id, n.kind, n.title, n.body, n.link
  )
  select c.id, c.classroom_id, c.recipient_user_id, c.kind, c.title, c.body, c.link, v_token
  from claimed c;
end;
$$;

revoke all on function public.claim_push_notifications(uuid, integer) from public;
grant execute on function public.claim_push_notifications(uuid, integer) to service_role;

-- The function is intentionally deployed with JWT verification disabled, so it
-- authenticates each database webhook with the secret stored in Supabase Vault.
create or replace function public.queue_notification_push()
returns trigger language plpgsql security definer
set search_path = public, net, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_webhook_url' limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_dispatch_secret' limit 1;
  exception when others then
    v_url := null;
    v_secret := null;
  end;

  if nullif(btrim(v_secret), '') is null then
    raise warning 'push dispatch secret is not configured; device push was skipped';
    return null;
  end if;

  v_url := coalesce(nullif(btrim(v_url), ''), 'https://xprjntqvmfbfpjsfrdbl.supabase.co/functions/v1/send-push');
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notificationId', new.id::text),
    headers := jsonb_build_object('content-type', 'application/json', 'x-uniclass-push-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return null;
end;
$$;

revoke all on function public.queue_notification_push() from public;
