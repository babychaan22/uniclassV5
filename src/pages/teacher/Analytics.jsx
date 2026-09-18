
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset } from "@/lib/teacherClassroom";

import ClayCard from "@/components/ClayCard";
import { BarChart3, TrendingUp } from "lucide-react";
import { ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
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

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><BarChart3 className="w-6 h-6" /> Teacher Analytics</h1>
        <p className="text-ink/60 text-sm">Attendance and participation trends across all groups this term.</p>
      </div>

      <ClayCard className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display font-bold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Attendance rate</h2><select aria-label="Analytics date range" className="clay-input w-auto py-1 text-xs" value={range} onChange={(event) => setRange(event.target.value)}><option value="4">4 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option><option value="all">All</option></select></div>
        {visibleAttendance.length === 0 ? (
          <p className="text-ink/50 text-sm text-center py-6">No attendance recorded yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={visibleAttendance} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#0001" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="rate" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ClayCard>

      <ClayCard className="p-4">
        <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Participation Points by Group</h2>
        {groupPoints.every((g) => g.points === 0) ? (
          <p className="text-ink/50 text-sm text-center py-6">No participation points logged yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={groupPoints} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#0001" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="points" fill="#A6E22E" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ClayCard>
    </div>
  );
}
