-- Harden the family-summary reply inbox: explicitly reject unauthenticated
-- callers instead of returning an empty set. 20261226's SQL-language function
-- could be executed by anon (Supabase default privileges grant execute
-- broadly); data was protected because auth.uid() is null for anon, but a
-- clear 403-style error is safer and easier to reason about.

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
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  return query
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
end;
$$;

revoke all on function public.list_family_summary_replies() from public;
grant execute on function public.list_family_summary_replies() to authenticated;
