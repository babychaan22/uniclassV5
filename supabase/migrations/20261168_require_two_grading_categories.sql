-- 20261168 — do not label a learner On Track from one isolated category.
create or replace function public.student_mission_status(p_classroom_id uuid, p_member_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp stable as $$
declare
  v_term public.grading_terms%rowtype; v_settings public.class_settings%rowtype;
  v_attendance numeric := 0; v_activity numeric := 0; v_quiz numeric := 0; v_exam numeric := 0; v_performance numeric := 0; v_participation numeric := 0;
  v_attendance_count integer := 0; v_activity_count integer := 0; v_quiz_count integer := 0; v_exam_count integer := 0; v_performance_count integer := 0; v_participation_count integer := 0;
  v_weight numeric; v_num numeric := 0; v_den numeric := 0; v_points numeric := 0; v_max_points numeric := 1; v_total numeric := 0; v_graded_categories integer := 0;
begin
  select * into v_term from public.grading_terms where classroom_id = p_classroom_id order by is_active desc, created_date desc limit 1;
  select * into v_settings from public.class_settings where classroom_id = p_classroom_id order by created_date desc limit 1;
  select count(*), coalesce(100.0 * count(*) filter (where status = 'present') / nullif(count(*), 0), 0) into v_attendance_count, v_attendance from public.attendances where classroom_id = p_classroom_id and group_member_id = p_member_id and (v_term.id is null or attendance_date between v_term.start_date and v_term.end_date);
  select count(s.id), coalesce(100.0 * sum(s.score) / nullif(sum(a.max_score), 0), 0) into v_activity_count, v_activity from public.activity_scores s join public.activities a on a.id = s.activity_id where s.classroom_id = p_classroom_id and s.group_member_id = p_member_id;
  select count(*), coalesce(100.0 * sum(score) / nullif(sum(max_score), 0), 0) into v_quiz_count, v_quiz from public.teacher_assessments where classroom_id = p_classroom_id and group_member_id = p_member_id and category = 'quiz' and (v_term.id is null or created_date::date between v_term.start_date and v_term.end_date);
  select count(*), coalesce(100.0 * sum(score) / nullif(sum(max_score), 0), 0) into v_exam_count, v_exam from public.teacher_assessments where classroom_id = p_classroom_id and group_member_id = p_member_id and category = 'major_exam' and (v_term.id is null or created_date::date between v_term.start_date and v_term.end_date);
  select count(*), coalesce(100.0 * sum(score) / nullif(sum(max_score), 0), 0) into v_performance_count, v_performance from public.teacher_assessments where classroom_id = p_classroom_id and group_member_id = p_member_id and category = 'performance_task' and (v_term.id is null or created_date::date between v_term.start_date and v_term.end_date);
  select coalesce(sum(case when event_type = 'behavior_penalty' then -abs(points_awarded) else points_awarded end), 0) into v_points from public.participation_logs where classroom_id = p_classroom_id and group_member_id = p_member_id;
  select greatest(coalesce(max(points), 0), 1) into v_max_points from (select coalesce(sum(case when event_type = 'behavior_penalty' then -abs(points_awarded) else points_awarded end), 0) as points from public.participation_logs where classroom_id = p_classroom_id group by group_member_id) totals;
  v_participation := 100.0 * v_points / v_max_points; v_participation_count := case when v_points > 0 then 1 else 0 end;
  v_weight := coalesce(v_settings.weight_attendance, 10); if v_attendance_count > 0 and v_weight > 0 then v_num := v_num + v_attendance * v_weight; v_den := v_den + v_weight; v_graded_categories := v_graded_categories + 1; end if;
  v_weight := coalesce(v_settings.weight_activity_scores, 20); if v_activity_count > 0 and v_weight > 0 then v_num := v_num + v_activity * v_weight; v_den := v_den + v_weight; v_graded_categories := v_graded_categories + 1; end if;
  v_weight := coalesce(v_settings.weight_quizzes, 20); if v_quiz_count > 0 and v_weight > 0 then v_num := v_num + v_quiz * v_weight; v_den := v_den + v_weight; v_graded_categories := v_graded_categories + 1; end if;
  v_weight := coalesce(v_settings.weight_major_exams, 30); if v_exam_count > 0 and v_weight > 0 then v_num := v_num + v_exam * v_weight; v_den := v_den + v_weight; v_graded_categories := v_graded_categories + 1; end if;
  v_weight := coalesce(v_settings.weight_performance_tasks, 20); if v_performance_count > 0 and v_weight > 0 then v_num := v_num + v_performance * v_weight; v_den := v_den + v_weight; v_graded_categories := v_graded_categories + 1; end if;
  v_weight := coalesce(v_settings.weight_participation, 0); if v_participation_count > 0 and v_weight > 0 then v_num := v_num + v_participation * v_weight; v_den := v_den + v_weight; end if;
  if v_graded_categories < 2 then return 'Not enough data'; end if;
  v_total := case when v_den > 0 then v_num / v_den else 0 end;
  return case when v_total >= 80 then 'On Track' when v_total >= 60 then 'Developing' else 'At Risk' end;
end;
$$;
