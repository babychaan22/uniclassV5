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

export async function correctParticipationRecipient(sourceLogId, targetMemberId, reason) {
  const { data, error } = await supabase.rpc('correct_participation_recipient', {
    p_source_log_id: sourceLogId,
    p_target_member_id: targetMemberId || null,
    p_reason: reason,
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
