-- Individual classes use a private system group numbered 0.
alter table public.groups drop constraint if exists groups_group_number_positive;
alter table public.groups
  add constraint groups_group_number_positive
  check (group_number >= 0);

create or replace function public.validate_group_number_for_classroom()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uses_groups boolean;
begin
  select coalesce(uses_groups, true) into v_uses_groups from public.classrooms where id = new.classroom_id;
  if coalesce(v_uses_groups, true) and new.group_number < 1 then
    raise exception 'Grouped classrooms require a positive group number';
  end if;
  if not coalesce(v_uses_groups, true) and new.group_number <> 0 then
    raise exception 'Individual classrooms use group number 0';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_group_number_for_classroom on public.groups;
create trigger validate_group_number_for_classroom
  before insert or update of classroom_id, group_number on public.groups
  for each row execute function public.validate_group_number_for_classroom();
