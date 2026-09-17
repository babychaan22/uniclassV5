-- Teacher-only deletion controls. Removing a student from a class does not
-- delete their Supabase Auth user or memberships in other classes.

create or replace function public.remove_student_from_class(p_group_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_account group_accounts%rowtype;
begin
  select * into v_account from group_accounts where id = p_group_account_id for update;
  if not found then raise exception 'Student class membership not found'; end if;
  if not auth_is_teacher_of(v_account.classroom_id) then raise exception 'Only the class teacher can remove a student'; end if;
  delete from group_accounts where id = v_account.id;
  return jsonb_build_object('removed', true, 'classroomId', v_account.classroom_id, 'userId', v_account.user_id);
end;
$$;

create or replace function public.delete_classroom(p_classroom_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_classroom classrooms%rowtype;
begin
  select * into v_classroom from classrooms where id = p_classroom_id for update;
  if not found then raise exception 'Class not found'; end if;
  if v_classroom.teacher_id <> auth.uid() then raise exception 'Only the class teacher can delete this class'; end if;
  delete from classrooms where id = p_classroom_id;
  return jsonb_build_object('deleted', true, 'classroomId', p_classroom_id);
end;
$$;

revoke all on function public.remove_student_from_class(uuid) from public;
revoke all on function public.delete_classroom(uuid) from public;
grant execute on function public.remove_student_from_class(uuid) to authenticated;
grant execute on function public.delete_classroom(uuid) to authenticated;
