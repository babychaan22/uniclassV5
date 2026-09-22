// AI/formative missions are submitted by individual learners. Manual missions
// retain the teacher's existing group-grade workflow. A member id is also used
// as a safe fallback for older individual records.
export function missionUsesIndividualProgress(mission, submissions = []) {
  if (mission?.formative_type && mission.formative_type !== 'manual') return true;
  return submissions.some((submission) => submission.mission_id === mission?.id && !!submission.group_member_id);
}

export function getMissionProgress(mission, submissions = [], groups = [], members = []) {
  const relevant = submissions.filter((submission) => submission.mission_id === mission?.id);
  const individual = missionUsesIndividualProgress(mission, relevant);
  const keys = relevant.map((submission) => individual ? submission.group_member_id : submission.group_id).filter(Boolean);
  const completed = new Set(keys).size;
  const total = individual ? members.length : groups.length;
  return {
    individual,
    completed,
    total,
    completion: total ? Math.min(100, Math.round((completed / total) * 100)) : 0,
    submissions: relevant,
  };
}
