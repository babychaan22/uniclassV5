
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getTeacherClassrooms, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { computeClassification } from "@/lib/classification";
import {
  computeAttendanceRate, computeActivityPct, computeParticipationPoints, computeCategoryPct,
} from "@/lib/stats";
import { Printer, TrendingUp, BarChart3, Award, Download } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid,
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
  const [chartRange, setChartRange] = useState("14");
  const [expandedAttentionClass, setExpandedAttentionClass] = useState(null);
  const [hoveredChart, setHoveredChart] = useState({ attendance: null, activity: null, participation: null });

  const refresh = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
      const [ds, teacherClasses] = await Promise.all([
        getClassroomDataset(classroom.id, ['groups','members','settings','terms','attendance','scores','activities','assessments','logs','groupAccounts']),
        getTeacherClassrooms(user.id),
      ]);
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

      const memberNames = Object.fromEntries(members.map((member) => [member.id, `${member.last_name}, ${member.first_name}`]));
      const dateMap = {};
      for (const a of attendance) {
        if (!dateMap[a.attendance_date]) dateMap[a.attendance_date] = { date: a.attendance_date, present: 0, absent: 0, presentNames: [], absentNames: [] };
        if (a.status === "present") { dateMap[a.attendance_date].present++; dateMap[a.attendance_date].presentNames.push(memberNames[a.group_member_id] || 'Student'); }
        else { dateMap[a.attendance_date].absent++; dateMap[a.attendance_date].absentNames.push(memberNames[a.group_member_id] || 'Student'); }
      }
      const trend = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

      const pointSets = classroom.uses_groups ? groups.map((group) => ({ id: group.id, name: `Group ${group.group_number}`, members: members.filter((member) => member.group_id === group.id) })) : [{ id: 'class', name: 'Whole class', members }];
      const groupPoints = pointSets.map((set) => {
        const setLogs = classroom.uses_groups ? logs.filter((log) => log.group_id === set.id) : logs;
        const breakdown = set.members.map((member) => ({ name: memberNames[member.id], points: setLogs.filter((log) => log.group_member_id === member.id).reduce((sum, log) => sum + (Number(log.points_awarded) || 0), 0) })).filter((item) => item.points !== 0).sort((a, b) => b.points - a.points);
        const wholeGroup = setLogs.filter((log) => !log.group_member_id).reduce((sum, log) => sum + (Number(log.points_awarded) || 0), 0);
        return { name: set.name, points: setLogs.reduce((sum, log) => sum + (Number(log.points_awarded) || 0), 0), breakdown, wholeGroup };
      });

      const groupActivity = groups.map((g) => {
        const gm = members.filter((m) => m.group_id === g.id);
        const breakdown = gm.map((member) => ({ name: memberNames[member.id], rate: Math.round(computeActivityPct(member.id, scores, activities).pct) }));
        const avg = breakdown.length > 0 ? breakdown.reduce((sum, member) => sum + member.rate, 0) / breakdown.length : 0;
        return { name: `G${g.group_number}`, avg: Math.round(avg), breakdown };
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

      const attentionByClass = await Promise.all(teacherClasses.map(async (item) => {
        const source = item.id === classroom.id ? ds : await getClassroomDataset(item.id, ['members', 'attendance', 'groupAccounts']);
        const todayAttendance = source.attendance.filter((record) => record.attendance_date === getTodayManila());
        const attendanceByMember = Object.fromEntries(todayAttendance.map((record) => [record.group_member_id, record]));
        const needsAttendance = source.members.filter((member) => attendanceByMember[member.id]?.status !== 'present').map((member) => ({
          id: member.id,
          name: `${member.last_name}, ${member.first_name}`,
          status: attendanceByMember[member.id]?.status === 'absent' ? 'Absent' : 'No record',
        }));
        return { classroom: item, missingToday: needsAttendance.length, awaitingApproval: source.groupAccounts.filter((account) => !account.is_approved).length, needsAttendance };
      }));
      setPending(pendingAccounts);
      setData({ classroom, term, weights, memberRows, groupRows, trend, groupPoints, groupActivity, weeklyPoints, groups, attendance, scores, activities, penaltyLogs, attentionByClass });
      setLoading(false);
    }
    load();
  }, [user, reloadKey, navigate]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  if (!data) return null;

  const { classroom, term, memberRows, groupRows, trend, groupPoints, groupActivity, weeklyPoints, groups, attendance, scores, activities, penaltyLogs, attentionByClass } = data;
  const onTrack = memberRows.filter((r) => r.cls.tag === "On Track").length;
  const developing = memberRows.filter((r) => r.cls.tag === "Developing").length;
  const atRisk = memberRows.filter((r) => r.cls.tag === "At Risk").length;
  const filteredRows = (filter === "all" ? memberRows : memberRows.filter((r) => r.cls.tag === filter))
    .slice().sort((a, b) => `${a.member.last_name || ''} ${a.member.first_name || ''}`.localeCompare(`${b.member.last_name || ''} ${b.member.first_name || ''}`));
  const visibleTrend = chartRange === 'all' ? trend : trend.slice(-Number(chartRange));
  const todayStr = getTodayManila();
  const selectChartBar = (key) => (state) => {
    const selected = state?.activePayload?.[0]?.payload;
    if (!selected) return;
    setHoveredChart((current) => ({ ...current, [key]: current[key] === selected ? null : selected }));
  };

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

      <ClayCard className="p-4 no-print">
        <h2 className="font-display font-bold text-lg mb-3">Needs attention by class</h2>
        <p className="mb-2 text-xs text-ink/60">Select a class to see which students need attendance follow-up.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{attentionByClass.map((item) => {
          const expanded = expandedAttentionClass === item.classroom.id;
          return <div key={item.classroom.id} className="rounded-xl border-2 border-ink/15 bg-cream p-3"><button type="button" onClick={() => setExpandedAttentionClass(expanded ? null : item.classroom.id)} aria-expanded={expanded} className="w-full text-left"><div className="flex items-start justify-between gap-2"><div><p className="font-display font-bold text-sm">{item.classroom.grade_level} · {item.classroom.section}</p><p className="mt-1 text-xs text-ink/65">{item.missingToday} without a present record today · {item.awaitingApproval} awaiting approval</p></div><span className="text-lg leading-none text-clay-purple">{expanded ? '−' : '+'}</span></div>{item.missingToday === 0 && item.awaitingApproval === 0 && <p className="mt-1 text-xs font-display font-bold text-clay-lime">All clear</p>}</button>{expanded && <div className="mt-3 border-t-2 border-ink/10 pt-2"><p className="text-xs font-display font-bold">Attendance follow-up ({item.needsAttendance.length})</p>{item.needsAttendance.length ? <div className="mt-2 space-y-1.5">{item.needsAttendance.map((student) => <div key={student.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-display font-bold">{student.name}</span><ClayChip color={student.status === 'Absent' ? 'coral' : 'sun'}>{student.status}</ClayChip></div>)}</div> : <p className="mt-1 text-xs text-clay-lime">Everyone is marked present today.</p>}</div>}</div>;
        })}</div>
      </ClayCard>

      {pending.length > 0 && (
        <PendingApprovalBulk pending={pending} groups={groups} onApproveAll={approveAll} onApproveOne={approveOne} />
      )}

      <div className="grid lg:grid-cols-2 gap-4 no-print">
        <ClayCard className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-display font-bold text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Attendance</h2><select aria-label="Attendance chart date range" className="clay-input w-auto py-1 text-xs" value={chartRange} onChange={(event) => setChartRange(event.target.value)}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="all">All</option></select></div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={visibleTrend} margin={{ top: 4, right: 4, left: -22, bottom: 0 }} onClick={selectChartBar('attendance')} style={{ cursor: 'pointer' }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip content={() => null} cursor={{ fill: '#A6E22E1A' }} />
              <Bar dataKey="present" fill="#A6E22E" radius={[3, 3, 0, 0]} />
              <Bar dataKey="absent" fill="#FF6B57" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <DashboardChartDetail title="Attendance" entry={hoveredChart.attendance}><div className="grid grid-cols-2 gap-3"><div><p className="font-display font-bold text-clay-lime">Present ({hoveredChart.attendance?.present || 0})</p><CompactList entries={hoveredChart.attendance?.presentNames} /></div><div><p className="font-display font-bold text-clay-coral">Absent ({hoveredChart.attendance?.absent || 0})</p><CompactList entries={hoveredChart.attendance?.absentNames} /></div></div></DashboardChartDetail>
        </ClayCard>

        <ClayCard className="p-4">
          <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Group Activity Avg</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={groupActivity} onClick={selectChartBar('activity')} style={{ cursor: 'pointer' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#17162B22" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip content={() => null} cursor={{ fill: '#8B5CF61A' }} />
              <Bar dataKey="avg" fill="#8B5CF6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <DashboardChartDetail title="Activity scores" entry={hoveredChart.activity}>{hoveredChart.activity?.breakdown?.length ? <div className="space-y-0.5">{hoveredChart.activity.breakdown.map((member) => <p key={member.name} className="flex justify-between gap-3"><span className="truncate">{member.name}</span><span className="font-mono">{member.rate}%</span></p>)}</div> : <p>No activity scores yet.</p>}</DashboardChartDetail>
        </ClayCard>

        <ClayCard className="p-4 lg:col-span-2">
          <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><Award className="w-4 h-4" /> Participation Points by Group</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={groupPoints} onClick={selectChartBar('participation')} style={{ cursor: 'pointer' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#17162B22" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip content={() => null} cursor={{ fill: '#4FD1F21A' }} />
              <Bar dataKey="points" fill="#FF5FA8" radius={[6, 6, 0, 0]}>
                {groupPoints.map((_, i) => <Cell key={i} fill="#4FD1F2" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <DashboardChartDetail title="Participation points" entry={hoveredChart.participation}><p className="font-display font-bold">Whole Group: {hoveredChart.participation?.wholeGroup || 0} points</p>{hoveredChart.participation?.breakdown?.length ? <div className="mt-1 space-y-0.5">{hoveredChart.participation.breakdown.map((member) => <p key={member.name} className="flex justify-between gap-3"><span className="truncate">{member.name}</span><span className="font-mono">{member.points}</span></p>)}</div> : <p className="mt-1">No individual point entries.</p>}<p className="mt-2 border-t border-ink/10 pt-1 font-display font-extrabold">Group total: {hoveredChart.participation?.points || 0} points</p></DashboardChartDetail>
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

function DashboardChartDetail({ title, entry, children }) {
  return <div className="mt-2 min-h-14 rounded-xl border-2 border-ink/10 bg-cream px-3 py-2 text-xs" aria-live="polite">{entry ? <><p className="font-display font-bold">{title}: {entry.name || entry.date}</p><div className="mt-1 max-h-24 overflow-y-auto pr-1 text-ink/75">{children}</div></> : <p className="text-ink/55">Select a bar to see its compact breakdown.</p>}</div>;
}

function CompactList({ entries = [] }) {
  return entries.length ? <div className="max-h-20 overflow-y-auto pr-1 text-ink/75">{entries.map((entry, index) => <p key={`${entry}-${index}`} className="truncate">{entry}</p>)}</div> : <p className="text-ink/55">None</p>;
}
