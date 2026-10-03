import { supabase } from '@/api/supabaseClient';

export async function joinClassroom(payload) {
  const { data, error } = await supabase.rpc('join_classroom', payload);
  if (error) throw error;
  return data;
}

export async function createClassroom(payload) {
  const { data, error } = await supabase.rpc('create_classroom', payload);
  if (error) throw error;
  return data;
}

export async function deleteClassroom(classroomId) {
  const { data, error } = await supabase.rpc('delete_classroom', { p_classroom_id: classroomId });
  if (error) throw error;
  return data;
}

export async function removeStudentFromClass(groupAccountId) {
  const { data, error } = await supabase.rpc('remove_student_from_class', { p_group_account_id: groupAccountId });
  if (error) throw error;
  return data;
}

export async function removeRosterMember(groupMemberId) {
  const { data, error } = await supabase.rpc('remove_roster_member', { p_group_member_id: groupMemberId });
  if (error) throw error;
  return data;
}

export async function setGroupRepresentative(groupAccountId) {
  const { data, error } = await supabase.rpc('set_group_representative', { p_group_account_id: groupAccountId });
  if (error) throw error;
  return data;
}

export async function ensureGroupActivity(classroomId, groupId, activityNumber, maxScore) {
  const { data, error } = await supabase.rpc('ensure_group_activity', {
    p_classroom_id: classroomId,
    p_group_id: groupId,
    p_activity_number: activityNumber,
    p_max_score: maxScore,
  });
  if (error) throw error;
  return data;
}

export async function recordActivityEvidence(activityId, groupMemberId, storagePath, originalName, fileSize, mimeType = 'image/webp') {
  const { data, error } = await supabase.rpc('record_activity_evidence', {
    p_activity_id: activityId,
    p_group_member_id: groupMemberId,
    p_storage_path: storagePath,
    p_original_name: originalName,
    p_file_size: fileSize,
    p_mime_type: mimeType,
  });
  if (error) throw error;
  return data;
}

// Materialises today's Daily Math Power-Up, built from the approved question
// bank. Returns a sanitised mission: no answer key, no explanations.
//
// The mission is created *pending*. Generating it is not publishing it, so the
// result is only a mission a student may do once approval_status is 'approved'
// and is_active is true.
export async function ensureDailyPowerUp(classroomId) {
  const { data, error } = await supabase.rpc('ensure_daily_power_up_for_student', {
    p_classroom_id: classroomId,
  });
  if (error) throw error;
  return data;
}

// Does the Daily Math Power-Up apply to this classroom at all? It is a
// Mathematics activity, so a student in an English classroom must not be shown
// a Power-Up section waiting on a review that will never come.
export async function powerUpAppliesToClassroom(classroomId) {
  const { data, error } = await supabase.rpc('power_up_applies_to_classroom', {
    p_classroom_id: classroomId,
  });
  if (error) throw error;
  return data === true;
}

// A teacher opening their missions page calls this once so today's Power-Up is
// waiting as pending in their review queue, instead of appearing only after a
// student happens to open theirs first. It prepares; it never publishes.
export async function generatePendingPowerUps() {
  const { data, error } = await supabase.rpc('generate_pending_power_ups');
  if (error) throw error;
  return data;
}

// A teacher reviews a mission. Approving is what publishes it to students;
// rejecting or sending it back withholds it again.
export async function setMissionApproval(missionId, status, classroomId = null) {
  const { data, error } = await supabase.rpc('set_mission_approval', {
    p_mission_id: missionId,
    p_status: status,
    p_classroom_id: classroomId,
  });
  if (error) throw error;
  return data;
}

// Publishes today's Power-Up to every Mathematics class the teacher owns in one
// action, instead of once per class.
export async function approvePowerUpForAllClasses(autoDailyDate = null) {
  const { data, error } = await supabase.rpc('approve_power_up_for_all_classes', {
    p_auto_daily_date: autoDailyDate,
  });
  if (error) throw error;
  return data;
}

// Edits a mission, including one already approved and deployed. Only the
// teacher-owned fields are writable, and editing never changes its approval
// state or visibility.
export async function updateMission(missionId, patch) {
  const { data, error } = await supabase.rpc('update_mission', {
    p_mission_id: missionId,
    p_patch: patch,
  });
  if (error) throw error;
  return data;
}

export async function requestActivityScoreEdit(activityScoreId, proposedScore, evidenceId) {
  const { data, error } = await supabase.rpc('request_activity_score_edit', {
    p_activity_score_id: activityScoreId,
    p_proposed_score: proposedScore,
    p_evidence_id: evidenceId,
  });
  if (error) throw error;
  return data;
}

export async function reviewActivityScoreEdit(requestId, approve) {
  const { data, error } = await supabase.rpc('review_activity_score_edit', {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) throw error;
  return data;
}

export async function lookupClassroomByJoinCode(joinCode) {
  const { data, error } = await supabase.rpc('lookup_classroom_by_join_code', {
    p_join_code: joinCode,
  });
  if (error) throw error;
  return data;
}

export async function submitMission(payload) {
  const { data, error } = await supabase.rpc('submit_mission', payload);
  if (error) throw error;
  return data;
}

export async function getMissionSubmissionReview(missionId, groupId, retryAttemptId = null) {
  const { data, error } = await supabase.rpc('get_mission_submission_review', {
    p_mission_id: missionId, p_group_id: groupId, p_retry_attempt_id: retryAttemptId,
  });
  if (error) throw error;
  return data;
}

export async function startMissionRetry(missionId, groupId) {
  const { data, error } = await supabase.rpc('start_mission_retry', { p_mission_id: missionId, p_group_id: groupId });
  if (error) throw error;
  return data;
}

export async function claimBadgeDefinition(definitionId, groupId, memberId = null) {
  const { data, error } = await supabase.rpc('claim_badge_definition', {
    p_definition_id: definitionId,
    p_group_id: groupId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return data;
}

export async function redeemReward(rewardId, classroomId = null) {
  const { data, error } = await supabase.rpc('redeem_reward', {
    p_reward_id: rewardId,
    p_classroom_id: classroomId,
  });
  if (error) throw error;
  return data;
}

export async function redeemMissionPoints(amount, classroomId) {
  const { data, error } = await supabase.rpc('redeem_mission_points', {
    p_amount: amount,
    p_classroom_id: classroomId,
  });
  if (error) throw error;
  return data;
}

export async function correctParticipationRecipient(sourceLogId, targetMemberId) {
  const { data, error } = await supabase.rpc('correct_participation_recipient', {
    p_source_log_id: sourceLogId,
    p_target_member_id: targetMemberId || null,
    // Kept for compatibility with the existing protected database function.
    // The interface no longer asks teachers to write an unnecessary reason.
    p_reason: 'Recipient correction',
  });
  if (error) throw error;
  return data;
}

export async function reviewBadgeClaim(badgeId, approve) {
  const { data, error } = await supabase.rpc('review_badge_claim', { p_badge_id: badgeId, p_approve: approve });
  if (error) throw error;
  return data;
}

export async function reviewRewardRedemption(redemptionId, approve) {
  const { data, error } = await supabase.rpc('review_reward_redemption', { p_redemption_id: redemptionId, p_approve: approve });
  if (error) throw error;
  return data;
}

export async function completeLearningReview(reviewId, correct) {
  const { data, error } = await supabase.rpc('complete_learning_review', {
    p_review_id: reviewId,
    p_correct: correct,
  });
  if (error) throw error;
  return data;
}
