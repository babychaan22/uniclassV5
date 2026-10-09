
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { supabase } from "@/api/supabaseClient";
import { getTeacherClassroom, getTeacherClassrooms, getClassroomDataset, invalidateClassroomDataset } from "@/lib/teacherClassroom";

import ClayButton from "@/components/ClayButton";
import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import { computeClassification } from "@/lib/classification";
import {
  computeAttendanceRate, computeActivityPct, computeParticipationPoints, computeCategoryPct, signedPoints,
} from "@/lib/stats";
import { Printer, BarChart3, Award, CheckCircle2, ClipboardCheck, Target, QrCode, Coins } from "lucide-react";
import { getWeekStartManila, getTodayManila } from "@/lib/week";
import { hasClassDays, isScheduledClassDay } from "@/lib/classDays";
import PendingApprovalBulk from "@/components/teacher/PendingApprovalBulk";
import DashboardRangeTabs from "@/components/DashboardRangeTabs";
import NovaHero from "@/components/mascot/NovaHero";
import { UIAsset } from "@/components/visual/UIAsset";
import { ROUTES } from '@/lib/routes';
import PanelSkeleton from "@/components/PanelSkeleton";

let teacherDashboardCache = null;
const TEACHER_DASHBOARD_CACHE_MS = 30_000;

