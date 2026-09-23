
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset } from "@/lib/teacherClassroom";

import ClayCard from "@/components/ClayCard";
import NovaMessage from "@/components/NovaMessage";
import { UIAsset } from "@/components/visual/UIAsset";
import { ResponsiveContainer, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from "recharts";
import { ROUTES } from '@/lib/routes';

function weekKey(d) {
  const date = new Date(d + "T00:00:00");
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

export default function TeacherAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [attendanceTrend, setAttendanceTrend] = useState([]);
  const [groupPoints, setGroupPoints] = useState([]);
  const [range, setRange] = useState('8');

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const ds = await getClassroomDataset(c.id, ['groups','attendance','logs']);
    const { attendance, logs, groups } = ds;

    const byWeek = {};
    for (const a of attendance) {
      const k = weekKey(a.attendance_date);
      if (!byWeek[k]) byWeek[k] = { week: k, present: 0, total: 0 };
      byWeek[k].total += 1;
      if (a.status === "present") byWeek[k].present += 1;
    }
    const weeks = Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week));
    setAttendanceTrend(weeks.map((w) => ({ week: w.week.slice(5), rate: w.total ? Math.round((w.present / w.total) * 100) : 0 })));

    const pts = Object.fromEntries(groups.map((g) => [g.id, 0]));
    for (const l of logs) {
      const delta = l.event_type === "behavior_penalty" ? -Math.abs(l.points_awarded || 0) : (l.points_awarded || 0);
      pts[l.group_id] = (pts[l.group_id] || 0) + delta;
    }
    setGroupPoints(groups.sort((a, b) => a.group_number - b.group_number).map((g) => ({ name: `G${g.group_number}`, points: Math.round(pts[g.id] || 0) })));
    setLoading(false);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  const visibleAttendance = range === 'all' ? attendanceTrend : attendanceTrend.slice(-Number(range));
  const currentAttendance = visibleAttendance.at(-1)?.rate || 0;
  const leadingGroup = groupPoints.slice().sort((a, b) => b.points - a.points)[0];

  return (
    <div className="space-y-6">
      <section className="grid items-center gap-4 lg:grid-cols-[1fr_.9fr]">
        <div>
          <p className="mb-2 text-sm font-display font-bold text-clay-purple">Classroom insights</p>
          <h1 className="uc-page-title text-4xl leading-[.92] sm:text-5xl">See the progress behind every class day.</h1>
          <p className="mt-3 max-w-xl text-sm text-ink/60 sm:text-base">A clear view of attendance and participation across your selected class.</p>
        </div>
        <NovaMessage variant="teacher" tone="blue" title="The story in your data">
          Use the date selector to spot progress early and celebrate the wins that matter.
        </NovaMessage>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <ClayCard className="p-4"><p className="text-xs font-display font-bold text-ink/55">Latest attendance</p><p className="mt-1 font-mono text-3xl font-extrabold text-clay-sky">{currentAttendance}%</p><p className="mt-1 text-xs text-ink/55">for the most recent recorded week</p></ClayCard>
        <ClayCard className="p-4"><p className="text-xs font-display font-bold text-ink/55">Participation leader</p><p className="mt-1 font-display text-2xl font-extrabold text-clay-purple">{leadingGroup?.name || "—"}</p><p className="mt-1 text-xs text-ink/55">{leadingGroup ? `${leadingGroup.points} points earned` : "No points recorded yet"}</p></ClayCard>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
      <ClayCard className="p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="uc-icon-tile bg-clay-sky/15"><UIAsset name="attendance" className="h-10 w-10" /></span><div><h2 className="font-display font-bold text-lg">Attendance rate</h2><p className="text-xs text-ink/55">Weekly student presence</p></div></div><select aria-label="Analytics date range" className="clay-input w-auto min-h-9 py-1 text-xs" value={range} onChange={(event) => setRange(event.target.value)}><option value="4">4 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option><option value="all">All</option></select></div>
        {visibleAttendance.length === 0 ? (
          <p className="text-ink/50 text-sm text-center py-6">No attendance recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={visibleAttendance} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="rate" radius={[10, 10, 0, 0]}>{visibleAttendance.map((_, index) => <Cell key={index} fill={["#8E5CF6", "#F34A9B", "#32A9ED", "#84D92C"][index % 4]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ClayCard>

      <ClayCard className="p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3"><span className="uc-icon-tile bg-clay-lime/20"><UIAsset name="students" className="h-10 w-10" /></span><div><h2 className="font-display font-bold text-lg">Group participation</h2><p className="text-xs text-ink/55">Points earned by each group</p></div></div>
        {groupPoints.every((g) => g.points === 0) ? (
          <p className="text-ink/50 text-sm text-center py-6">No participation points logged yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={groupPoints} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="points" radius={[10, 10, 0, 0]}>{groupPoints.map((_, index) => <Cell key={index} fill={["#32A9ED", "#8E5CF6", "#F34A9B", "#84D92C"][index % 4]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ClayCard>
      </div>
    </div>
  );
}
