-- 20261230 — student removal must not be blocked by the point-correction audit.
--
-- Error (user-reported): removing a student fails with "update or delete on
-- table participation_logs violates foreign key constraint
-- point_recipient_corrections_source_log_id_fkey".
--
-- reason: the correction audit row pins its source award with
-- on delete restrict. That protects the audit while a learner stays in the
-- class, but both removal paths (remove_student_from_class and
-- remove_roster_member, 20261196) delete the learner's participation logs as
-- part of removing their whole record, and the restrict FK blocks the removal
-- with no recovery in the UI.
--
-- Fix: cascade — when the teacher removes a student (or a roster member), the
-- audit row goes with the source award it describes, consistent with the
-- removal already deleting the learner's scores, attendance, badges, and
-- logs. Corrections that moved points to members who remain are unaffected:
-- their own audit rows and logs survive.

alter table public.point_recipient_corrections
  drop constraint if exists point_recipient_corrections_source_log_id_fkey;

alter table public.point_recipient_corrections
  add constraint point_recipient_corrections_source_log_id_fkey
  foreign key (source_log_id)
  references public.participation_logs(id)
  on delete cascade;