export default function TeacherDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const initialCache = teacherDashboardCache?.userId === user?.id && Date.now() - teacherDashboardCache.savedAt < TEACHER_DASHBOARD_CACHE_MS ? teacherDashboardCache.data : null;
  const [data, setData] = useState(initialCache);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(!initialCache);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState("all");
  const [chartRange, setChartRange] = useState("week");
  const [anchorDate, setAnchorDate] = useState(() => getTodayManila());
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
      const [ds, teacherClasses, badgeDefinitions, scoreEditsResult] = await Promise.all([
        getClassroomDataset(classroom.id, ['groups','members','settings','terms','attendance','scores','activities','assessments','logs','groupAccounts','badges']),
        getTeacherClassrooms(user.id),
        db.entities.BadgeDefinition.filter({ classroom_id: classroom.id }),
        supabase.from('activity_score_edit_requests').select('*').eq('classroom_id', classroom.id).eq('status', 'pending'),
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
        const breakdown = gm.map((member) => ({ name: memberNames[member.id], rate: Math.round(computeActivityPct(member.id, scores, activities).pct) }));
        const avg = breakdown.length > 0 ? breakdown.reduce((sum, member) => sum + member.rate, 0) / breakdown.length : 0;
        return { name: `G${g.group_number}`, avg: Math.round(avg), breakdown };
      });

      if (!active) return;
      setPending(pendingAccounts);
      const snapshot = { classroom, term, weights, memberRows, groupRows, trend, groupActivity, groups, attendance, scores, activities, logs, badges: ds.badges || [], badgeDefinitions, scoreEdits: scoreEditsResult.data || [], attentionByClass: [] };
      teacherDashboardCache = { userId: user.id, data: snapshot, savedAt: Date.now() };
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
          if (next) teacherDashboardCache = { userId: user.id, data: next, savedAt: Date.now() };
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
    return () => { active = false; };
  }, [user, reloadKey, navigate]);

  if (loading) return <PanelSkeleton cards={4} />;
  if (!data) return null;

  const { classroom, term, memberRows, groupRows, trend, groupActivity, groups, attendance, scores, activities, logs, badges, badgeDefinitions, scoreEdits = [], attentionByClass } = data;
  const onTrack = memberRows.filter((r) => r.cls.tag === "On Track").length;
  const developing = memberRows.filter((r) => r.cls.tag === "Developing").length;
  const atRiskRows = memberRows.filter((r) => r.cls.tag === "At Risk")
    .sort((left, right) => (left.cls.total || 0) - (right.cls.total || 0));
  const atRisk = atRiskRows.length;
  const filteredRows = (filter === "all" ? memberRows : memberRows.filter((r) => r.cls.tag === filter))
    .slice().sort((a, b) => `${a.member.last_name || ''} ${a.member.first_name || ''}`.localeCompare(`${b.member.last_name || ''} ${b.member.first_name || ''}`));
  const todayStr = getTodayManila();
  const selectedDate = anchorDate || todayStr;
  const monthStart = new Date(`${selectedDate}T00:00:00Z`);
  monthStart.setUTCDate(monthStart.getUTCDate() - 29);
  const rangeStart = chartRange === "term" ? (term?.start_date || null) : chartRange === "month" ? monthStart.toISOString().slice(0, 10) : getWeekStartManila(new Date(`${selectedDate}T12:00:00+08:00`));
  const rangeLabel = chartRange === "term" ? "this term" : chartRange === "month" ? "this month" : "this week";
  const isInRange = (value) => !rangeStart || String(value || "").slice(0, 10) >= rangeStart;
  const visibleTrend = trend.filter((item) => isInRange(item.date));
  const rangeAttendance = attendance.filter((record) => isInRange(record.attendance_date));
  const attendanceRate = rangeAttendance.length ? Math.round((rangeAttendance.filter((record) => record.status === "present").length / rangeAttendance.length) * 100) : 0;
  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  // Older score records may not carry a timestamp. Keep those included rather
  // than hiding valid grades when the date selector is changed.
  const rangeScores = scores.filter((score) => !score.created_date || isInRange(score.created_date));
  const activityAverage = rangeScores.length
    ? Math.round((rangeScores.reduce((sum, score) => sum + (Number(score.score || 0) / Math.max(1, Number(activityById.get(score.activity_id)?.max_score || 1))) * 100, 0) / rangeScores.length))
    : 0;
  const classProgress = Math.round((attendanceRate + activityAverage) / (attendanceRate > 0 || activityAverage > 0 ? 2 : 1)) || 0;
  const scoredActivityIds = new Set(scores.map((s) => s.activity_id));
  const toGradeCount = activities.filter((a) => !scoredActivityIds.has(a.id)).length;
  const groupParticipation = groups.map((group) => {
    const membersInGroup = memberRows.filter((row) => row.group?.id === group.id);
    const total = membersInGroup.reduce((sum, row) => sum + Number(row.pts || 0), 0);
    return { label: `G${group.group_number}`, total };
  });
  const highestGroupParticipation = Math.max(...groupParticipation.map((item) => item.total), 1);
  const recentAchievements = logs.slice().sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")).slice(0, 3);
  const lowAttendanceRows = memberRows.filter((row) => row.att.count > 0 && row.att.rate < 60);
  const lowActivityRows = memberRows.filter((row) => row.act.count > 0 && row.act.pct < 60);
  const averagePoints = memberRows.length ? memberRows.reduce((sum, row) => sum + Number(row.pts || 0), 0) / memberRows.length : 0;
  const lowParticipationRows = averagePoints > 0 ? memberRows.filter((row) => Number(row.pts || 0) < averagePoints) : [];
  const memberLabel = (row) => `${row.member.last_name}, ${row.member.first_name}`;
  const attentionCategories = [
    { label: "Low attendance", rows: lowAttendanceRows, detail: (row) => `${Math.round(row.att.rate)}%` },
    { label: "Low activity average", rows: lowActivityRows, detail: (row) => `${Math.round(row.act.pct)}%` },
    { label: "Below class points", rows: lowParticipationRows, detail: (row) => `${row.pts} pts` },
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
        greeting="Hi, Teacher!"
        greetingSubtext="Here's what needs your attention today."
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
            { label: "Points", path: ROUTES.TEACHER.ACTIVITY_LOGS, icon: "reward", tone: "bg-clay-lime/20" },
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

      <section className="grid gap-4 no-print lg:grid-cols-[1.1fr_.9fr]">
        <ClayCard className="p-4">
          <h3 className="font-display text-sm font-bold text-ink/60">Needs Action</h3>
          <p className="mb-3 text-xs text-ink/50">Daily and all-time reminders for records that still need attention.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[{ label: "Attendance", value: memberRows.filter((row) => row.att.count === 0).length, path: ROUTES.TEACHER.ATTENDANCE }, { label: "Activities", value: toGradeCount, path: ROUTES.TEACHER.ACTIVITIES }, { label: "Participation", value: lowParticipationRows.length, path: ROUTES.TEACHER.ACTIVITY_LOGS }, { label: "Missions", value: scoreEdits.length, path: ROUTES.TEACHER.EVIDENCE }].map((item) => <Link key={item.label} to={item.path} className="rounded-xl bg-[var(--uc-bg)] px-2.5 py-2 text-center"><p className="font-mono text-lg font-extrabold text-[var(--uc-navy-950)]">{item.value}</p><p className="text-[10px] font-display font-bold text-ink/55">{item.label}</p></Link>)}
          </div>
        </ClayCard>
        <ClayCard className="p-4">
          <h3 className="font-display text-sm font-bold text-ink/60">Needs Attention</h3>
          <p className="mb-3 text-xs text-ink/50">Learners and approvals that need a quick teacher decision.</p>
          {attentionCategories.length ? <div className="flex flex-wrap gap-2">{attentionCategories.map((category) => <div key={category.label} className="min-w-44 flex-1 rounded-xl bg-[var(--uc-bg)] px-2.5 py-2"><p className="mb-1.5 text-[11px] font-display font-extrabold text-[var(--uc-navy-950)]">{category.label} <span className="text-ink/45">({category.rows.length})</span></p><div className="flex flex-wrap gap-1">{category.rows.slice(0, 3).map((item) => { const row = category.edit ? memberRows.find((candidate) => candidate.member.id === item.group_member_id) : item; const label = category.account ? `${item.first_name || "Student"} ${item.last_name || "account"}` : category.edit ? row ? memberLabel(row) : "Student" : memberLabel(item); return <Link key={item.id || item.member?.id} to={category.edit ? ROUTES.TEACHER.EVIDENCE : ROUTES.TEACHER.ROSTER} className="max-w-full truncate rounded-full bg-white px-2 py-1 text-[10px] font-display font-bold text-[var(--uc-navy-950)] shadow-sm">{label} <span className="text-ink/45">· {category.detail(item)}</span></Link>; })}</div></div>)}</div> : <p className="rounded-xl bg-[var(--uc-bg)] px-3 py-2 text-xs text-ink/55">All clear — no learner or approval needs a decision right now.</p>}
        </ClayCard>
      </section>

      <section className="grid gap-4 no-print sm:grid-cols-2 lg:grid-cols-3">
        <ClayCard className="p-4"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-clay-purple/12"><UIAsset name="students" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Group participation</h3><p className="text-xs text-ink/60">Total participation points by group</p></div></div><div className="mt-4 space-y-2.5">{groupParticipation.map((item, index) => <div key={item.label} className="grid grid-cols-[2.25rem_1fr_3.25rem] items-center gap-2 text-xs"><span className="font-display font-extrabold text-[var(--uc-navy-950)]">{item.label}</span><div className="h-3 overflow-hidden rounded-full bg-[var(--uc-purple-soft)]"><div className="h-full rounded-full" style={{ width: `${Math.max(item.total ? 8 : 0, (item.total / highestGroupParticipation) * 100)}%`, backgroundColor: ["#8E5CF6", "#56B4F4", "#C5A4FF", "#FFD75F"][index % 4] }} /></div><span className="text-right font-mono font-bold text-ink/65">{item.total} pts</span></div>)}</div></ClayCard>
        <ClayCard className="p-4"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-clay-sky/15"><UIAsset name="attendance" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Attendance</h3><p className="text-xs text-ink/60">Students present</p></div></div><div className="mx-auto mt-4 flex h-32 w-32 items-center justify-center rounded-full" style={{ background: `conic-gradient(#32A9ED ${attendanceRate}%, #E8EDF5 0)` }}><div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-white"><strong className="font-mono text-3xl">{attendanceRate}%</strong><span className="text-xs text-ink/60">present</span></div></div></ClayCard>
        <ClayCard className="p-4 sm:col-span-2 lg:col-span-1"><div className="flex items-start gap-3"><span className="uc-icon-tile bg-clay-pink/12"><UIAsset name="assessment" className="h-9 w-9" /></span><div><h3 className="font-display text-lg font-extrabold">Activity completion</h3><p className="text-xs text-ink/60">Average by group</p></div></div><div className="mt-4 grid grid-cols-2 gap-2">{groupActivity.map((item) => <div key={item.name} className="rounded-xl bg-[var(--uc-bg)] px-3 py-2 text-center"><p className="text-[10px] font-display font-bold text-ink/55">{item.name}</p><p className="font-mono text-xl font-extrabold text-[var(--uc-navy-950)]">{item.avg}%</p></div>)}</div></ClayCard>
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
        <h2 className="font-display font-bold text-lg mb-3">Group Status</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {groupRows.map((r) => (
            <div key={r.group.id} className="clay-tile p-2.5 text-center">
              <p className="inline-flex items-center justify-center gap-1 text-sm font-display font-bold">Group {r.group.group_number} <GroupBadgeMarkers groupId={r.group.id} badges={badges} definitions={badgeDefinitions} /></p>
              {(() => {
                const status = r.avgTotal === null ? "Developing" : r.avgTotal >= 80 ? "On Track" : r.avgTotal >= 60 ? "Developing" : "At Risk";
                const color = status === "On Track" ? "lime" : status === "At Risk" ? "coral" : "sun";
                const reason = r.avgTotal === null ? "Needs attendance and activity records to establish a baseline." : status === "On Track" ? `Average performance is ${Math.round(r.avgTotal)}%, meeting the class target.` : status === "At Risk" ? `Average performance is ${Math.round(r.avgTotal)}%; attendance or scores need support.` : `Average performance is ${Math.round(r.avgTotal)}%; more consistent progress will move it on track.`;
                return <><div className="mt-1"><ClayChip color={color}>{status}</ClayChip></div><p className="mt-1 text-[11px] leading-snug text-ink/60">{reason}</p></>;
              })()}
            </div>
          ))}
        </div>
      </ClayCard>

      <ClayCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-display font-bold text-lg">Student Classification Report</h2>
          <div className="flex flex-wrap gap-2">
            {["all", "Not enough data", "At Risk", "Developing", "On Track"].map((f) => (
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
                  <td className="py-2 px-2 font-mono font-bold">{r.cls.total ?? "—"}</td>
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
