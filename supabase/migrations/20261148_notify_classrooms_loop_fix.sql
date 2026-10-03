-- 20261148 — repair the two fan-out helpers.
--
-- notify_classroom had never been executed. It has had no callers since it was
-- written, and its teacher branch does:
--
--   returning id into v_ids[1];
--
-- which plpgsql rejects with "cannot subscript type uuid because it does not
-- support subscripting". So the moment anything actually tried to notify a
-- teacher, it raised. Every notification in this system is about to depend on
-- this function, so it is rewritten to collect ids with array_agg instead.
--
-- Two smaller repairs while here:
--
--   * student fan-out now skips accounts with no linked auth user. The column
--     is nullable and the recipient column references auth.users, so an
--     unlinked account would abort the whole insert.
--   * notify_classrooms reads "foreach x in array coalesce(...)", which plpgsql
--     parses as a constructor over a scalar. Assigning the coalesce to a local
--     first removes the ambiguity.

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
  v_new uuid;
begin
  if p_audience = 'teacher' then
    for v_new in
      insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
      select p_classroom_id, c.teacher_id, 'teacher', p_kind, p_title, p_body, p_link
      from public.classrooms c
      where c.id = p_classroom_id and c.teacher_id is not null
      returning id
    loop
      v_ids := array_append(v_ids, v_new);
    end loop;
  else
    for v_new in
      insert into public.app_notifications(classroom_id, recipient_user_id, audience, kind, title, body, link)
      select p_classroom_id, ga.user_id, 'student', p_kind, p_title, p_body, p_link
      from public.group_accounts ga
      where ga.classroom_id = p_classroom_id
        and ga.is_approved = true
        and ga.user_id is not null
      returning id
    loop
      v_ids := array_append(v_ids, v_new);
    end loop;
  end if;

  return v_ids;
end;
$$;

revoke all on function public.notify_classroom(uuid, text, text, text, text, text) from public;
grant execute on function public.notify_classroom(uuid, text, text, text, text, text) to authenticated;

create or replace function public.notify_classrooms(
  p_classroom_ids uuid[],
  p_audience text,
  p_kind text,
  p_title text,
  p_body text,
  p_link text default null
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[] := coalesce(p_classroom_ids, '{}'::uuid[]);
  v_classroom uuid;
  v_count integer := 0;
begin
  foreach v_classroom in array v_ids
  loop
    v_count := v_count + coalesce(cardinality(
      public.notify_classroom(v_classroom, p_audience, p_kind, p_title, p_body, p_link)
    ), 0);
  end loop;
  return v_count;
end;
$$;

revoke all on function public.notify_classrooms(uuid[], text, text, text, text, text) from public;

