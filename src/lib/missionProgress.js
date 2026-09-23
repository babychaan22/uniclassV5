// AI/formative missions are submitted by individual learners. Manual missions
// retain the teacher's existing group-grade workflow.
export function missionUsesIndividualProgress(mission, submissions = []) {
  if (mission?.formative_type && mission.formative_type !== 'manual') return true;
  return submissions.some((submission) => submission.mission_id === mission?.id && !!submission.group_member_id);
}

export function getMissionMaxScore(mission) {
  try {
    const content = JSON.parse(mission?.ai_content || '{}');
    if (mission?.formative_type === 'drag_drop' && Array.isArray(content.left)) return content.left.length || Number(mission.max_score) || 0;
    if (Array.isArray(content.questions)) return content.questions.length || Number(mission.max_score) || 0;
  } catch {}
  return Number(mission?.max_score) || 0;
}

export function getMissionProgress(mission, submissions = [], groups = [], members = []) {
  const relevant = submissions.filter((submission) => submission.mission_id === mission?.id);
  const individual = missionUsesIndividualProgress(mission, relevant);
  const byRecipient = new Map();
  relevant.forEach((submission) => {
    const key = individual ? submission.group_member_id : submission.group_id;
    if (key && !byRecipient.has(key)) byRecipient.set(key, submission);
  });
  const completed = byRecipient.size;
  const total = individual ? members.length : groups.length;
  const maxScore = getMissionMaxScore(mission);
  const accuracy = byRecipient.size && maxScore > 0
    ? Math.round([...byRecipient.values()].reduce((sum, submission) => sum + (Number(submission.score) || 0), 0) / (byRecipient.size * maxScore) * 100)
    : 0;
  return { individual, completed, total, completion: total ? Math.min(100, Math.round((completed / total) * 100)) : 0, accuracy: Math.min(100, Math.max(0, accuracy)), maxScore, submissions: [...byRecipient.values()] };
}

export function missionDeadlineAt(mission) {
  if (!mission) return null;
  if (mission.deadline_at) {
    const date = new Date(mission.deadline_at);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (!mission.deadline) return null;
  const date = new Date(`${mission.deadline}T23:59:59+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isMissionLocked(mission, now = new Date()) {
  const deadline = missionDeadlineAt(mission);
  return !!deadline && now.getTime() > deadline.getTime();
}

export function formatMissionDeadline(mission) {
  const deadline = missionDeadlineAt(mission);
  return deadline ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(deadline) : null;
}
