
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { ACTIVE_CLASSROOM_KEY, getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from '@/api/supabaseClient';

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { ArrowRight, Sparkles } from "lucide-react";
import { computeAttendanceStreak, computeActivityPct, computeParticipationPoints, computeEngagementStreak } from "@/lib/stats";
import { getTodayManila, getWeekStartManila, isDateInRange } from "@/lib/week";
import DashboardRangeTabs from "@/components/DashboardRangeTabs";
import NovaMessage from "@/components/NovaMessage";
import UserAvatar, { DEFAULT_STUDENT_AVATAR } from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { ROUTES } from '@/lib/routes';
import PanelSkeleton from "@/components/PanelSkeleton";
import { getDailyMotivationQuote } from "@/lib/dailyQuote";
import { getPersonalRewardDashboard } from "@/lib/secureActions";

let studentDashboardCache = null;
const STUDENT_DASHBOARD_CACHE_MS = 30_000;

function missionEstimate(mission) {
  try {
    const content = JSON.parse(mission?.ai_content || "{}");
    return Number(content.estimated_minutes || 0) || null;
  } catch {
    return null;
  }
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function periodFor(range, anchorDate, term) {
  if (range === "term") {
    if (term?.start_date && term?.end_date) return { start: term.start_date, end: term.end_date, label: term.term_label || "this term" };
    const day = anchorDate || getTodayManila();
    return { start: day, end: day, label: "selected day" };
  }
  const anchor = new Date(`${anchorDate || getTodayManila()}T12:00:00Z`);
  if (range === "month") {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return { start: isoDate(start), end: isoDate(end), label: anchor.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  const start = getWeekStartManila(anchor);
  const end = new Date(`${start}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start, end: isoDate(end), label: `week of ${new Date(`${start}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}` };
}

function recordDate(record) {
  return String(record?.attendance_date || record?.auto_daily_date || record?.created_date || "").slice(0, 10);
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeClassroomId = typeof window !== "undefined" ? window.localStorage.getItem(ACTIVE_CLASSROOM_KEY) : null;
  const initialCache = activeClassroomId && studentDashboardCache?.userId === user?.id && studentDashboardCache.classroomId === activeClassroomId && Date.now() - studentDashboardCache.savedAt < STUDENT_DASHBOARD_CACHE_MS ? studentDashboardCache.data : null;
  const [data, setData] = useState(initialCache);
  const [loading, setLoading] = useState(!initialCache);
  const [loadError, setLoadError] = useState("");
  const [range, setRange] = useState("week");
  const [anchorDate, setAnchorDate] = useState(() => getTodayManila());
  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      setLoadError("");
      const account = await getActiveStudentAccount(user.id);
      if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
      const group = await db.entities.Group.get(account.group_id);
      const classroomId = group.classroom_id;

      // Paint the learner's space as soon as their approved account and group
      // resolve. Historical records can grow indefinitely; keeping them in a
      // single blocking Promise.all used to leave the entire desktop page on a
      // skeleton while old attendance and ledger rows were downloaded.
      const immediate = {
        account, group, classroom: {}, members: [], attendance: [], scores: [], activities: [], logs: [],
        badges: [], badgeDefinitions: [], terms: [], memberCards: [],
        groupLeaderboard: [{ group: { id: group.id, group_number: group.group_number }, points: 0 }],
        indLeaderboard: [], personalStreak: 0, myAvatarKey: user?.avatar_key || null,
        missions: [], missionSubmissions: [], announcements: [], personalReward: null,
      };
      studentDashboardCache = { userId: user.id, classroomId, data: immediate, savedAt: Date.now() };
      if (!active) return;
      setData(immediate);
      setLoading(false);

      const [classroom, members, terms, rankResult] = await Promise.all([
        db.entities.Classroom.get(classroomId),
        db.entities.GroupMember.filter({ group_id: group.id, is_transferred: false }),
        db.entities.GradingTerm.filter({ classroom_id: classroomId }),
        supabase.rpc('get_classroom_group_leaderboard', { p_classroom_id: classroomId }),
      ]);
      if (rankResult.error) throw rankResult.error;
      if (!active) return;

      const groupLeaderboard = (rankResult.data || []).map((row) => ({ group: { id: row.group_id, group_number: row.group_number }, points: Number(row.points || 0) }))
        .sort((a, b) => b.points - a.points);
      setData((current) => {
        const next = { ...current, classroom, members, terms, groupLeaderboard };
        studentDashboardCache = { userId: user.id, classroomId, data: next, savedAt: Date.now() };
        return next;
      });

      // All record queries are explicitly scoped to the active group and only
      // select the fields this panel renders. They hydrate independently, so a
      // delayed historical dataset cannot make the page appear broken.
      Promise.all([
        db.entities.Attendance.filter({ group_id: group.id }, { columns: 'group_member_id,status,attendance_date' }),
        db.entities.ActivityScore.filter({ group_id: group.id }, { columns: 'group_member_id,activity_id,score,created_date' }),
        db.entities.Activity.filter({ classroom_id: classroomId }, { columns: 'id,max_score,created_date' }),
        db.entities.ParticipationLog.filter({ group_id: group.id }, { columns: 'group_member_id,points_awarded,event_type,created_date' }),
        db.entities.MissionSubmission.filter({ group_id: group.id }, { columns: 'group_member_id,created_date' }),
        supabase.rpc('get_classroom_student_avatars', { p_classroom_id: classroomId }),
      ]).then(([attendance, scores, activities, logs, missionSubmissions, avatarResult]) => {
        if (!active || avatarResult.error) return;
        const avatarKeys = new Map((avatarResult.data || []).map((row) => [row.group_member_id, row.avatar_key]));
        const nameEffects = new Map((avatarResult.data || []).map((row) => [row.group_member_id, row.name_effect || "opaque-ink"]));
        const memberCards = members.map((member) => {
          const streak = computeAttendanceStreak(member.id, attendance, classroom?.class_days);
          const act = computeActivityPct(member.id, scores, activities);
          const points = computeParticipationPoints(member.id, logs);
          return { member, streak, activityPct: act.pct, points, avatarKey: avatarKeys.get(member.id), nameEffect: nameEffects.get(member.id) };
        });
        const indLeaderboard = members
          .map((member) => ({ member, points: computeParticipationPoints(member.id, logs), avatarKey: avatarKeys.get(member.id) }))
          .sort((left, right) => right.points - left.points)
          .slice(0, 10);
        const personalStreak = computeEngagementStreak(account.group_member_id, attendance, scores, getTodayManila(), classroom?.class_days, missionSubmissions);
        setData((current) => {
          const next = current && { ...current, attendance, scores, activities, logs, missionSubmissions, memberCards, indLeaderboard, personalStreak, myAvatarKey: avatarKeys.get(account.group_member_id) || user?.avatar_key || null };
          if (next) studentDashboardCache = { userId: user.id, classroomId, data: next, savedAt: Date.now() };
          return next;
        });
      }).catch((error) => console.warn('Dashboard progress data could not be loaded', error));

      Promise.all([
        db.entities.Announcement.filter({ classroom_id: classroomId, is_pinned: true }),
        supabase.rpc('get_student_missions', { p_classroom_id: classroomId }),
        db.entities.Badge.filter({ classroom_id: classroomId }),
        db.entities.BadgeDefinition.filter({ classroom_id: classroomId }),
        getPersonalRewardDashboard(classroomId),
      ]).then(([announcements, missions, badges, badgeDefinitions, personalReward]) => {
        if (!active) return;
        setData((current) => {
          const next = current && ({
          ...current,
          badges,
          badgeDefinitions,
          missions: missions.data || [],
          announcements: announcements.sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")),
          personalReward,
          });
          if (next) studentDashboardCache = { userId: user.id, classroomId, data: next, savedAt: Date.now() };
          return next;
        });
      }).catch((error) => console.warn("Dashboard extras could not be loaded", error));
    }
    load().catch((error) => {
      console.error("Student dashboard could not be loaded", error);
      if (active) {
        setLoadError(error?.message || "Your dashboard could not be loaded yet.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [user, navigate]);

  if (loading) return <PanelSkeleton />;
  if (!data) return <ClayCard className="mx-auto max-w-xl p-6 text-center"><h1 className="font-display text-xl font-extrabold">Dashboard unavailable</h1><p className="mt-2 text-sm text-ink/60">{loadError || "Please refresh and try again."}</p><ClayButton className="mt-4" onClick={() => window.location.reload()}>Try again</ClayButton></ClayCard>;

  const { account, group, classroom, members, attendance, scores, activities, logs, missionSubmissions, badges, badgeDefinitions, terms, memberCards, personalStreak, myAvatarKey, missions, announcements, personalReward } = data;
  const myMemberId = account.group_member_id;
  const selectedDate = anchorDate || getTodayManila();
  const selectedTerm = (terms || []).find((term) => term.start_date <= selectedDate && term.end_date >= selectedDate)
    || (terms || []).find((term) => term.is_active)
    || (terms || [])[0]
    || null;
  const selectedPeriod = periodFor(range, selectedDate, selectedTerm);
  const inSelectedPeriod = (record) => isDateInRange(recordDate(record), selectedPeriod.start, selectedPeriod.end);
  const periodAttendance = attendance.filter(inSelectedPeriod);
  const periodScores = scores.filter(inSelectedPeriod);
  const periodMissionSubmissions = (missionSubmissions || []).filter(inSelectedPeriod);
  const periodActivityIds = new Set(periodScores.map((score) => score.activity_id));
  const periodActivities = activities.filter((activity) => periodActivityIds.has(activity.id));
  const myAttendanceEntries = periodAttendance.filter((entry) => entry.group_member_id === myMemberId);
  const myAttendanceRate = myAttendanceEntries.length ? Math.round((myAttendanceEntries.filter((entry) => entry.status === "present").length / myAttendanceEntries.length) * 100) : 0;
  const myActivityPct = computeActivityPct(myMemberId, periodScores, periodActivities).pct || 0;
  const periodLogs = logs.filter(inSelectedPeriod);
  const streakReferenceDate = selectedPeriod.end && selectedPeriod.end < getTodayManila() ? selectedPeriod.end : getTodayManila();
  const periodMemberCards = members.map((member) => ({
    member,
    streak: computeEngagementStreak(member.id, periodAttendance, periodScores, streakReferenceDate, classroom?.class_days, periodMissionSubmissions),
    activityPct: computeActivityPct(member.id, periodScores, periodActivities).pct || 0,
    points: computeParticipationPoints(member.id, periodLogs),
  }));
  const periodPersonalStreak = periodMemberCards.find((card) => card.member.id === myMemberId)?.streak || 0;
  const myParticipationPoints = computeParticipationPoints(myMemberId, periodLogs);
  const myQrScanPoints = periodLogs
    .filter((log) => log.group_member_id === myMemberId && log.event_type === "scan")
    .reduce((total, log) => total + Number(log.points_awarded || 0), 0);
  const groupQrScanPoints = periodLogs
    .filter((log) => log.event_type === "scan")
    .reduce((total, log) => total + Number(log.points_awarded || 0), 0);
  const qrParticipationRate = groupQrScanPoints > 0 ? Math.round((myQrScanPoints / groupQrScanPoints) * 100) : 0;
  const statusAction = [
    myAttendanceRate < 60 && "Scan QR",
    myActivityPct < 60 && "submit work",
  ].filter(Boolean).slice(0, 2).join(" + ") || "Keep going";
  const progressStatus = myAttendanceRate >= 80 && myActivityPct >= 70
    ? { label: "On Track", message: "You are building strong habits—keep your steady rhythm going.", compactMessage: "My status: On track", tone: "bg-clay-lime/20 text-ink", valueTone: "text-[#228954] dark:text-[var(--uc-green)]", asset: "status" }
    : myAttendanceRate >= 60 || myActivityPct >= 50
      ? { label: "Developing", message: "You are making progress—one focused step today will strengthen your routine.", compactMessage: `My status: ${statusAction}`, tone: "bg-clay-sun/25 text-ink", valueTone: "text-[#b7791f] dark:text-[var(--uc-yellow)]", asset: "status" }
      : { label: "At Risk", message: "A fresh start is always possible—choose one small task and ask for support when you need it.", compactMessage: `My status: ${statusAction}`, tone: "bg-clay-coral/15 text-ink", valueTone: "text-[#d94b60] dark:text-[var(--uc-danger)]", asset: "status" };
  const progressCards = [
    { label: "My Attendance", value: `${myAttendanceRate}%`, asset: "attendance", tone: "bg-clay-sky/15" },
    { label: "My Activity", value: `${Math.round(myActivityPct)}%`, asset: "activities", tone: "bg-clay-lime/20" },
    { label: "Participation", value: `${myParticipationPoints} pts`, detail: `${myQrScanPoints} QR · ${qrParticipationRate}%`, asset: "points", tone: "bg-clay-purple/15" },
  ];
  const dailyQuote = getDailyMotivationQuote(account.id || user?.id, new Date(`${getTodayManila()}T12:00:00Z`));
  const periodMissions = missions.filter(inSelectedPeriod);
  const nextMission = periodMissions.find((mission) => mission.is_active && mission.approval_status === "approved") || periodMissions.find((mission) => mission.is_active);
  const nextMissionMinutes = missionEstimate(nextMission);
  const dashboardAvatarKey = myAvatarKey || DEFAULT_STUDENT_AVATAR;

  return (
    <div className="student-dashboard space-y-4 sm:space-y-4">
      <section className="grid items-center gap-4 lg:grid-cols-[1fr_.82fr] no-print">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <p className="text-sm font-semibold text-[var(--uc-purple)]">Your learning space</p>
          <h1 className="uc-page-title mt-1 text-4xl leading-none sm:text-5xl">Hi, <span className={`uc-name-effect-${user?.name_effect || "opaque-ink"}`}>{account.first_name}</span>!</h1>
          <p className="mt-3 text-sm text-ink/60 sm:text-base">One clear step at a time—your everyday effort is adding up.</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Link to={`${ROUTES.STUDENT.ONBOARDING}?add=1`} className="clay-btn bg-white px-3 py-2 text-xs text-ink">Join another class</Link>
            <span className="clay-btn bg-white px-3 py-2 text-xs text-ink capitalize">Section {classroom.section || "—"} | Group {group.group_number}</span>
          </div>
        </div>
        <div className="student-dashboard-hero relative flex min-h-36 items-center justify-center gap-8 overflow-hidden rounded-[26px] p-4">
          <UserAvatar name={user?.email} avatarKey={dashboardAvatarKey} frameKey={user?.avatar_frame} size="lg" className="shrink-0 scale-[1.4]" />
          <div className="relative min-w-0 max-w-xl">
            <p className="font-display text-xl font-extrabold leading-snug text-[var(--uc-navy-950)] sm:text-2xl">“{dailyQuote}”</p>
            <p className="mt-2 text-xs font-semibold text-[var(--uc-purple)]">Keep showing up, keep growing.</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardRangeTabs value={range} onChange={setRange} anchorDate={anchorDate} onAnchorDateChange={setAnchorDate} />
        <p className="w-full text-xs text-ink/55 sm:w-auto">Showing {selectedPeriod.label}</p>
      </div>

      {personalReward?.style_streak_ready && !(personalReward.claims || []).some((claim) => claim.status === "active" && ["avatar_choice", "theme_choice", "name_effect_choice"].includes(claim.reward_type)) && (
        <ClayCard color="lime" className="no-print p-4" role="status">
          <div className="flex items-center gap-3">
            <Sparkles className="h-7 w-7 shrink-0 text-clay-purple" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-display font-extrabold">You reached 5 learning actions!</p>
              <p className="mt-1 text-xs text-ink/65">Your avatar, learner theme, or name style is ready to unlock.</p>
            </div>
            <Link to={ROUTES.STUDENT.SETTINGS} className="clay-btn shrink-0 bg-white px-3 py-2 text-xs font-display font-bold text-ink">Customize</Link>
          </div>
        </ClayCard>
      )}

      <ClayCard color="purple" className="no-print p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4 text-white">
          <div className="flex min-h-16 w-16 shrink-0 self-stretch items-center justify-center rounded-2xl bg-white/15 p-1 sm:min-h-20 sm:w-20" aria-hidden="true"><UIAsset name="missions" className="h-full w-full object-contain" /></div>
          <div className="min-w-0 flex-1"><p className="font-display text-sm font-bold text-white/75">Your next step</p><p className="font-display text-lg font-extrabold">{nextMission ? nextMission.title : "Scan your class QR code"}</p><p className="text-xs text-white/75">{nextMission ? `${nextMissionMinutes ? `${nextMissionMinutes} min · ` : ""}Earn up to ${nextMission.xp_reward || 0} personal XP.` : "Every scan and completed activity moves your group closer to its next class goal."}</p></div>
          <Link to={nextMission ? ROUTES.STUDENT.MISSIONS : ROUTES.STUDENT.SCAN} className="clay-btn shrink-0 bg-clay-lime px-4 py-2 text-sm font-display font-bold text-ink">{nextMission ? "Start mission" : "Open scanner"}</Link>
        </div>
      </ClayCard>

      {(periodMissions.length > 0 || myActivityPct < 60) && (
        <ClayCard className="p-3">
          <h3 className="font-display text-xs font-bold text-ink/60 mb-2">Needs attention</h3>
          <ul className="space-y-1 text-sm">
            {periodMissions
              .slice()
              .sort((a, b) => (a.deadline || "").localeCompare(b.deadline || ""))
              .filter((m) => m.deadline)
              .slice(0, 2)
              .map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay-sun" />
                  <span>Due {m.deadline}: {m.title}</span>
                </li>
              ))}
            {myActivityPct < 60 && (
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay-coral" />
                <span>Your activity is below 60% — submit scores soon</span>
              </li>
            )}
          </ul>
        </ClayCard>
      )}

      <section className="no-print">
        <div className="mb-3 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-clay-purple" /><div><h2 className="font-display text-lg font-extrabold">Your Progress</h2><p className="text-xs text-ink/60">A compact view of the habits you are building.</p></div></div>
        <div className="grid w-full grid-cols-4 gap-2 sm:gap-3">
          {progressCards.map(({ label, value, detail, asset, tone }) => <ClayCard key={label} className="flex min-h-[5.5rem] items-center p-2 sm:p-3" title={detail ? `${label}: ${value}. ${detail}` : `${label}: ${value}`}><div className="flex w-full min-w-0 items-center gap-2"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}><UIAsset name={asset} className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="font-display text-lg font-extrabold leading-none text-[#228954] dark:text-[var(--uc-green)]">{value}</p><p className="mt-1 text-[9px] font-display font-bold leading-tight text-ink/60">{label}</p>{detail && <p className="mt-1 text-[9px] leading-tight text-ink/55">{detail}</p>}</div></div></ClayCard>)}
          <ClayCard className="flex min-h-[5.5rem] items-center p-2 sm:p-3" title={progressStatus.message}><div className="flex w-full min-w-0 items-center gap-2"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${progressStatus.tone}`}><UIAsset name={progressStatus.asset} className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className={`font-display text-lg font-extrabold leading-none ${progressStatus.valueTone}`} >{progressStatus.label}</p><p className="mt-1 text-[9px] leading-tight text-ink/65">{progressStatus.compactMessage}</p></div></div></ClayCard>
        </div>
      </section>

      {announcements.filter(inSelectedPeriod).length > 0 && (
        <div className="space-y-2">
          {announcements.filter(inSelectedPeriod).map((a) => (
            <ClayCard key={a.id} color="purple" className="p-4">
              <p className="font-display font-bold text-white flex items-center gap-2"><UIAsset name="notifications" className="h-5 w-5" /> {a.title}</p>
              {a.body && <p className="text-sm text-white/80 mt-1 whitespace-pre-wrap">{a.body}</p>}
            </ClayCard>
          ))}
        </div>
      )}

      <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:gap-3">
      <NovaMessage variant="teacher" tone="violet" title="Nova's learning tip" className="nova-tip-compact min-w-0 flex-row-reverse !gap-2 !p-2 [&>img]:!h-14 [&>img]:!w-14 sm:[&>img]:!h-16 sm:[&>img]:!w-16 [&>div>h2]:!text-lg [&>div>div]:!text-[9px] [&>div>div]:!leading-snug">
            {periodMissions.length ? (
              <>
                <p>You have {periodMissions.length} active mission{periodMissions.length === 1 ? "" : "s"} in this period.</p>
                <p className="mt-1 text-xs text-ink/55 max-[420px]:hidden">Next up: {periodMissions[0].title}</p>
              </>
            ) : <p>No active missions right now. Keep your group streak going.</p>}
            <Link to={ROUTES.STUDENT.MISSIONS} className="mt-2 inline-flex items-center gap-1 font-display text-xs font-bold underline">Open missions <ArrowRight className="w-3 h-3" /></Link>
      </NovaMessage>

      <ClayCard tone="green" className="flex min-h-[5.25rem] min-w-0 items-center justify-center p-3 text-center">
        <div className="min-w-0">
          <div className="flex items-center justify-center gap-2">
            <UIAsset name="streakFire" className="h-10 w-10 shrink-0" />
            <p className="font-mono text-4xl font-extrabold leading-none">{periodPersonalStreak}</p>
          </div>
          <p className="mt-1 font-display text-xs font-bold">personal day{periodPersonalStreak === 1 ? "" : "s"} in a row</p>
          <p className="mt-1 text-[10px] leading-snug text-ink/60 max-[420px]:hidden">{periodPersonalStreak > 0 ? "Attendance, activities, and missions keep it alive." : "A class-day action starts your streak."}</p>
        </div>
      </ClayCard>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-2"><UIAsset name="students" className="h-6 w-6" /><div><h2 className="font-display text-lg font-extrabold">Group Progress</h2><p className="text-xs text-ink/60">How your group is building habits together</p></div></div>
      <div className="grid gap-4 sm:grid-cols-2">
        {periodMemberCards.map(({ member, streak, activityPct, points }) => {
          const loadedMember = memberCards.find((card) => card.member.id === member.id);
          return (
          <ClayCard key={member.id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex min-w-0 items-center gap-2"><UserAvatar name={`${member.first_name} ${member.last_name}`} avatarKey={loadedMember?.avatarKey} size="sm" /><p className={`truncate font-display font-bold uc-name-effect-${loadedMember?.nameEffect || "opaque-ink"}`}>{member.last_name}, {member.first_name}</p></div>
              {member.id === account.group_member_id && <ClayChip color="purple">You</ClayChip>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border-2 border-ink/15 bg-clay-sun/20 p-2">
                <UIAsset name="streak" className="mx-auto h-5 w-5" />
                <p className="font-mono font-bold text-lg">{streak}</p>
                <p className="text-[10px] font-display">Streak</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-clay-lime/20 p-2">
                <UIAsset name="activities" className="mx-auto h-5 w-5" />
                <p className="font-mono font-bold text-lg">{Math.round(activityPct)}%</p>
                <p className="text-[10px] font-display">Activity</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-clay-pink/20 p-2">
                <UIAsset name="points" className="mx-auto h-5 w-5" />
                <p className="font-mono font-bold text-lg">{points}</p>
                <p className="text-[10px] font-display">Points</p>
              </div>
            </div>
          </ClayCard>
        );
        })}
      </div>
      </section>

    </div>
  );
}
