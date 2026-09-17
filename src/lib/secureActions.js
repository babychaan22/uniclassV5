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

export async function claimBadgeDefinition(definitionId, groupId, memberId = null) {
  const { data, error } = await supabase.rpc('claim_badge_definition', {
    p_definition_id: definitionId,
    p_group_id: groupId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return data;
}

export async function redeemReward(rewardId) {
  const { data, error } = await supabase.rpc('redeem_reward', {
    p_reward_id: rewardId,
  });
  if (error) throw error;
  return data;
}

export async function redeemMissionPoints(amount) {
  const { data, error } = await supabase.rpc('redeem_mission_points', {
    p_amount: amount,
  });
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
