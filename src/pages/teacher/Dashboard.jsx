
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { computeClassification } from "@/lib/classification";
import {
  computeAttendanceRate, computeActivityPct, computeParticipationPoints, computeCategoryPct,
} from "@/lib/stats";
import { Printer, TrendingUp, BarChart3, Award, Download } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LineChart, Line, CartesianGrid,
} from "recharts";
import { getWeekStartManila, getTodayManila } from "@/lib/week";
import AtRiskAlerts from "@/components/teacher/AtRiskAlerts";
import PendingApprovalBulk from "@/components/teacher/PendingApprovalBulk";
import BehaviorPenalty from "@/components/teacher/BehaviorPenalty";
import WeeklyPointsChart from "@/components/teacher/WeeklyPointsChart";
import { downloadGroupPdf } from "@/lib/groupPdf";
import { ROUTES } from '@/lib/routes';

export default function TeacherDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState("all");

  const refresh = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
      const ds = await getClassroomDataset(classroom.id, ['groups','members','settings','terms','attendance','scores','activities','assessments','logs','groupAccounts']);
      const { groups, members, settings, terms, attendance, scores, activities, assessments, logs, groupAccounts } = ds;
      const pendingAccounts = groupAccounts.filter((a) => !a.is_approved);
      const term = terms.find((t) => t.is_active) || terms[0] || null;
      const weights = settings[0] || {};

      const pointsByMember = Object.fromEntries(members.map((member) => [member.id, computeParticipationPoints(member.id, logs)]));
      const maxPts = Math.max(...Object.values(pointsByMember), 1);
      const memberRows = members.map((m) => {
        const att = computeAttendanceRate(m.id, attendance, term);
        const act = computeActivityPct(m.id, scores, activities);
        const quiz = computeCategoryPct(m.id, assessments, "quiz", term);
        const exam = computeCategoryPct(m.id, assessments, "major_exam", term);
        const perf = computeCategoryPct(m.id, assessments, "performance_task", term);
        const pts = pointsByMember[m.id] || 0;
        const partNorm = (pts / maxPts) * 100;
        const categories = [
          { key: "attendance_rate", value: att.rate, count: att.count },
          { key: "activity_score_pct", value: act.pct, count: act.count },
          { key: "quiz_pct", value: quiz.pct, count: quiz.count },
          { key: "major_exam_pct", value: exam.pct, count: exam.count },
          { key: "performance_task_pct", value: perf.pct, count: perf.count },
          { key: "participation_normalized", value: partNorm, count: pts > 0 ? 1 : 0 },
        ];
        const cls = computeClassification(categories, weights);
        const group = groups.find((g) => g.id === m.group_id);
        return { member: m, group, att, act, quiz, exam, perf, pts, cls };
      });

      const groupRows = groups.map((g) => {
        const gm = memberRows.filter((r) => r.group?.id === g.id);
        const avgTotal = gm.length > 0 ? gm.reduce((s, r) => s + r.cls.total, 0) / gm.length : 0;
        const tag = avgTotal >= 80 ? "On Track" : avgTotal >= 60 ? "Developing" : "At Risk";
        const color = avgTotal >= 80 ? "lime" : avgTotal >= 60 ? "sun" : "coral";
        return { group: g, avgTotal, tag, color, memberCount: gm.length };
      });

      const dateMap = {};
      for (const a of attendance) {
        if (!dateMap[a.attendance_date]) dateMap[a.attendance_date] = { date: a.attendance_date, present: 0, absent: 0 };
        if (a.status === "present") dateMap[a.attendance_date].present++;
        else dateMap[a.attendance_date].absent++;
      }
      const trend = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

      const groupPoints = groups.map((g) => ({
        name: `G${g.group_number}`,
        points: logs.filter((l) => l.group_id === g.id).reduce((s, l) => s + (l.points_awarded || 0), 0),
      }));

      const groupActivity = groups.map((g) => {
        const gm = members.filter((m) => m.group_id === g.id);
        const avg = gm.length > 0 ? gm.reduce((s, m) => s + computeActivityPct(m.id, scores, activities).pct, 0) / gm.length : 0;
        return { name: `G${g.group_number}`, avg: Math.round(avg) };
      });

      const weekStarts = [];
      for (let w = 3; w >= 0; w--) {
        const d = new Date();
        d.setDate(d.getDate() - w * 7);
        weekStarts.push(getWeekStartManila(d));
      }
      const weeklyPoints = weekStarts.map((ws) => {
        const we = weekEndOf(ws);
        const entry = { week: ws.slice(5) };
        for (const g of groups) {
          entry[`G${g.group_number}`] = logs
            .filter((l) => l.group_id === g.id && (l.created_date || "").slice(0, 10) >= ws && (l.created_date || "").slice(0, 10) <= we)
            .reduce((s, l) => s + (l.points_awarded || 0), 0);
        }
        return entry;
      });

      const penaltyLogs = logs
        .filter((l) => l.event_type === "behavior_penalty")
        .sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""))
        .slice(0, 6)
        .map((l) => ({ ...l, groupNumber: groups.find((g) => g.id === l.group_id)?.group_number }));

      setPending(pendingAccounts);
      setData({ classroom, term, weights, memberRows, groupRows, trend, groupPoints, groupActivity, weeklyPoints, groups, attendance, scores, activities, penaltyLogs });
      setLoading(false);
    }
    load();
  }, [user, reloadKey, navigate]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  if (!data) return null;

  const { classroom, term, memberRows, groupRows, trend, groupPoints, groupActivity, weeklyPoints, groups, attendance, scores, activities, penaltyLogs } = data;
  const onTrack = memberRows.filter((r) => r.cls.tag === "On Track").length;
  const developing = memberRows.filter((r) => r.cls.tag === "Developing").length;
  const atRisk = memberRows.filter((r) => r.cls.tag === "At Risk").length;
  const filteredRows = filter === "all" ? memberRows : memberRows.filter((r) => r.cls.tag === filter);
  const todayStr = getTodayManila();

  async function applyPenalty(groupId, points, note) {
    await db.entities.ParticipationLog.create({
      group_id: groupId,
      classroom_id: classroom.id,
      points_awarded: Number(points),
      event_type: "behavior_penalty",
      multiplier: 1,
      note: note || undefined,
    });
    invalidateClassroomDataset();
    refresh();
  }

  async function approveAll(ids) {
    await db.entities.GroupAccount.bulkUpdate(ids.map((id) => ({ id, is_approved: true })));
    invalidateClassroomDataset();
    refresh();
  }

  async function approveOne(id) {
    await db.entities.GroupAccount.update(id, { is_approved: true });
    invalidateClassroomDataset();
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-2xl font-display font-extrabold">{classroom.grade_level} · {classroom.section}</h1>
          <p className="text-ink/60 text-sm">{term ? `${term.term_label} · ${term.start_date} → ${term.end_date}` : "No active term — set one in Settings"}</p>
        </div>
        <ClayButton color="sky" onClick={() => window.print()}>
          <Printer className="w-4 h-4" /> Print Report
        </ClayButton>
      </div>

      <div className="flex flex-wrap gap-3 no-print">
        <ClayChip color="lime">On Track: {onTrack}</ClayChip>
        <ClayChip color="sun">Developing: {developing}</ClayChip>
        <ClayChip color="coral">At Risk: {atRisk}</ClayChip>
      </div>

      <AtRiskAlerts memberRows={memberRows} />

      {pending.length > 0 && (
        <PendingApprovalBulk pending={pending} groups={groups} onApproveAll={approveAll} onApproveOne={approveOne} />
      )}

      <div className="grid lg:grid-cols-2 gap-4 no-print">
        <ClayCard className="p-4">
          <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Attendance Trend</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#17162B22" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line dataKey="present" stroke="#A6E22E" strokeWidth={2} />
              <Line dataKey="absent" stroke="#FF6B57" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ClayCard>

        <ClayCard className="p-4">
          <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Group Activity Avg</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={groupActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#17162B22" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip />
              <Bar dataKey="avg" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ClayCard>

        <ClayCard className="p-4 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><Award className="w-4 h-4" /> Participation Points by Group</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={groupPoints}>
              <CartesianGrid strokeDasharray="3 3" stroke="#17162B22" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="points" fill="#FF5FA8" radius={[6, 6, 0, 0]}>
                {groupPoints.map((_, i) => <Cell key={i} fill="#4FD1F2" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ClayCard>
      </div>

      <WeeklyPointsChart data={weeklyPoints} groups={groups} />

      <BehaviorPenalty classroom={classroom} groups={groups} onPenalty={applyPenalty} penaltyLogs={penaltyLogs} />

      <ClayCard className="p-4">
        <h2 className="font-display font-bold text-lg mb-3">Group Classifications</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {groupRows.map((r) => (
            <div key={r.group.id} className="clay-tile p-3 text-center">
              <p className="font-display font-bold">Group {r.group.group_number}</p>
              <p className="font-mono text-2xl font-bold">{Math.round(r.avgTotal)}%</p>
              <ClayChip color={r.color}>{r.tag}</ClayChip>
              <ClayButton size="sm" color="purple" className="mt-2 w-full"
                onClick={() => downloadGroupPdf({ classroom, term, todayStr, group: r.group, groupRow: r, memberRows: memberRows.filter((mr) => mr.group?.id === r.group.id), attendance, scores, activities })}>
                <Download className="w-4 h-4" /> PDF
              </ClayButton>
            </div>
          ))}
        </div>
      </ClayCard>

      <ClayCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-display font-bold text-lg">Student Classification Report</h2>
          <div className="flex flex-wrap gap-2">
            {["all", "At Risk", "Developing", "On Track"].map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`clay-chip px-3 py-1 text-sm ${filter === f ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}>
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-body">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th className="py-2 pr-3 font-display">Name</th>
                <th className="py-2 px-2 font-display">Group</th>
                <th className="py-2 px-2 font-mono">Attend%</th>
                <th className="py-2 px-2 font-mono">Activity%</th>
                <th className="py-2 px-2 font-mono">Quiz%</th>
                <th className="py-2 px-2 font-mono">Exam%</th>
                <th className="py-2 px-2 font-mono">Perf%</th>
                <th className="py-2 px-2 font-mono">Pts</th>
                <th className="py-2 px-2 font-mono">Total%</th>
                <th className="py-2 pl-2 font-display">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.member.id} className="border-b border-ink/10">
                  <td className="py-2 pr-3 font-display font-bold">{r.member.last_name}, {r.member.first_name}</td>
                  <td className="py-2 px-2">{r.group?.group_number}</td>
                  <td className="py-2 px-2 font-mono">{Math.round(r.att.rate)}</td>
                  <td className="py-2 px-2 font-mono">{Math.round(r.act.pct)}</td>
                  <td className="py-2 px-2 font-mono">{r.quiz.count ? Math.round(r.quiz.pct) : "—"}</td>
                  <td className="py-2 px-2 font-mono">{r.exam.count ? Math.round(r.exam.pct) : "—"}</td>
                  <td className="py-2 px-2 font-mono">{r.perf.count ? Math.round(r.perf.pct) : "—"}</td>
                  <td className="py-2 px-2 font-mono">{r.pts}</td>
                  <td className="py-2 px-2 font-mono font-bold">{r.cls.total}</td>
                  <td className="py-2 pl-2"><ClayChip color={r.cls.color}>{r.cls.tag}</ClayChip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ClayCard>
    </div>
  );
}

function weekEndOf(ws) {
  const d = new Date(ws + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}
