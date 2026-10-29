-- Teachers can send one concise in-app reminder to the affected learners
-- directly from the dashboard. The function is deliberately scoped to the
-- teacher's own classroom and only approved student accounts.

create or replace function public.send_student_reminder(
  p_classroom_id uuid,
  p_member_ids uuid[],
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null or not public.auth_is_teacher_of(p_classroom_id) then
    raise exception 'Only this classroom''s teacher can send reminders';
  end if;

  if coalesce(array_length(p_member_ids, 1), 0) = 0 then
    raise exception 'Choose at least one learner';
  end if;

  if p_kind not in ('attendance', 'mission', 'points') then
    raise exception 'Unknown reminder type';
  end if;

  insert into public.app_notifications(
    classroom_id, recipient_user_id, audience, kind, title, body, link
  )
  select distinct p_classroom_id, account.user_id, 'student', p_kind,
    left(trim(p_title), 120), left(trim(p_body), 500), nullif(trim(p_link), '')
  from public.group_accounts account
  where account.classroom_id = p_classroom_id
    and account.is_approved = true
    and account.transferred_at is null
    and account.group_member_id = any(p_member_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.send_student_reminder(uuid, uuid[], text, text, text, text) from public;
grant execute on function public.send_student_reminder(uuid, uuid[], text, text, text, text) to authenticated;
