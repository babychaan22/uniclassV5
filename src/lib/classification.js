
export function computeClassification(categories, weights) {
  const w = weights || {};
  const map = {
    attendance_rate: w.weight_attendance ?? 10,
    activity_score_pct: w.weight_activity_scores ?? 20,
    quiz_pct: w.weight_quizzes ?? 20,
    major_exam_pct: w.weight_major_exams ?? 30,
    performance_task_pct: w.weight_performance_tasks ?? 20,
    participation_normalized: w.weight_participation ?? 0,
  };

  let num = 0;
  let den = 0;
  for (const c of categories) {
    if (!c.count || c.count === 0) continue;
    const weight = map[c.key] ?? c.weight ?? 0;
    if (weight === 0) continue;
    num += c.value * weight;
    den += weight;
  }

  const total = den > 0 ? num / den : 0;
  const tag = total >= 80 ? "On Track" : total >= 60 ? "Developing" : "At Risk";
  const color = total >= 80 ? "lime" : total >= 60 ? "sun" : "coral";
  return { total: Math.round(total * 10) / 10, tag, color };
}

export const STATUS_COLOR = {
  "On Track": "lime",
  Developing: "sun",
  "At Risk": "coral",
  Present: "lime",
  Absent: "coral",
};

