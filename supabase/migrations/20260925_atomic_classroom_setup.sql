-- P0: create a classroom and its default records atomically.

create or replace function public.create_classroom(
  p_grade_level text, p_section text, p_subject text, p_school_year text,
  p_num_groups integer, p_uses_groups boolean, p_join_code text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_classroom public.classrooms%rowtype;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if nullif(trim(p_section), '') is null or nullif(trim(p_subject), '') is null then
    raise exception 'Section and subject are required' using errcode = '22023';
  end if;
  if coalesce(p_uses_groups, true) and (p_num_groups is null or p_num_groups < 1 or p_num_groups > 12) then
    raise exception 'Grouped classes must have between 1 and 12 groups' using errcode = '22023';
  end if;
  if not coalesce(p_uses_groups, true) and coalesce(p_num_groups, 0) <> 0 then
    raise exception 'Individual classes must have zero groups' using errcode = '22023';
  end if;
  if nullif(trim(p_join_code), '') is null then raise exception 'Join code is required' using errcode = '22023'; end if;

  insert into public.classrooms (teacher_id, grade_level, section, subject, school_year, num_groups, uses_groups, join_code)
  values (v_user, trim(p_grade_level), trim(p_section), trim(p_subject), trim(p_school_year),
    case when coalesce(p_uses_groups, true) then p_num_groups else 0 end,
    coalesce(p_uses_groups, true), upper(trim(p_join_code)))
  returning * into v_classroom;

  if coalesce(v_classroom.uses_groups, true) then
    insert into public.groups (classroom_id, group_number, group_name)
    select v_classroom.id, n, 'Group ' || n from generate_series(1, v_classroom.num_groups) as n;
  end if;
  insert into public.class_settings (classroom_id) values (v_classroom.id);

  return jsonb_build_object('id', v_classroom.id, 'teacher_id', v_classroom.teacher_id,
    'grade_level', v_classroom.grade_level, 'section', v_classroom.section,
    'subject', v_classroom.subject, 'school_year', v_classroom.school_year,
    'num_groups', v_classroom.num_groups, 'uses_groups', v_classroom.uses_groups,
    'join_code', v_classroom.join_code);
end;
$$;

revoke all on function public.create_classroom(text, text, text, text, integer, boolean, text) from public;
grant execute on function public.create_classroom(text, text, text, text, integer, boolean, text) to authenticated;
