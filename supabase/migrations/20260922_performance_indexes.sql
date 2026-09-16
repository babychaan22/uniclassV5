-- Query paths used by classroom dashboards, score entry, evidence review, and logs.
create index if not exists idx_group_accounts_user_approved on public.group_accounts(user_id, is_approved);
create index if not exists idx_group_accounts_classroom on public.group_accounts(classroom_id);
create index if not exists idx_groups_classroom on public.groups(classroom_id);
create index if not exists idx_group_members_classroom on public.group_members(classroom_id);
create index if not exists idx_group_members_group on public.group_members(group_id);
create index if not exists idx_attendances_classroom_date on public.attendances(classroom_id, attendance_date desc);
create index if not exists idx_attendances_group_member on public.attendances(group_id, group_member_id, attendance_date desc);
create index if not exists idx_activity_scores_classroom_activity on public.activity_scores(classroom_id, activity_id);
create index if not exists idx_activity_scores_group_activity on public.activity_scores(group_id, activity_id);
create index if not exists idx_activities_classroom_number on public.activities(classroom_id, activity_number);
create index if not exists idx_participation_logs_classroom_created on public.participation_logs(classroom_id, created_date desc);
create index if not exists idx_participation_logs_group_created on public.participation_logs(group_id, created_date desc);
create index if not exists idx_reward_redemptions_classroom_created on public.reward_redemptions(classroom_id, created_date desc);
create index if not exists idx_badges_classroom_week on public.badges(classroom_id, week_start_date, created_date desc);
create index if not exists idx_activity_evidence_classroom_created on public.activity_evidence(classroom_id, created_at desc);
create index if not exists idx_activity_evidence_group_activity on public.activity_evidence(group_id, activity_id, group_member_id);
create index if not exists idx_mission_submissions_classroom_created on public.mission_submissions(classroom_id, created_date desc);
