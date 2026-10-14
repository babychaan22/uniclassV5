-- A teacher may recognise several duplicate enrolments as the same learner.
-- Keep their existing audit rows, but make the multi-record merge atomic: if
-- any selected source cannot be moved, none of the selected records move.

create or replace function public.transfer_student_records(
  p_source_member_ids uuid[],
  p_target_member_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_member_id uuid;
  v_transfer public.student_record_transfers%rowtype;
  v_seen uuid[] := array[]::uuid[];
  v_moved_sources integer := 0;
  v_moved_logs integer := 0;
  v_moved_attendance integer := 0;
  v_moved_scores integer := 0;
  v_moved_submissions integer := 0;
  v_moved_badges integer := 0;
  v_moved_rewards integer := 0;
  v_moved_reviews integer := 0;
begin
  if coalesce(cardinality(p_source_member_ids), 0) = 0 then
    raise exception 'Choose at least one student record to move';
  end if;

  foreach v_source_member_id in array p_source_member_ids loop
    if v_source_member_id is null then
      raise exception 'A selected student record is invalid';
    end if;
    if v_source_member_id = p_target_member_id then
      raise exception 'A student record cannot be moved onto itself';
    end if;
    if v_source_member_id = any(v_seen) then
      raise exception 'Choose each source student only once';
    end if;
    v_seen := array_append(v_seen, v_source_member_id);

    select * into v_transfer
    from public.transfer_student_record(v_source_member_id, p_target_member_id, p_note);

    v_moved_sources := v_moved_sources + 1;
    v_moved_logs := v_moved_logs + coalesce(v_transfer.moved_logs, 0);
    v_moved_attendance := v_moved_attendance + coalesce(v_transfer.moved_attendance, 0);
    v_moved_scores := v_moved_scores + coalesce(v_transfer.moved_scores, 0);
    v_moved_submissions := v_moved_submissions + coalesce(v_transfer.moved_submissions, 0);
    v_moved_badges := v_moved_badges + coalesce(v_transfer.moved_badges, 0);
    v_moved_rewards := v_moved_rewards + coalesce(v_transfer.moved_rewards, 0);
    v_moved_reviews := v_moved_reviews + coalesce(v_transfer.moved_reviews, 0);
  end loop;

  return jsonb_build_object(
    'moved_sources', v_moved_sources,
    'moved_logs', v_moved_logs,
    'moved_attendance', v_moved_attendance,
    'moved_scores', v_moved_scores,
    'moved_submissions', v_moved_submissions,
    'moved_badges', v_moved_badges,
    'moved_rewards', v_moved_rewards,
    'moved_reviews', v_moved_reviews
  );
end;
$$;

revoke all on function public.transfer_student_records(uuid[], uuid, text) from public;
grant execute on function public.transfer_student_records(uuid[], uuid, text) to authenticated;
