-- QR hashes are secrets. Students may preview a code's public details through
-- this RPC, but cannot list hashes or harvest unused QR rows.
drop policy if exists "student_read_qr_codes" on public.qr_codes;

create or replace function public.peek_qr_code(p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_qr public.qr_codes%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.group_accounts where user_id = auth.uid() and is_approved = true
  ) then
    raise exception 'Approved student account required';
  end if;

  select * into v_qr from public.qr_codes where hash = trim(p_hash);
  if not found or v_qr.is_used then
    raise exception 'This QR code has already been used or is invalid';
  end if;

  return jsonb_build_object('qr_type', v_qr.qr_type, 'base_points', v_qr.base_points);
end;
$$;

revoke all on function public.peek_qr_code(text) from public;
grant execute on function public.peek_qr_code(text) to authenticated;
