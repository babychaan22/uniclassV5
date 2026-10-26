-- XP adjustments are individual classroom records. Remove them together with
-- the roster member, as with the other individual records removed by the
-- teacher's existing student-removal flow.
alter table public.personal_xp_adjustments
  drop constraint if exists personal_xp_adjustments_group_member_id_fkey;

alter table public.personal_xp_adjustments
  add constraint personal_xp_adjustments_group_member_id_fkey
  foreign key (group_member_id) references public.group_members(id) on delete cascade;
