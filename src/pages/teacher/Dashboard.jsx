
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getTeacherClassrooms, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import { computeClassification } from "@/lib/classification";
import {
  computeAttendanceRate, computeActivityPct, computeParticipationPoints, computeCategoryPct, signedPoints,
} from "@/lib/stats";
import { Printer, BarChart3, Award, Download, CheckCircle2 } from "lucide-react";
import { getWeekStartManila, getTodayManila } from "@/lib/week";
import { hasClassDays, isScheduledClassDay } from "@/lib/classDays";
import AtRiskAlerts from "@/components/teacher/AtRiskAlerts";
import PendingApprovalBulk from "@/components/teacher/PendingApprovalBulk";
import BehaviorPenalty from "@/components/teacher/BehaviorPenalty";
import DashboardRangeTabs from "@/components/DashboardRangeTabs";
import NovaHero from "@/components/mascot/NovaHero";
import { UIAsset } from "@/components/visual/UIAsset";
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
  const [chartRange, setChartRange] = useState("week");
  const [expandedAttentionClass, setExpandedAttentionClass] = useState(null);
  const [attentionLoading, setAttentionLoading] = useState(true);

  const refresh = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      setAttentionLoading(true);
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
      const [ds, teacherClasses, badgeDefinitions] = await Promise.all([
        getClassroomDataset(classroom.id, ['groups','members','settings','terms','attendance','scores','activities','assessments','logs','groupAccounts','badges']),
        getTeacherClassrooms(user.id),
        db.entities.BadgeDefinition.filter({ classroom_id: classroom.id }),
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

      const groupActivity = groups.map((g) => {
        const gm = members.filter((m) => m.group_id === g.id);
        const breakdown = gm.map((member) => ({ name: memberNames[member.id], rate: Math.round(computeActivityPct(member.id, scores, activities).pct) }));
        const avg = breakdown.length > 0 ? breakdown.reduce((sum, member) => sum + member.rate, 0) / breakdown.length : 0;
        return { name: `G${g.group_number}`, avg: Math.round(avg), breakdown };
      });

      const penaltyLogs = logs
        .filter((l) => l.event_type === "behavior_penalty")
        .sort((a, b) => (b.created_date || "").localeCompare(a.created_date || ""))
        .slice(0, 6)
        .map((l) => ({ ...l, groupNumber: groups.find((g) => g.id === l.group_id)?.group_number }));

      if (!active) return;
      setPending(pendingAccounts);
      setData({ classroom, term, weights, memberRows, groupRows, trend, groupActivity, groups, attendance, scores, activities, logs, badges: ds.badges || [], badgeDefinitions, penaltyLogs, attentionByClass: [] });
      setLoading(false);

      Promise.all(teacherClasses.map(async (item) => {
        const source = item.id === classroom.id ? ds : await getClassroomDataset(item.id, ['members', 'attendance', 'groupAccounts']);
        const isClassToday = !hasClassDays(item.class_days) || isScheduledClassDay(new Date(`${getTodayManila()}T00:00:00Z`), item.class_days);
        const todayAttendance = source.attendance.filter((record) => record.attendance_date === getTodayManila());
        const attendanceByMember = Object.fromEntries(todayAttendance.map((record) => [record.group_member_id, record]));
        const needsAttendance = (isClassToday ? source.members : []).filter((member) => attendanceByMember[member.id]?.status !== 'present').map((member) => ({
          id: member.id,
          name: `${member.last_name}, ${member.first_name}`,
          status: attendanceByMember[member.id]?.status === 'absent' ? 'Absent' : 'No record',
        }));
        return { classroom: item, missingToday: needsAttendance.length, awaitingApproval: source.groupAccounts.filter((account) => !account.is_approved).length, needsAttendance, isClassToday };
      })).then((attentionByClass) => {
        if (!active) return;
        setData((current) => current && ({ ...current, attentionByClass }));
        setAttentionLoading(false);
      }).catch((error) => {
        console.warn("Cross-class attendance summary could not be loaded", error);
        if (active) setAttentionLoading(false);
      });
    }
    load().catch((error) => {
      console.error("Teacher dashboard could not be loaded", error);
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [user, reloadKey, navigate]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  if (!data) return null;

  const { classroom, term, memberRows, groupRows, trend, groupActivity, groups, attendance, scores, activities, logs, badges, badgeDefinitions, penaltyLogs, attentionByClass } = data;
  const onTrack = memberRows.filter((r) => r.cls.tag === "On Track").length;
  const developing = memberRows.filter((r) => r.cls.tag === "Developing").length;
  const atRisk = memberRows.filter((r) => r.cls.tag === "At Risk").length;
  const filteredRows = (filter === "all" ? memberRows : memberRows.filter((r) => r.cls.tag === filter))
    .slice().sort((a, b) => `${a.member.last_name || ''} ${a.member.first_name || ''}`.localeCompare(`${b.member.last_name || ''} ${b.member.first_name || ''}`));
  const todayStr = getTodayManila();
  const monthStart = new Date(`${todayStr}T00:00:00Z`);
  monthStart.setUTCDate(monthStart.getUTCDate() - 29);
  const visibleTrend = chartRange === "term" ? trend : trend.filter((item) => item.date >= (chartRange === "month" ? monthStart.toISOString().slice(0, 10) : getWeekStartManila()));
  const attendanceRate = attendance.length ? Math.round((attendance.filter((record) => record.status === "present").length / attendance.length) * 100) : 0;
  const activityAverage = groupActivity.length ? Math.round(groupActivity.reduce((sum, item) => sum + item.avg, 0) / groupActivity.length) : 0;
  const classProgress = Math.round((attendanceRate + activityAverage) / (attendanceRate > 0 || activityAverage > 0 ? 2 : 1)) || 0;
  const scoredActivityIds = new Set(scores.map((s) => s.activity_id));
  const toGradeCount = activities.filter((a) => !scoredActivityIds.has(a.id)).length;
  const classParticipation = visibleTrend.map((item) => ({ label: item.date?.slice(5) || "—", value: item.present || 0 }));
  const recentAchievements = logs.slice().sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")).slice(0, 3);
  const learningAreas = [
    { label: "Attendance", value: attendanceRate, color: "bg-clay-sky" },
    { label: "Activities", value: activityAverage, color: "bg-clay-lime" },
    { label: "Participation", value: memberRows.length ? Math.round((onTrack / memberRows.length) * 100) : 0, color: "bg-clay-purple" },
  ];

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

      <NovaHero
        variant="welcome"
        title="Your class is making progress!"
        subtitle={`Here's a quick snapshot of participation, attendance, and learning progress for ${classroom.section}.`}
        greeting="Hi, Teacher!"
        greetingSubtext="Here's what needs your attention today."
        className="no-print"
      />

      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <DashboardRangeTabs value={chartRange} onChange={setChartRange} />
        <span className="text-xs text-ink/60">Charts update for the selected period.</span>
      </div>

      <div className="flex flex-wrap gap-3 no-print">
        <ClayChip color="lime">On Track: {onTrack}</ClayChip>
        <ClayChip color="sun">Developing: {developing}</ClayChip>
        <ClayChip color="coral">At Risk: {atRisk}</ClayChip>
      </div>

      <section className="no-print">
        <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
          <ClayCard className="p-3">
            <div className="text-2xl font-mono font-extrabold text-clay-sky">{attendanceRate}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Attendance</p>
          </ClayCard>
          <ClayCard className="p-3">
            <div className="text-2xl font-mono font-extrabold text-clay-purple">{toGradeCount}</div>
            <p className="text-xs font-display font-bold text-ink/60">To Grade</p>
          </ClayCard>
          <ClayCard className="p-3">
            <div className="text-2xl font-mono font-extrabold text-clay-lime">{classProgress}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Class Progress</p>
          </ClayCard>
        </div>
      </section>

      <section className="grid gap-4 no-print lg:grid-cols-[1.1fr_.9fr]">
        <ClayCard className="p-4">
          <h3 className="font-display text-sm font-bold text-ink/60 mb-4">Today's classes</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-2 rounded-xl hover:bg-clay-purple/5 transition-colors">
              <div>
                <p className="font-display font-bold">{classroom.grade_level} · {classroom.section}</p>
                <p className="text-xs text-ink/55">{classroom.subject || "Homeroom"} · {groups.length} groups</p>
              </div>
              <Link to={ROUTES.TEACHER.ROSTER} className="text-xs font-display font-bold text-clay-purple">Open →</Link>
            </div>
          </div>
        </ClayCard>
        <ClayCard className="p-4">
          <h3 className="font-display text-sm font-bold text-ink/60 mb-4">Needs attention</h3>
          <ul className="space-y-3 text-sm">
            {atRisk > 0 && <li className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-clay-coral" />{atRisk} learner{atRisk === 1 ? "" : "s"} need{atRisk === 1 ? "s" : ""} support</span></li>}
            {pending.length > 0 && <li className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-clay-sun" />{pending.length} pending account{pending.length === 1 ? "" : "s"} awaiting approval</span></li>}
            {memberRows.filter((r) => r.att.rate < 60).length > 0 && <li className="flex items-center justify-between"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-clay-sky" />{memberRows.filter((r) => r.att.rate < 60).length} student{memberRows.filter((r) => r.att.rate < 60).length === 1 ? "" : "s"} with low attendance</span></li>}
            {atRisk === 0 && pending.length === 0 && memberRows.filter((r) => r.att.rate < 60).length === 0 && <li className="text-ink/60">All caught up! No urgent items.</li>}
          </ul>
        </ClayCard>
      </section>

      <section className="grid gap-4 no-print sm:grid-cols-2 lg:grid-cols-3">
        <ClayCard className="p-4"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-clay-purple/12"><UIAsset name="students" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Class participation</h3><p className="text-xs text-ink/60">Active learners each day</p></div></div><div className="mt-5 flex h-24 items-end justify-around gap-2">{classParticipation.length ? classParticipation.map((item, index) => <div key={`${item.label}-${index}`} className="flex h-full flex-1 flex-col justify-end"><div className="min-h-2 rounded-t-xl" style={{ height: `${Math.max(12, Math.min(100, (item.value / Math.max(...classParticipation.map((entry) => entry.value), 1)) * 100))}%`, backgroundColor: ["#8E5CF6", "#F34A9B", "#32A9ED", "#84D92C"][index % 4] }} /><span className="mt-2 text-center text-[10px] font-display text-ink/60">{item.label}</span></div>) : <p className="m-auto text-sm text-ink/50">No attendance yet.</p>}</div></ClayCard>
        <ClayCard className="p-4"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-clay-sky/15"><UIAsset name="attendance" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Attendance</h3><p className="text-xs text-ink/60">Students present</p></div></div><div className="mx-auto mt-4 flex h-32 w-32 items-center justify-center rounded-full" style={{ background: `conic-gradient(#32A9ED ${attendanceRate}%, #E8EDF5 0)` }}><div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white"><strong className="font-mono text-3xl">{attendanceRate}%</strong><span className="text-xs text-ink/60">present</span></div></div></ClayCard>
        <ClayCard className="p-4 sm:col-span-2 lg:col-span-1"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-clay-pink/12"><UIAsset name="assessment" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Activity completion</h3><p className="text-xs text-ink/60">Average by group</p></div></div><div className="mt-5 flex h-24 items-end justify-around gap-3">{groupActivity.map((item, index) => <div key={item.name} className="flex h-full flex-1 flex-col justify-end"><div className="min-h-2 rounded-t-xl bg-clay-lime" style={{ height: `${Math.max(12, item.avg)}%`, backgroundColor: ["#8E5CF6", "#F34A9B", "#32A9ED", "#84D92C"][index % 4] }} /><span className="mt-2 text-center text-[10px] font-display text-ink/60">{item.name}</span></div>)}</div></ClayCard>
      </section>

      <section className="grid gap-4 no-print lg:grid-cols-[1.05fr_.95fr]">
        <ClayCard tone="blue" className="p-4 sm:p-5"><div className="flex items-center gap-2"><div className="rounded-2xl bg-clay-sky/25 p-2 text-clay-sky"><BarChart3 className="h-5 w-5" /></div><div><h3 className="font-display text-lg font-extrabold">Learning progress</h3><p className="text-xs text-ink/60">Average mastery by classroom signal</p></div></div><div className="mt-5 space-y-4">{learningAreas.map((area) => <div key={area.label}><div className="mb-1 flex justify-between text-sm font-display font-bold"><span>{area.label}</span><span>{area.value}%</span></div><div className="h-4 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${area.color}`} style={{ width: `${area.value}%` }} /></div></div>)}</div></ClayCard>
        <ClayCard tone="pink" className="p-4 sm:p-5"><div className="flex items-center gap-2"><div className="rounded-2xl bg-clay-pink/25 p-2 text-clay-pink"><Award className="h-5 w-5" /></div><div><h3 className="font-display text-lg font-extrabold">Recent achievements</h3><p className="text-xs text-ink/60">Latest points and milestones</p></div></div><div className="mt-4 space-y-3">{recentAchievements.length ? recentAchievements.map((entry) => { const shown = signedPoints(entry); return <div key={entry.id} className="flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-clay-lime/25 text-clay-lime"><CheckCircle2 className="h-4 w-4" /></span><p className="min-w-0 flex-1 truncate text-sm font-display font-bold">{entry.note || entry.event_type?.replaceAll("_", " ") || "Participation recorded"}</p><span className="text-xs font-mono text-ink/60">{shown > 0 ? `+${shown}` : shown}</span></div>; }) : <p className="py-4 text-sm text-ink/50">Achievements will appear as students participate.</p>}</div></ClayCard>
      </section>

      <AtRiskAlerts memberRows={memberRows} />

      <ClayCard className="p-4 no-print">
        <h2 className="font-display font-bold text-lg mb-3">Needs attention by class</h2>
        <p className="mb-2 text-xs text-ink/60">Select a class to see which students need attendance follow-up.</p>
        {attentionLoading && <p role="status" className="mb-2 text-xs text-ink/50">Checking attendance in your classes…</p>}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{attentionByClass.map((item) => {
          const expanded = expandedAttentionClass === item.classroom.id;
          return <div key={item.classroom.id} className="rounded-xl border-2 border-ink/15 bg-cream p-3"><button type="button" onClick={() => setExpandedAttentionClass(expanded ? null : item.classroom.id)} aria-expanded={expanded} className="w-full text-left"><div className="flex items-start justify-between gap-2"><div><p className="font-display font-bold text-sm">{item.classroom.grade_level} · {item.classroom.section}</p><p className="mt-1 text-xs text-ink/65">{item.isClassToday ? `${item.missingToday} without a present record today` : 'No class scheduled today'} · {item.awaitingApproval} awaiting approval</p></div><span className="text-lg leading-none text-clay-purple">{expanded ? '−' : '+'}</span></div>{item.missingToday === 0 && item.awaitingApproval === 0 && <p className="mt-1 text-xs font-display font-bold text-clay-lime">{item.isClassToday ? 'All clear' : 'Attendance paused'}</p>}</button>{expanded && <div className="mt-3 border-t-2 border-ink/10 pt-2"><p className="text-xs font-display font-bold">Attendance follow-up ({item.needsAttendance.length})</p>{item.needsAttendance.length ? <div className="mt-2 space-y-1.5">{item.needsAttendance.map((student) => <div key={student.id} className="flex items-center justify-between gap-2 text-xs"><span className="truncate font-display font-bold">{student.name}</span><ClayChip color={student.status === 'Absent' ? 'coral' : 'sun'}>{student.status}</ClayChip></div>)}</div> : <p className="mt-1 text-xs text-clay-lime">{item.isClassToday ? 'Everyone is marked present today.' : 'This class does not meet today.'}</p>}</div>}</div>;
        })}</div>
      </ClayCard>

      {pending.length > 0 && (
        <PendingApprovalBulk pending={pending} groups={groups} onApproveAll={approveAll} onApproveOne={approveOne} />
      )}

      <ClayCard className="no-print p-4 text-center">
        <p className="font-display font-bold">Detailed charts are in Analytics</p>
        <p className="mt-1 text-xs text-ink/60">The dashboard now stays focused on daily actions and students who need support.</p>
        <Link to={ROUTES.TEACHER.ANALYTICS} className="mt-3 inline-flex text-sm font-display font-bold text-clay-purple underline">Open analytics</Link>
      </ClayCard>

      <BehaviorPenalty classroom={classroom} groups={groups} onPenalty={applyPenalty} penaltyLogs={penaltyLogs} />

      <ClayCard className="p-4">
        <h2 className="font-display font-bold text-lg mb-3">Group Classifications</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {groupRows.map((r) => (
            <div key={r.group.id} className="clay-tile p-3 text-center">
              <p className="inline-flex items-center justify-center gap-1 font-display font-bold">Group {r.group.group_number} <GroupBadgeMarkers groupId={r.group.id} badges={badges} definitions={badgeDefinitions} /></p>
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
                  <td className="py-2 px-2"><span className="inline-flex items-center gap-1">{r.group?.group_number}<GroupBadgeMarkers groupId={r.group?.id} badges={badges} definitions={badgeDefinitions} /></span></td>
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
