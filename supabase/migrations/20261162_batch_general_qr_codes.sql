-- 20261162 — issue a printable QR batch in one protected database call.
-- This replaces up to 100 sequential browser inserts. The unique hash index
-- remains the final duplicate guard; a collision is simply redrawn here.

create or replace function public.create_general_qr_batch(
  p_qr_type text,
  p_base_points integer,
  p_batch_size integer
)
returns setof public.qr_codes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.qr_codes%rowtype;
  v_hash text;
  v_created integer := 0;
  v_attempt integer;
  v_inserted boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.classrooms where teacher_id = auth.uid()) then
    raise exception 'Only a teacher can create general QR codes' using errcode = 'insufficient_privilege';
  end if;
  if p_qr_type not in ('standard', 'gacha') then raise exception 'Unknown QR code type'; end if;
  if p_base_points is null or p_base_points < 1 or p_base_points > 1000 then
    raise exception 'Base points must be between 1 and 1000';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 100 then
    raise exception 'Batch size must be between 1 and 100';
  end if;

  while v_created < p_batch_size loop
    v_inserted := false;
    -- gen_random_uuid is backed by pgcrypto. Sixteen hex characters provide
    -- 64 bits of unpredictable entropy, and the unique index handles the
    -- vanishingly unlikely collision without ever issuing a duplicate.
    for v_attempt in 1..25 loop
      v_hash := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
      insert into public.qr_codes(hash, classroom_id, qr_type, base_points, created_by)
      values (v_hash, null, p_qr_type, p_base_points, auth.uid())
      on conflict (hash) do nothing
      returning * into v_code;
      if found then
        v_inserted := true;
        return next v_code;
        v_created := v_created + 1;
        exit;
      end if;
    end loop;
    if not v_inserted then
      raise exception 'Could not allocate a unique QR code after 25 attempts';
    end if;
  end loop;
end;
$$;

revoke all on function public.create_general_qr_batch(text, integer, integer) from public;
grant execute on function public.create_general_qr_batch(text, integer, integer) to authenticated;
