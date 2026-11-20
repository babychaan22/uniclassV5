-- Atomic grading-term activation (audit A2 / Settings.jsx).
--
-- Settings.jsx activated a new term with two separate writes: one update per
-- active term (is_active=false), then the new/selected term (is_active=true).
-- A dropped connection between a kill leaves TWO active terms, and scores
-- silently post to the wrong term. One teacher-owned transaction fixes that:
-- every other term in the same classroom is deactivated no matter what.

create or replace function public.set_active_grading_term(p_term_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_classroom_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select gt.classroom_id into v_classroom_id
  from public.grading_terms gt
  join public.classrooms c on c.id = gt.classroom_id
  where gt.id = p_term_id and c.teacher_id = auth.uid();
  if v_classroom_id is null then
    raise exception 'Only the classroom teacher can change grading terms.';
  end if;

  update public.grading_terms
    set is_active = (id = p_term_id)
    where classroom_id = v_classroom_id;

  return p_term_id;
end;
$$;

revoke all on function public.set_active_grading_term(uuid) from public, anon;
grant execute on function public.set_active_grading_term(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'set_active_grading_term') then
    raise exception 'BAD_MIGRATION: set_active_grading_term missing';
  end if;
end $$;
