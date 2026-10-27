
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/supabaseClient";
import { ACTIVE_TEACHER_CLASSROOM_KEY, getTeacherClassroom, getTeacherClassrooms, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import { computeClassification } from "@/lib/classification";
import {
  computeAttendanceRate, computeActivityPct, computeParticipationPoints, computeCategoryPct, signedPoints,
} from "@/lib/stats";
import { Printer } from "lucide-react";
import { getWeekStartManila, getTodayManila } from "@/lib/week";
import { hasClassDays, isScheduledClassDay } from "@/lib/classDays";
import PendingApprovalBulk from "@/components/teacher/PendingApprovalBulk";
import DashboardRangeTabs from "@/components/DashboardRangeTabs";
import NovaHero from "@/components/mascot/NovaHero";
import { UIAsset } from "@/components/visual/UIAsset";
import { ROUTES } from '@/lib/routes';
import PanelSkeleton from "@/components/PanelSkeleton";

let teacherDashboardCache = null;
const TEACHER_DASHBOARD_CACHE_MS = 120_000;
const activityStatus = (rate) => rate >= 80 ? "On Track" : rate >= 60 ? "Developing" : "At Risk";
const ACTIVITY_STATUS_STYLE = {
  "On Track": "bg-[var(--uc-green-soft)] text-[#4d8c29]",
  Developing: "bg-[#FFF7DF] text-[#9A7012]",
  "At Risk": "bg-[#FFF0F3] text-[#B94B63]",
};
const membersWithoutRecord = (rows, recordedMemberIds) => rows.filter((row) => !recordedMemberIds.has(row.member.id));

export default function TeacherDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeClassroomId = typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_TEACHER_CLASSROOM_KEY) : null;
  const initialCache = activeClassroomId && teacherDashboardCache?.userId === user?.id && teacherDashboardCache.classroomId === activeClassroomId && Date.now() - teacherDashboardCache.savedAt < TEACHER_DASHBOARD_CACHE_MS ? teacherDashboardCache.data : null;
  const [data, setData] = useState(initialCache);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(!initialCache);
  const [filter, setFilter] = useState("all");
  const [chartRange, setChartRange] = useState("week");
  const [anchorDate, setAnchorDate] = useState(() => getTodayManila());
  const [expandedAttentionClass, setExpandedAttentionClass] = useState(null);
  const [attentionLoading, setAttentionLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      setAttentionLoading(true);
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
      const [ds, teacherClasses, badgeDefinitions, scoreEditsResult] = await Promise.all([
        getClassroomDataset(classroom.id, ['groups','members','settings','terms','attendance','scores','activities','assessments','logs','groupAccounts','badges','missions','submissions']),
        getTeacherClassrooms(user.id),
        db.entities.BadgeDefinition.filter({ classroom_id: classroom.id }),
        supabase.from('activity_score_edit_requests').select('*').eq('classroom_id', classroom.id).eq('status', 'pending'),
      ]);
      const { groups, members, settings, terms, attendance, scores, activities, assessments, logs, groupAccounts, missions, submissions } = ds;
      const pendingAccounts = groupAccounts.filter((a) => !a.is_approved && !a.transferred_at);
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
        const graded = gm.filter((r) => r.cls.total !== null);
        const avgTotal = graded.length > 0 ? graded.reduce((s, r) => s + r.cls.total, 0) / graded.length : null;
        const tag = avgTotal === null ? "Not enough data" : avgTotal >= 80 ? "On Track" : avgTotal >= 60 ? "Developing" : "At Risk";
        const color = avgTotal === null ? "sky" : avgTotal >= 80 ? "lime" : avgTotal >= 60 ? "sun" : "coral";
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
        const breakdown = gm.map((member) => ({ name: memberNames[member.id], lastName: member.last_name || member.first_name || "Student", rate: Math.round(computeActivityPct(member.id, scores, activities).pct) }));
        const avg = breakdown.length > 0 ? breakdown.reduce((sum, member) => sum + member.rate, 0) / breakdown.length : 0;
        const studentsByStatus = ["On Track", "Developing", "At Risk"].map((status) => ({ status, students: breakdown.filter((member) => activityStatus(member.rate) === status) }));
        return { name: `G${g.group_number}`, avg: Math.round(avg), breakdown, studentsByStatus };
      });

      if (!active) return;
      setPending(pendingAccounts);
      const snapshot = { classroom, term, weights, memberRows, groupRows, trend, groupActivity, groups, attendance, scores, activities, missions: missions || [], submissions: submissions || [], logs, badges: ds.badges || [], badgeDefinitions, scoreEdits: scoreEditsResult.data || [], attentionByClass: [] };
      teacherDashboardCache = { userId: user.id, classroomId: classroom.id, data: snapshot, savedAt: Date.now() };
      setData(snapshot);
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
        setData((current) => {
          const next = current && ({ ...current, attentionByClass });
          if (next) teacherDashboardCache = { userId: user.id, classroomId: classroom.id, data: next, savedAt: Date.now() };
          return next;
        });
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
    // A reconnect refreshes this dashboard in place. `load` deliberately does
    // not clear `data`, so the teacher keeps their current screen and scroll
    // position while the newer values arrive.
    const refreshInPlace = () => { load().catch((error) => console.warn("Teacher dashboard refresh failed", error)); };
    window.addEventListener('uniclass-connection-restored', refreshInPlace);
    return () => {
      active = false;
      window.removeEventListener('uniclass-connection-restored', refreshInPlace);
    };
  }, [user, navigate]);

  if (loading) return <PanelSkeleton cards={4} />;
  if (!data) return null;

  const { classroom, term, memberRows, trend, groups, attendance, scores, activities, missions = [], submissions = [], logs, badges, badgeDefinitions, scoreEdits = [], attentionByClass } = data;
  const members = memberRows.map((row) => row.member);
  const onTrack = memberRows.filter((r) => r.cls.tag === "On Track").length;
  const developing = memberRows.filter((r) => r.cls.tag === "Developing").length;
  const atRiskRows = memberRows.filter((r) => r.cls.tag === "At Risk")
    .sort((left, right) => (left.cls.total || 0) - (right.cls.total || 0));
  const atRisk = atRiskRows.length;
  const filteredRows = (filter === "all" ? memberRows : memberRows.filter((r) => r.cls.tag === filter))
    .slice().sort((a, b) => `${a.member.last_name || ''} ${a.member.first_name || ''}`.localeCompare(`${b.member.last_name || ''} ${b.member.first_name || ''}`));
  const todayStr = getTodayManila();
  const selectedDate = anchorDate || todayStr;
  const selectedMonth = new Date(`${selectedDate}T12:00:00Z`);
  const monthStart = new Date(Date.UTC(selectedMonth.getUTCFullYear(), selectedMonth.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(selectedMonth.getUTCFullYear(), selectedMonth.getUTCMonth() + 1, 0));
  const rangeStart = chartRange === "term" ? (term?.start_date || null) : chartRange === "month" ? monthStart.toISOString().slice(0, 10) : getWeekStartManila(new Date(`${selectedDate}T12:00:00+08:00`));
  const rangeEndDate = new Date(`${rangeStart || selectedDate}T00:00:00Z`);
  if (chartRange === "week") rangeEndDate.setUTCDate(rangeEndDate.getUTCDate() + 6);
  const rangeEnd = chartRange === "term" ? (term?.end_date || selectedDate) : chartRange === "month" ? monthEnd.toISOString().slice(0, 10) : rangeEndDate.toISOString().slice(0, 10);
  const rangeLabel = chartRange === "term" ? "this term" : chartRange === "month" ? "this month" : "this week";
  const isInRange = (value) => {
    const day = String(value || "").slice(0, 10);
    return !!day && (!rangeStart || day >= rangeStart) && (!rangeEnd || day <= rangeEnd);
  };
  const visibleTrend = trend.filter((item) => isInRange(item.date));
  const rangeAttendance = attendance.filter((record) => isInRange(record.attendance_date));
  const attendanceRate = rangeAttendance.length ? Math.round((rangeAttendance.filter((record) => record.status === "present").length / rangeAttendance.length) * 100) : 0;
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  // Older score records may not carry a timestamp. Keep those included rather
  // than hiding valid grades when the date selector is changed.
  const rangeScores = scores.filter((score) => isInRange(score.created_date) || (!score.created_date && isInRange(activityById.get(score.activity_id)?.created_date)));
  const scoredRangeScores = rangeScores.filter((score) => !score.is_absent);
  const activityAverage = scoredRangeScores.length
    ? Math.round((scoredRangeScores.reduce((sum, score) => sum + (Number(score.score || 0) / Math.max(1, Number(activityById.get(score.activity_id)?.max_score || 1))) * 100, 0) / scoredRangeScores.length))
    : 0;
  const classProgress = Math.round((attendanceRate + activityAverage) / (attendanceRate > 0 || activityAverage > 0 ? 2 : 1)) || 0;
  const rangeActivities = activities.filter((activity) => isInRange(activity.created_date));
  const rangeActivityIds = new Set(rangeActivities.map((activity) => activity.id));
  const scoredActivityIds = new Set(rangeScores.map((score) => score.activity_id));
  const toGradeCount = rangeActivities.filter((activity) => !scoredActivityIds.has(activity.id)).length;
  const rangeAttendanceByMember = new Set(rangeAttendance.map((record) => record.group_member_id));
  const rangeSchoolDays = [];
  for (let day = new Date(`${rangeStart || selectedDate}T00:00:00Z`); day <= new Date(`${rangeEnd || selectedDate}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    if (!hasClassDays(classroom.class_days) || isScheduledClassDay(day, classroom.class_days)) rangeSchoolDays.push(day.toISOString().slice(0, 10));
  }
  const noAttendanceInRange = rangeSchoolDays.length ? membersWithoutRecord(memberRows, rangeAttendanceByMember) : [];
  const scoredRangeActivityMembers = new Set(rangeScores.filter((score) => rangeActivityIds.has(score.activity_id)).map((score) => score.group_member_id));
  const noRangeActivity = rangeActivities.length ? membersWithoutRecord(memberRows, scoredRangeActivityMembers) : [];
  const rangeMissions = missions.filter((mission) => isInRange(mission.created_date));
  const submittedMissionMembers = new Set();
  for (const submission of submissions) {
    if (!rangeMissions.some((mission) => mission.id === submission.mission_id)) continue;
    if (submission.group_member_id) submittedMissionMembers.add(submission.group_member_id);
    else if (submission.group_id) members.filter((member) => member.group_id === submission.group_id).forEach((member) => submittedMissionMembers.add(member.id));
  }
  const noRangeMission = rangeMissions.length ? membersWithoutRecord(memberRows, submittedMissionMembers) : [];
  // This is the classroom's earned-points ledger, not the personal-points
  // classification metric. It intentionally includes QR scans, mission XP
  // redemptions, manual awards, and every other positive participation event.
  const participationTotals = groups.map((group) => ({
    id: group.id,
    label: `G${group.group_number}`,
    total: logs.filter((log) => log.group_id === group.id && isInRange(log.created_date)).reduce((sum, log) => sum + Math.max(0, signedPoints(log)), 0),
  }));
  const highestGroupParticipation = Math.max(...participationTotals.map((item) => item.total), 1);
  const groupParticipation = participationTotals.map((item) => {
    const rate = Math.round((item.total / highestGroupParticipation) * 100);
    return { ...item, rate, status: activityStatus(rate) };
  });
  const participationColumns = [
    groupParticipation.slice(0, Math.ceil(groupParticipation.length / 2)),
    groupParticipation.slice(Math.ceil(groupParticipation.length / 2)),
  ];
  const rangeAttendanceStats = new Map(memberRows.map((row) => [row.member.id, { present: 0, total: 0 }]));
  for (const record of rangeAttendance) {
    const stats = rangeAttendanceStats.get(record.group_member_id);
    if (stats) { stats.total += 1; if (record.status === "present") stats.present += 1; }
  }
  const rangeActivityStats = new Map(memberRows.map((row) => [row.member.id, { earned: 0, max: 0 }]));
  for (const score of rangeScores) {
    if (score.is_absent) continue;
    const stats = rangeActivityStats.get(score.group_member_id);
    const max = Number(activityById.get(score.activity_id)?.max_score) || 0;
    if (stats && max) { stats.earned += Number(score.score) || 0; stats.max += max; }
  }
  const rangeLogs = logs.filter((log) => isInRange(log.created_date));
  const rangePointsByMember = new Map(memberRows.map((row) => [row.member.id, 0]));
  for (const log of rangeLogs) if (log.group_member_id) rangePointsByMember.set(log.group_member_id, (rangePointsByMember.get(log.group_member_id) || 0) + signedPoints(log));
  const lowAttendanceRows = memberRows.filter((row) => { const stats = rangeAttendanceStats.get(row.member.id); return stats.total > 0 && (stats.present / stats.total) * 100 < 60; });
  const lowActivityRows = memberRows.filter((row) => { const stats = rangeActivityStats.get(row.member.id); return stats.max > 0 && (stats.earned / stats.max) * 100 < 60; });
  const averagePoints = memberRows.length ? [...rangePointsByMember.values()].reduce((sum, points) => sum + points, 0) / memberRows.length : 0;
  const lowParticipationRows = averagePoints > 0 ? memberRows.filter((row) => (rangePointsByMember.get(row.member.id) || 0) < averagePoints) : [];
  const groupActivityForRange = groups.map((group) => {
    const breakdown = memberRows.filter((row) => row.group?.id === group.id).map((row) => {
      const stats = rangeActivityStats.get(row.member.id) || { earned: 0, max: 0 };
      return { lastName: row.member.last_name || row.member.first_name || "Student", rate: stats.max ? Math.round((stats.earned / stats.max) * 100) : 0, hasRecord: stats.max > 0 };
    });
    const avg = breakdown.length ? Math.round(breakdown.reduce((sum, student) => sum + student.rate, 0) / breakdown.length) : 0;
    return { name: `G${group.group_number}`, avg, status: activityStatus(avg), noRecordStudents: breakdown.filter((student) => !student.hasRecord) };
  });
  const memberLabel = (row) => `${row.member.last_name}, ${row.member.first_name}`;
  const attentionCategories = [
    { label: "Low attendance", rows: lowAttendanceRows, detail: (row) => { const stats = rangeAttendanceStats.get(row.member.id); return `${Math.round((stats.present / stats.total) * 100)}%`; } },
    { label: "Low activity average", rows: lowActivityRows, detail: (row) => { const stats = rangeActivityStats.get(row.member.id); return `${Math.round((stats.earned / stats.max) * 100)}%`; } },
    { label: "Below class points", rows: lowParticipationRows, detail: (row) => `${rangePointsByMember.get(row.member.id) || 0} pts` },
    { label: "Join approvals", rows: pending, detail: () => "Awaiting approval", account: true },
    { label: "Score edit approvals", rows: scoreEdits, detail: () => "Review score edit", edit: true },
  ].filter((category) => category.rows.length);

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
        className="no-print"
      />

      <section className="no-print">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[var(--uc-purple)]">Today</p>
            <h2 className="font-display text-lg font-extrabold text-[var(--uc-navy-950)]">Run your class</h2>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Attendance", path: ROUTES.TEACHER.ATTENDANCE, icon: "attendance", tone: "bg-clay-sky/15" },
            { label: "Mission", path: ROUTES.TEACHER.MISSIONS, icon: "missions", tone: "bg-clay-purple/15" },
            { label: "Points", path: ROUTES.TEACHER.ACTIVITY_LOGS, icon: "points", tone: "bg-clay-lime/20" },
            { label: "QR code", path: ROUTES.TEACHER.QR_GENERATOR, icon: "qr", tone: "bg-clay-sun/20" },
          ].map((action) => {
            return <Link key={action.label} to={action.path} className="group flex min-h-14 items-center gap-2 rounded-xl border border-ink/10 bg-white px-2.5 py-2 shadow-[var(--uc-shadow-sm)] transition-transform hover:-translate-y-0.5 hover:border-[var(--uc-purple)]/25 focus:outline-none focus:ring-2 focus:ring-[var(--uc-purple)]/30"><span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${action.tone}`}><UIAsset name={action.icon} className="h-5 w-5" /></span><p className="min-w-0 font-display text-xs font-extrabold text-[var(--uc-navy-950)] sm:text-sm">{action.label}</p></Link>;
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <DashboardRangeTabs value={chartRange} onChange={setChartRange} anchorDate={anchorDate} onAnchorDateChange={setAnchorDate} />
        <span className="text-xs text-ink/60">Showing {rangeLabel} containing {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.</span>
      </div>

      <div className="flex flex-wrap gap-3 no-print">
        <ClayChip color="lime">On Track: {onTrack}</ClayChip>
        <ClayChip color="sun">Developing: {developing}</ClayChip>
      </div>

      <section className="no-print">
        <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
          <ClayCard className="p-3">
            <div className="text-2xl font-mono font-extrabold text-clay-sky">{attendanceRate}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Attendance {rangeLabel}</p>
          </ClayCard>
          <ClayCard className="p-3">
            <div className="text-2xl font-mono font-extrabold text-clay-purple">{toGradeCount}</div>
            <p className="text-xs font-display font-bold text-ink/60">{toGradeCount === 1 ? "activity needs a score" : "activities need scores"}</p>
          </ClayCard>
          <ClayCard className="p-3">
            <div className="text-2xl font-mono font-extrabold text-clay-lime">{classProgress}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Progress {rangeLabel}</p>
          </ClayCard>
        </div>
      </section>

      <section className="space-y-4 no-print">
        <ClayCard className="p-4">
          <h3 className="flex items-center gap-2 font-display text-sm font-bold text-ink/60"><UIAsset name="action" className="h-7 w-7" /> Needs Action · {rangeLabel}</h3>
          <p className="mb-3 text-xs text-ink/50">Attendance, activity, and mission records for the selected period that still need attention.</p>
          <div className="grid grid-cols-3 gap-2">
            {[{ label: rangeSchoolDays.length ? `No attendance record ${rangeLabel}` : "No class days in this period", value: noAttendanceInRange.length, path: ROUTES.TEACHER.ATTENDANCE, card: "Attendance" }, { label: rangeActivities.length ? `No record for posted activity ${rangeLabel}` : `No Activity posted ${rangeLabel}`, value: noRangeActivity.length, path: ROUTES.TEACHER.ACTIVITIES, card: "Activities" }, { label: rangeMissions.length ? `No submission for posted mission ${rangeLabel}` : `No Mission posted ${rangeLabel}`, value: noRangeMission.length, path: ROUTES.TEACHER.MISSIONS, card: "Missions" }].map((item) => <Link key={item.card} to={item.path} className="rounded-xl bg-[var(--uc-bg)] px-2.5 py-2 text-center"><p className="font-mono text-lg font-extrabold text-[var(--uc-navy-950)]">{item.value}</p><p className="text-[10px] font-display font-bold text-ink/55">{item.card}</p><p className="mt-0.5 text-[9px] leading-tight text-ink/45">{item.label}</p></Link>)}
          </div>
        </ClayCard>
        <ClayCard className="p-4">
          <h3 className="flex items-center gap-2 font-display text-sm font-bold text-ink/60"><UIAsset name="attention" className="h-7 w-7" /> Needs Attention · {rangeLabel}</h3>
          <p className="mb-3 text-xs text-ink/50">Learners’ quick snapshot for the selected period, plus approvals that need teacher decisions.</p>
          {attentionCategories.length ? <div className="flex flex-wrap gap-2">{attentionCategories.map((category) => <div key={category.label} className="min-w-44 flex-1 rounded-xl bg-[var(--uc-bg)] px-2.5 py-2"><p className="mb-1.5 text-[11px] font-display font-extrabold text-[var(--uc-navy-950)]">{category.label} <span className="text-ink/45">({category.rows.length})</span></p><div className="uc-compact-scroll flex max-h-28 flex-wrap content-start gap-1 overflow-y-auto pr-1">{category.rows.map((item) => { const row = category.edit ? memberRows.find((candidate) => candidate.member.id === item.group_member_id) : item; const label = category.account ? `${item.first_name || "Student"} ${item.last_name || "account"}` : category.edit ? row ? memberLabel(row) : "Student" : memberLabel(item); return <Link key={item.id || item.member?.id} to={category.edit ? ROUTES.TEACHER.EVIDENCE : category.account ? ROUTES.TEACHER.STUDENT_MANAGEMENT : ROUTES.TEACHER.ROSTER} className="max-w-full shrink-0 truncate rounded-full bg-white px-2 py-1 text-[10px] font-display font-bold text-[var(--uc-navy-950)] shadow-sm">{label} <span className="text-ink/45">· {category.detail(item)}</span></Link>; })}</div></div>)}</div> : <p className="rounded-xl bg-[var(--uc-bg)] px-3 py-2 text-xs text-ink/55">All clear — no learner or approval needs a decision right now.</p>}
        </ClayCard>
      </section>

      <section className="space-y-4 no-print">
        <ClayCard className="p-4"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-clay-purple/12"><UIAsset name="status" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Group Participation</h3><p className="text-xs text-ink/60">All earned points for {rangeLabel}: scans, missions, awards, and more</p></div></div><div className="mt-3 grid grid-cols-2 gap-x-3">{participationColumns.map((column, index) => <div key={index} className="space-y-1.5">{column.map((item) => { const color = item.status === "On Track" ? "#80C94B" : item.status === "Developing" ? "#F4C95D" : "#E76C82"; return <div key={item.label} className="grid grid-cols-[1.5rem_1fr_2.7rem] items-center gap-1.5 text-[10px]"><span className="font-display font-extrabold text-[var(--uc-navy-950)]">{item.label}</span><div className="h-2.5 overflow-hidden rounded-full bg-[var(--uc-purple-soft)]"><div className="h-full rounded-full" style={{ width: `${Math.max(item.total ? 8 : 0, item.rate)}%`, backgroundColor: color }} /></div><span className="text-right font-mono font-bold text-ink/65">{item.total} pts</span></div>; })}</div>)}</div></ClayCard>
        <ClayCard className="bg-white p-4"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-[var(--uc-blue-soft)]"><UIAsset name="activities" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Activity Completion</h3><p className="text-xs text-ink/60">Activity-average status by group · {rangeLabel}</p></div></div><div className="mt-3 grid grid-cols-2 gap-2">{groupActivityForRange.map((item) => <div key={item.name} className="rounded-xl border border-ink/10 bg-white px-2 py-2 sm:px-3"><div className="flex items-baseline justify-between gap-2"><p className="text-[10px] font-display font-bold text-ink/55">{item.name}</p><p className="font-mono text-lg font-extrabold text-[var(--uc-navy-950)] sm:text-xl">{item.avg}%</p></div><div className={`mt-1 rounded-lg px-1.5 py-1 text-[9px] leading-tight ${ACTIVITY_STATUS_STYLE[item.status]}`}><span className="font-display font-extrabold">Average status: </span>{item.status}</div><p className="mt-1.5 text-[9px] leading-tight text-ink/60"><span className="font-display font-extrabold">No activity record: </span>{item.noRecordStudents.length ? item.noRecordStudents.map((student) => student.lastName).join(", ") : "None"}</p></div>)}</div></ClayCard>
      </section>

      {pending.length > 0 && (
        <PendingApprovalBulk pending={pending} groups={groups} onApproveAll={approveAll} onApproveOne={approveOne} />
      )}

      <ClayCard className="no-print p-4 text-center">
        <p className="font-display font-bold">Detailed charts are in Analytics</p>
        <p className="mt-1 text-xs text-ink/60">The dashboard now stays focused on daily actions and students who need support.</p>
        <Link to={ROUTES.TEACHER.ANALYTICS} className="mt-3 inline-flex text-sm font-display font-bold text-clay-purple underline">Open analytics</Link>
      </ClayCard>

      <ClayCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-display font-bold text-lg">Student Progress Report</h2>
          <div className="flex flex-wrap gap-2">
            {["all", "Not enough data", "At Risk", "Developing", "On Track"].map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`clay-chip px-3 py-1 text-sm ${filter === f ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}>
                {f === "all" ? "All" : f}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[30rem] overflow-auto pr-1">
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
                  <td className="py-2 px-2 font-mono font-bold">{r.cls.total ?? "—"}</td>
                  <td className="py-2 pl-2">
                    <ClayChip
                      color={r.cls.color}
                      className="student-progress-status"
                      data-status={r.cls.tag.toLowerCase().replaceAll(" ", "-")}
                    >
                      {r.cls.tag}
                    </ClayChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ClayCard>
    </div>
  );
}
