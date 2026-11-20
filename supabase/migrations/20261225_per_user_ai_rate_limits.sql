-- Per-user rate limits for AI edge functions (gemini-proxy / openrouter-proxy).
--
-- Two layers, mirroring the Manila-calendar-day pattern of ai_image_usage:
--   1. Burst cap  — calls per rolling minute window (stops hammering).
--   2. Daily cap  — calls per Manila calendar day, tiered by role
--                   (teachers grade/author more; students偶 only get
--                   AI-assisted help on their own missions).
--
-- The edge functions call consume_ai_call_quota(p_kind) with the caller's own
-- JWT, so auth.uid() is the verified Supabase user: limits are per user and
-- cannot be bypassed by a different browser or IP.

create table if not exists public.ai_rate_limit_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_kind text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  call_count integer not null default 0 check (call_count >= 0),
  primary key (user_id, window_kind, window_start)
);

alter table public.ai_rate_limit_usage enable row level security;
create policy ai_rate_limit_usage_self_select
  on public.ai_rate_limit_usage for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.consume_ai_call_quota(p_kind text default 'text')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text := coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'role', ''), 'user');
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'text');
  v_manila_day date := (now() at time zone 'Asia/Manila')::date;
  v_minute_window timestamptz := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  v_day_window timestamptz := ((v_manila_day)::timestamp at time zone 'Asia/Manila');
  v_daily_limit int;
  v_burst_limit int;
  v_minute_count int;
  v_daily_count int;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if v_kind not in ('text', 'image') then
    raise exception 'Unsupported AI call kind %. Array kinds: text, image.', v_kind;
  end if;

  -- Limits: teachers can batch-grade whole rosters, students only score a
  -- handful of AI-assisted missions per day. Image generation has its own
  -- stricter quota (consume_ai_image_quota); only the burst cap applies here.
  if v_kind = 'image' then
    v_burst_limit := 4;
  elsif v_role = 'teacher' then
    v_burst_limit := 15;
    v_daily_limit := 150;
  else
    v_burst_limit := 6;
    v_daily_limit := 30;
  end if;

  -- Drop windows older than two days so the table self-cleans.
  delete from public.ai_rate_limit_usage
    where window_start < now() - interval '2 days';

  -- ── Burst layer (per-minute window) ──────────────────────────────────────
  insert into public.ai_rate_limit_usage(user_id, window_kind, window_start, call_count)
    values (v_user, 'minute', v_minute_window, 1)
    on conflict (user_id, window_kind, window_start)
      do update set call_count = public.ai_rate_limit_usage.call_count + 1
    returning call_count into v_minute_count;

  if v_minute_count > v_burst_limit then
    update public.ai_rate_limit_usage
      set call_count = call_count - 1
      where user_id = v_user and window_kind = 'minute' and window_start = v_minute_window;
    raise exception 'Too many AI requests — slow down and try again in about a minute.';
  end if;

  -- ── Daily layer (Manila calendar day) ────────────────────────────────────
  if v_daily_limit is not null then
    insert into public.ai_rate_limit_usage(user_id, window_kind, window_start, call_count)
      values (v_user, 'day', v_day_window, 1)
      on conflict (user_id, window_kind, window_start)
        do update set call_count = public.ai_rate_limit_usage.call_count + 1
      returning call_count into v_daily_count;

    if v_daily_count > v_daily_limit then
      update public.ai_rate_limit_usage
        set call_count = call_count - 1
        where user_id = v_user and window_kind = 'day' and window_start = v_day_window;
      raise exception 'Daily AI limit reached (% calls today). It resets at midnight Manila time.', v_daily_limit;
    end if;
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'minuteUsed', v_minute_count,
    'minuteLimit', v_burst_limit,
    'dailyUsed', coalesce(v_daily_count, v_minute_count),
    'dailyLimit', coalesce(v_daily_limit, 0)
  );
end;
$$;

revoke all on function public.consume_ai_call_quota(text) from public;
grant execute on function public.consume_ai_call_quota(text) to authenticated;
