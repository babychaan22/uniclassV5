-- A remove request must disappear when its learner is removed.  The previous
-- SET NULL rule breaks the table's valid-remove-request check constraint.
alter table public.representative_roster_requests
  drop constraint if exists representative_roster_requests_target_member_id_fkey;

alter table public.representative_roster_requests
  add constraint representative_roster_requests_target_member_id_fkey
  foreign key (target_member_id) references public.group_members(id) on delete cascade;
