
import { isDateInRange, toManilaDate, getTodayManila } from "./week";
import { hasClassDays, isScheduledClassDay } from "./classDays";

export function computeAttendanceRate(memberId, attendance, term) {
  const records = attendance.filter(
    (a) => a.group_member_id === memberId && isDateInRange(a.attendance_date, term?.start_date, term?.end_date)
  );
  if (records.length === 0) return { rate: 0, count: 0, present: 0 };
  const present = records.filter((r) => r.status === "present").length;
  return { rate: (present / records.length) * 100, count: records.length, present };
}

export function computeAttendanceStreak(memberId, attendance, classDays) {
  if (!hasClassDays(classDays)) {
    const records = attendance
      .filter((a) => a.group_member_id === memberId)
      .sort((a, b) => b.attendance_date.localeCompare(a.attendance_date));
    let legacyStreak = 0;
    for (const record of records) {
      if (record.status !== "present") break;
      legacyStreak++;
    }
    return legacyStreak;
  }
  const records = new Map(
    attendance
      .filter((a) => a.group_member_id === memberId && a.attendance_date)
      .map((record) => [record.attendance_date, record])
  );
  let streak = 0;
  const cursor = new Date(`${getTodayManila()}T00:00:00Z`);
  while (true) {
    if (!isScheduledClassDay(cursor, classDays)) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
      continue;
    }
    const record = records.get(cursor.toISOString().slice(0, 10));
    if (!record || record.status !== "present") break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function computeActivityPct(memberId, activityScores, activities) {
  const memberScores = activityScores.filter((s) => s.group_member_id === memberId);
  if (memberScores.length === 0) return { pct: 0, count: 0 };
  let totalScore = 0;
  let totalMax = 0;
  for (const s of memberScores) {
    const act = activities.find((a) => a.id === s.activity_id);
    if (act) {
      totalScore += s.score;
      totalMax += act.max_score;
    }
  }
  return { pct: totalMax > 0 ? (totalScore / totalMax) * 100 : 0, count: memberScores.length };
}

// Behavior penalties are stored as a positive number and must always be read as
// a deduction. Every total in the app goes through here so a penalty can never
// be counted as a reward.
export function signedPoints(log) {
  const points = Number(log?.points_awarded || 0);
  return log?.event_type === "behavior_penalty" ? -Math.abs(points) : points;
}

export function computeParticipationPoints(memberId, logs) {
  const memberLogs = logs.filter((l) => l.group_member_id === memberId);
  return memberLogs.reduce((sum, l) => sum + signedPoints(l), 0);
}

export function computeCategoryPct(memberId, assessments, category, term) {
  const records = assessments.filter(
    (a) => a.group_member_id === memberId && a.category === category &&
    isDateInRange(a.created_date?.slice(0, 10), term?.start_date, term?.end_date)
  );
  if (records.length === 0) return { pct: 0, count: 0 };
  let totalScore = 0;
  let totalMax = 0;
  for (const r of records) {
    totalScore += r.score;
    totalMax += r.max_score;
  }
  return { pct: totalMax > 0 ? (totalScore / totalMax) * 100 : 0, count: records.length };
}

export function computeEngagementStreak(memberId, attendance, scores, todayStr, classDays) {
  const days = new Set();
  for (const a of attendance) {
    if (a.group_member_id === memberId && a.attendance_date) {
      days.add(toManilaDate(a.attendance_date));
    }
  }
  for (const s of scores) {
    if (s.group_member_id === memberId && s.created_date) {
      days.add(toManilaDate(s.created_date));
    }
  }
  if (!hasClassDays(classDays)) return 0;
  let streak = 0;
  const d = new Date(`${todayStr}T00:00:00Z`);
  while (true) {
    if (!isScheduledClassDay(d, classDays)) {
      d.setUTCDate(d.getUTCDate() - 1);
      continue;
    }
    if (!days.has(d.toISOString().slice(0, 10))) break;
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return streak;
}
