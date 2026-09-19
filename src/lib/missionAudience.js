// A mission may originate in one classroom but be assigned to another class
// taught by the same teacher. Once an explicit class list exists, it is the
// source of truth; the origin classroom is only a legacy fallback.
export function missionTargetsClass(mission, classroomId) {
  if (!mission || !classroomId) return false;
  if (mission.applies_to_all_classes) return true;
  const targets = Array.isArray(mission.target_classroom_ids) ? mission.target_classroom_ids : [];
  return targets.length > 0 ? targets.includes(classroomId) : mission.classroom_id === classroomId;
}
