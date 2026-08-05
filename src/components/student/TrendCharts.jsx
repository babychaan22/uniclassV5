
import { useEffect, useState } from "react";
import ClayCard from "@/components/ClayCard";
import { TrendingUp } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

const db = globalThis.__B44_DB__;

const PALETTE = ["#8B5CF6", "#FF5FA8", "#4FD1F2", "#A6E22E", "#FFD93D", "#FF6B57", "#6C9EFF", "#F59E0B"];

function weekEnds(start, end) {
  const out = [];
  const d = new Date(start + "T00:00:00");
  d.setDate(d.getDate() + 6);
  const limit = new Date(end + "T00:00:00");
  const today = new Date();
  if (limit > today) limit.setTime(today.getTime());
  while (d <= limit) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

function recentWeekEnds(n) {
  const out = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const e = new Date(d);
    e.setDate(e.getDate() - i * 7);
    out.push(e.toISOString().slice(0, 10));
  }
  return out;
}

function attRate(memberId, attendance, upTo) {
  const recs = attendance.filter((a) => a.group_member_id === memberId && (a.attendance_date || "") <= upTo);
  if (!recs.length) return 0;
  return Math.round((recs.filter((a) => a.status === "present").length / recs.length) * 100);
}
function participation(memberId, logs, upTo) {
  return logs
    .filter((l) => l.group_member_id === memberId && (l.created_date || "").slice(0, 10) <= upTo)
    .reduce((s, l) => s + (l.event_type === "behavior_penalty" ? -Math.abs(l.points_awarded || 0) : l.points_awarded || 0), 0);
}
function activityPct(memberId, scores, activities, upTo) {
  const actIds = new Set(activities.map((a) => a.id));
  const recs = scores.filter((s) => s.group_member_id === memberId && actIds.has(s.activity_id) && (s.created_date || "").slice(0, 10) <= upTo);
  if (!recs.length) return 0;
  let tot = 0, max = 0;
  for (const r of recs) { const a = activities.find((x) => x.id === r.activity_id); const m = a?.max_score || 10; tot += r.score; max += m; }
  return max ? Math.round((tot / max) * 100) : 0;
}
function categoryPct(memberId, assessments, cat, upTo) {
  const recs = assessments.filter((a) => a.group_member_id === memberId && a.category === cat && (a.created_date || "").slice(0, 10) <= upTo);
  if (!recs.length) return 0;
  let tot = 0, max = 0;
  for (const r of recs) { tot += r.score; max += r.max_score; }
  return max ? Math.round((tot / max) * 100) : 0;
}

// Fetches its own assessments + grading terms so a failure never blocks the
// rest of the student dashboard (which passes the already-loaded data below).
export default function TrendCharts({ classroomId, members, attendance, scores, activities, logs }) {
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
  const weeks = term ? weekEnds(term.start_date, term.end_date) : recentWeekEnds(8);
  if (weeks.length === 0) return null;

  const metrics = [
    { key: "attendance", label: "Attendance %", calc: (id, up) => attRate(id, attendance, up) },
    { key: "participation", label: "Participation Pts", calc: (id, up) => participation(id, logs, up) },
    { key: "activity", label: "Activity %", calc: (id, up) => activityPct(id, scores, activities, up) },
    { key: "quiz", label: "Quiz %", calc: (id, up) => categoryPct(id, assessments, "quiz", up) },
    { key: "exam", label: "Major Exam %", calc: (id, up) => categoryPct(id, assessments, "major_exam", up) },
    { key: "perf", label: "Performance Task %", calc: (id, up) => categoryPct(id, assessments, "performance_task", up) },
  ];

  const labelOf = (m) => `${m.first_name} ${m.last_name[0]}.`;

  const charts = metrics.map((metric) => ({
    ...metric,
    data: weeks.map((w) => {
      const row = { week: w.slice(5) };
      members.forEach((m) => { row[labelOf(m)] = metric.calc(m.id, w); });
      return row;
    }),
  }));

  return (
    <ClayCard className="p-4">
      <h2 className="font-display font-bold text-lg mb-1 flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Term Trends</h2>
      <p className="text-xs text-ink/60 mb-3">{term ? `${term.term_label} · ` : ""}cumulative progress by week for each group member</p>
      <div className="grid sm:grid-cols-2 gap-4">
        {charts.map((c) => (
          <div key={c.key} className="rounded-xl border-2 border-ink/15 bg-cream/40 p-2">
            <p className="font-display font-bold text-xs mb-1">{c.label}</p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={c.data} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#17162B22" />
                <XAxis dataKey="week" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} />
                <Tooltip />
                {members.map((m, i) => (
                  <Line key={m.id} type="monotone" dataKey={labelOf(m)} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </ClayCard>
  );
}

