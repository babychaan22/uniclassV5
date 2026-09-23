
import { useEffect, useState } from "react";
import ClayCard from "@/components/ClayCard";
import { UIAsset } from "@/components/visual/UIAsset";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";

const db = globalThis.__B44_DB__;

function weekEnds(start, end) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7));
  const limit = new Date(`${end}T00:00:00Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (limit > today) limit.setTime(today.getTime());
  while (d <= limit) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  const currentKey = limit.toISOString().slice(0, 10);
  if (out.at(-1) !== currentKey) out.push(currentKey);
  return out;
}

function recentWeekEnds(n) {
  const out = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const e = new Date(d);
    e.setUTCDate(e.getUTCDate() - i * 7);
    out.push(e.toISOString().slice(0, 10));
  }
  return out;
}

function attRate(memberId, attendance, start, end) {
  const recs = attendance.filter((a) => a.group_member_id === memberId && (a.attendance_date || "") >= start && (a.attendance_date || "") <= end);
  if (!recs.length) return 0;
  return Math.round((recs.filter((a) => a.status === "present").length / recs.length) * 100);
}
function participation(memberId, logs, upTo) {
  return logs
    .filter((l) => l.group_member_id === memberId && (l.created_date || "").slice(0, 10) <= upTo)
    .reduce((s, l) => s + (l.event_type === "behavior_penalty" ? -Math.abs(l.points_awarded || 0) : l.points_awarded || 0), 0);
}
function activityPct(memberId, scores, activities, start, end) {
  const actIds = new Set(activities.map((a) => a.id));
  const recs = scores.filter((s) => s.group_member_id === memberId && actIds.has(s.activity_id) && (s.created_date || "").slice(0, 10) >= start && (s.created_date || "").slice(0, 10) <= end);
  if (!recs.length) return 0;
  let tot = 0, max = 0;
  for (const r of recs) { const a = activities.find((x) => x.id === r.activity_id); const m = a?.max_score || 10; tot += r.score; max += m; }
  return max ? Math.round((tot / max) * 100) : 0;
}
function categoryPct(memberId, assessments, cat, start, end) {
  const recs = assessments.filter((a) => a.group_member_id === memberId && a.category === cat && (a.created_date || "").slice(0, 10) >= start && (a.created_date || "").slice(0, 10) <= end);
  if (!recs.length) return 0;
  let tot = 0, max = 0;
  for (const r of recs) { tot += r.score; max += r.max_score; }
  return max ? Math.round((tot / max) * 100) : 0;
}

// Fetches its own assessments + grading terms so a failure never blocks the
// rest of the student dashboard (which passes the already-loaded data below).
export default function TrendCharts({ classroomId, members, currentMemberId, attendance, scores, activities, logs, range = "week" }) {
  const [extra, setExtra] = useState(null);

  useEffect(() => {
    let alive = true;
    setExtra(null);
    Promise.all([
      db.entities.TeacherAssessment.filter({ classroom_id: classroomId }),
      db.entities.GradingTerm.filter({ classroom_id: classroomId }),
    ])
      .then(([assessments, terms]) => { if (alive) setExtra({ assessments, terms }); })
      .catch(() => { if (alive) setExtra({ assessments: [], terms: [] }); });
    return () => { alive = false; };
  }, [classroomId]);

  if (!extra) return null;

  const { assessments, terms } = extra;
  const term = terms.find((t) => t.is_active) || terms[0];
  const allWeeks = term ? weekEnds(term.start_date, term.end_date) : recentWeekEnds(8);
  const rangeCount = range === "week" ? 1 : range === "month" ? 4 : allWeeks.length;
  const weeks = allWeeks.slice(-rangeCount);
  if (weeks.length === 0) return null;
  const member = members.find((item) => item.id === currentMemberId) || members[0];
  if (!member) return null;

  const lastWeek = weeks[weeks.length - 1];
  const rangeStartDate = new Date(`${weeks[0]}T00:00:00Z`);
  rangeStartDate.setUTCDate(rangeStartDate.getUTCDate() - 6);
  const rangeStart = range === "term" && term ? term.start_date : rangeStartDate.toISOString().slice(0, 10);
  const attendancePct = attRate(member.id, attendance, rangeStart, lastWeek);
  const activity = activityPct(member.id, scores, activities, rangeStart, lastWeek);
  const learningBars = [
    { name: "Activities", value: activity, color: "#A6E22E" },
    { name: "Quizzes", value: categoryPct(member.id, assessments, "quiz", rangeStart, lastWeek), color: "#4FD1F2" },
    { name: "Performance", value: categoryPct(member.id, assessments, "performance_task", rangeStart, lastWeek), color: "#8B5CF6" },
  ].filter((item) => item.value > 0 || item.name === "Activities");
  const weeklyPoints = weeks.map((weekEnd) => {
    const start = new Date(`${weekEnd}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    const weekStart = start.toISOString().slice(0, 10);
    return {
      week: weekEnd.slice(5),
      points: logs
        .filter((log) => log.group_member_id === member.id && (log.created_date || "").slice(0, 10) >= weekStart && (log.created_date || "").slice(0, 10) <= weekEnd)
        .reduce((sum, log) => sum + (log.points_awarded || 0), 0),
    };
  });

  return (
    <section aria-label="Your progress" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <ClayCard className="p-4 sm:p-5">
        <p className="flex items-center gap-2 font-display text-sm font-bold"><span className="uc-icon-tile h-9 w-9 rounded-xl bg-clay-sky/15"><UIAsset name="attendance" className="h-8 w-8" /></span>Attendance</p>
        <div className="mx-auto mt-4 flex h-32 w-32 items-center justify-center rounded-full" style={{ background: `conic-gradient(#32A9ED ${attendancePct}%, #E8EDF5 0)` }}>
          <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white"><strong className="font-mono text-2xl text-[var(--uc-navy-950)]">{attendancePct}%</strong><span className="text-[10px] text-ink/60">present</span></div>
        </div>
      </ClayCard>
      <ClayCard className="p-4 sm:p-5">
        <p className="flex items-center gap-2 font-display text-sm font-bold"><span className="uc-icon-tile h-9 w-9 rounded-xl bg-clay-purple/12"><UIAsset name="analytics" className="h-8 w-8" /></span>Learning progress</p>
        <div className="mt-5 space-y-4">
          {learningBars.map((item) => <div key={item.name}><div className="mb-1 flex justify-between text-xs font-display font-bold"><span>{item.name}</span><span>{Math.round(item.value)}%</span></div><div className="uc-progress-track"><div className="uc-progress-fill" style={{ width: `${Math.min(item.value, 100)}%`, backgroundColor: item.color }} /></div></div>)}
        </div>
      </ClayCard>
      <ClayCard className="p-4 sm:col-span-2 sm:p-5 lg:col-span-1">
        <p className="flex items-center gap-2 font-display text-sm font-bold"><span className="uc-icon-tile h-9 w-9 rounded-xl bg-clay-pink/12"><UIAsset name="analytics" className="h-8 w-8" /></span>Points earned</p>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={weeklyPoints} margin={{ top: 14, right: 0, left: -28, bottom: 0 }}><XAxis dataKey="week" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="points" fill="#FF5FA8" radius={[8, 8, 0, 0]} /></BarChart>
        </ResponsiveContainer>
      </ClayCard>
      <p className="sm:col-span-2 lg:col-span-3 text-xs text-ink/60">{term ? `${term.term_label} · ` : ""}Progress reflects the selected period.</p>
    </section>
  );
}
