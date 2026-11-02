import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, HeartHandshake, Printer } from 'lucide-react';
const db = globalThis.__B44_DB__;
import { useAuth } from '@/lib/AuthContext';
import { getClassroomDataset, getTeacherClassroom } from '@/lib/teacherClassroom';
import { getTodayManila, getWeekStartManila } from '@/lib/week';
import { ROUTES } from '@/lib/routes';
import { SYSTEM_BADGES } from '@/lib/groupBadges';
import ClayButton from '@/components/ClayButton';
import ClayCard from '@/components/ClayCard';
import ClayChip from '@/components/ClayChip';

function displayName(member) {
  return `${member.first_name || ''} ${member.last_name || ''}`.trim() || 'Student';
}

function percent(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : null;
}

function missionScoreMaximum(mission) {
  if (!mission) return 0;
  if (!mission.formative_type || mission.formative_type === 'manual') return Number(mission.max_score || 0);
  try {
    const content = JSON.parse(mission.ai_content || '{}');
    if (mission.formative_type === 'drag_drop') return content.left?.length || Number(mission.max_score || 0);
    if (mission.formative_type === 'fill_in_blank') return (content.questions || []).reduce((total, question) => total + (String(question.prompt || '').match(/\{\{[^}]+\}\}/g)?.length || 0), 0) || Number(mission.max_score || 0);
    return content.questions?.length || Number(mission.max_score || 0);
  } catch {
    return Number(mission.max_score || 0);
  }
}

export default function FamilySummaries() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [memberId, setMemberId] = useState('');
  const [period, setPeriod] = useState('week');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!user) return;
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
      const [dataset, badgeDefinitions] = await Promise.all([
        getClassroomDataset(classroom.id, ['groups', 'members', 'terms', 'attendance', 'activities', 'scores', 'missions', 'submissions', 'badges', 'logs']),
        db.entities.BadgeDefinition.filter({ classroom_id: classroom.id }),
      ]);
      if (!active) return;
      const members = (dataset.members || []).filter((member) => !member.is_transferred)
        .sort((left, right) => displayName(left).localeCompare(displayName(right)));
      setData({ classroom, ...dataset, badgeDefinitions, members });
      setMemberId((current) => current || members[0]?.id || '');
    }
    load().catch((error) => console.warn('Family summaries could not load', error));
    return () => { active = false; };
  }, [navigate, user]);

  const summary = useMemo(() => {
    if (!data || !memberId) return null;
    const member = data.members.find((item) => item.id === memberId);
    if (!member) return null;
    const group = data.groups.find((item) => item.id === member.group_id);
    const today = getTodayManila();
    const selectedTerm = (data.terms || []).find((item) => item.is_active) || data.terms?.[0] || null;
    const selectedMonth = new Date(`${today}T12:00:00+08:00`);
    const monthStart = new Date(Date.UTC(selectedMonth.getUTCFullYear(), selectedMonth.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(selectedMonth.getUTCFullYear(), selectedMonth.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const weekStart = getWeekStartManila(new Date(`${today}T12:00:00+08:00`));
    const weekEndDate = new Date(`${weekStart}T12:00:00+08:00`);
    weekEndDate.setDate(weekEndDate.getDate() + 6);
    const weekEnd = weekEndDate.toISOString().slice(0, 10);
    const usingTerm = period === 'term' && selectedTerm?.start_date && selectedTerm?.end_date;
    const start = usingTerm ? selectedTerm.start_date : period === 'month' ? monthStart : weekStart;
    const end = usingTerm ? selectedTerm.end_date : period === 'month' ? monthEnd : weekEnd;
    const periodLabel = usingTerm ? (selectedTerm.term_label || 'This term') : period === 'month' ? 'This month' : 'This week';
    const periodTitle = usingTerm ? 'Term' : period === 'month' ? 'Monthly' : 'Weekly';
    const inPeriod = (value) => {
      const day = String(value || '').slice(0, 10);
      return day >= start && day <= end;
    };
    const attendance = data.attendance.filter((item) => item.group_member_id === member.id && inPeriod(item.attendance_date));
    const attendanceRate = percent(attendance.filter((item) => item.status === 'present').length, attendance.length);
    const activityById = new Map(data.activities.map((item) => [item.id, item]));
    const scores = data.scores.filter((item) => item.group_member_id === member.id && !item.is_absent && inPeriod(item.created_date || activityById.get(item.activity_id)?.created_date));
    const earned = scores.reduce((total, item) => total + Number(item.score || 0), 0);
    const possible = scores.reduce((total, item) => total + Number(activityById.get(item.activity_id)?.max_score || 0), 0);
    const activityRate = percent(earned, possible);
    const publishedMissions = data.missions.filter((item) => item.is_active && (item.approval_status === 'approved' || !item.approval_status));
    const missionById = new Map(data.missions.map((item) => [item.id, item]));
    const missionSubmissions = data.submissions.filter((item) => (item.group_member_id === member.id || (!item.group_member_id && item.group_id === member.group_id)) && inPeriod(item.created_date));
    const isTeacherMade = (mission) => mission && mission.mission_source !== 'daily_foundation';
    const teacherMissionSubmissions = missionSubmissions.filter((item) => isTeacherMade(missionById.get(item.mission_id)));
    const missionEarned = teacherMissionSubmissions.reduce((total, item) => {
      const maximum = missionScoreMaximum(missionById.get(item.mission_id));
      return total + Math.min(Math.max(0, Number(item.score || 0)), maximum);
    }, 0);
    const missionPossible = teacherMissionSubmissions.reduce((total, item) => total + missionScoreMaximum(missionById.get(item.mission_id)), 0);
    const missionMastery = percent(missionEarned, missionPossible);
    const completedMissionIds = new Set(missionSubmissions.map((item) => item.mission_id));
    const teacherMissions = publishedMissions.filter((item) => isTeacherMade(item) && inPeriod(item.deadline || item.created_date));
    const completedTeacherMissionIds = new Set(teacherMissionSubmissions.map((item) => item.mission_id));
    const teacherMissionCompletion = percent(teacherMissions.filter((item) => completedTeacherMissionIds.has(item.id)).length, teacherMissions.length);
    const dueThisWeek = teacherMissions.filter((item) => {
      const due = String(item.deadline || item.created_date || '').slice(0, 10);
      return due && due >= start && due <= end;
    });
    const missed = dueThisWeek.filter((item) => !completedMissionIds.has(item.id));
    const personalBadges = data.badges.filter((item) => item.member_id === member.id && inPeriod(item.created_date));
    const groupBadges = data.badges.filter((item) => item.group_id === member.group_id && !item.member_id && inPeriod(item.created_date));
    const definitionsById = new Map((data.badgeDefinitions || []).map((definition) => [definition.id, definition]));
    const achievements = [...personalBadges, ...groupBadges]
      .filter((badge) => badge.approval_status === 'approved')
      .map((badge) => {
        const definition = definitionsById.get(badge.badge_definition_id);
        const systemBadge = SYSTEM_BADGES[badge.badge_type];
        const earnedOn = badge.reviewed_at || badge.created_date;
        return {
          id: badge.id,
          icon: definition?.icon || systemBadge?.icon || '🏅',
          name: definition?.title || systemBadge?.label || badge.badge_type?.replaceAll('_', ' ') || 'Class achievement',
          earnedDate: earnedOn ? new Date(earnedOn).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'date unavailable',
        };
      });
    const personalClassPoints = (data.logs || [])
      .filter((item) => item.group_member_id === member.id && inPeriod(item.created_date))
      .reduce((total, item) => total + Math.max(0, Number(item.points_awarded || 0)), 0);
    const nextStep = missed.length
      ? `Complete “${missed[0].title || 'your assigned mission'}”.`
      : attendanceRate !== null && attendanceRate < 80
        ? 'Record attendance for every scheduled class day.'
        : activityRate !== null && activityRate < 80
          ? 'Review the most recent activity and ask for help with difficult steps.'
          : 'Keep up the steady work—your learning habits are building well.';
    const activityRecords = scores
      .map((item) => ({ ...item, activity: activityById.get(item.activity_id) }))
      .sort((left, right) => String(left.activity?.activity_number || '').localeCompare(String(right.activity?.activity_number || '')));
    return { member, group, start, end, periodLabel, periodTitle, attendance, attendanceRate, scores, activityRecords, activityRate, missionSubmissions, teacherMissionSubmissions, missionMastery, teacherMissionCompletion, teacherMissions, dueThisWeek, missed, achievements, personalClassPoints, nextStep };
  }, [data, memberId, period]);

  async function copySummary() {
    if (!summary) return;
    const lines = [
      `${displayName(summary.member)} — UniClass ${summary.periodTitle.toLowerCase()} update`,
      `${summary.start} to ${summary.end}`,
      `Attendance: ${summary.attendanceRate === null ? 'No class record yet' : `${summary.attendanceRate}% (${summary.attendance.filter((item) => item.status === 'present').length}/${summary.attendance.length} present)`}`,
      `Activity work: ${summary.activityRate === null ? 'No scored activity yet' : `${summary.activityRate}% across ${summary.scores.length} scored activity record${summary.scores.length === 1 ? '' : 's'}`}`,
      `Teacher-made missions: ${summary.teacherMissionSubmissions.length} answered in this period${summary.missionMastery === null ? '' : `; ${summary.missionMastery}% mastery`}${summary.teacherMissionCompletion === null ? '' : `; ${summary.teacherMissionCompletion}% completion`}${summary.missed.length ? `; ${summary.missed.length} still needs attention` : ''}.`,
      `Personal class points: ${summary.personalClassPoints} earned in this period.`,
      `Achievements: ${summary.achievements.length ? summary.achievements.map((achievement) => `${achievement.name} (${achievement.earnedDate})`).join(', ') : 'No badge earned in this period.'}`,
      `Next step: ${summary.nextStep}`,
    ];
    await navigator.clipboard?.writeText(lines.join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  if (!data) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" /></div>;

  return <div className="mx-auto max-w-3xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-display font-extrabold"><HeartHandshake className="h-6 w-6" /> Family summaries</h1><p className="mt-1 text-sm text-ink/60">A simple, read-only weekly, monthly, or term update a teacher can print or share with a family.</p></div>
      <div className="flex gap-2"><ClayButton color="cream" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</ClayButton><ClayButton color="sky" size="sm" onClick={copySummary}><Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy update'}</ClayButton></div>
    </div>

    <ClayCard className="space-y-4 p-4 no-print"><div><p className="text-sm font-display font-bold">Summary period</p><div className="mt-2 grid grid-cols-3 gap-2">{[['week', 'Weekly'], ['month', 'Monthly'], ['term', 'Term']].map(([value, label]) => <button key={value} type="button" onClick={() => setPeriod(value)} className={`clay-btn justify-center px-2 py-2 text-sm ${period === value ? 'bg-clay-purple text-white' : 'bg-cream text-ink/70'}`}>{label}</button>)}</div>{period === 'term' && !(data.terms || []).some((item) => item.is_active || (item.start_date && item.end_date)) && <p className="mt-2 text-xs text-clay-coral">Set an active term in Class Setup to create a term summary.</p>}</div><label className="block text-sm font-display font-bold">Choose a learner<select aria-label="Choose learner for family summary" className="clay-input mt-2 w-full" value={memberId} onChange={(event) => setMemberId(event.target.value)}>{data.members.map((member) => <option key={member.id} value={member.id}>{displayName(member)}{data.groups.find((group) => group.id === member.group_id) ? ` · Group ${data.groups.find((group) => group.id === member.group_id).group_number}` : ''}</option>)}</select></label></ClayCard>

    {summary && <ClayCard className="space-y-3.5 p-4 sm:p-5">
      <div><p className="text-xs font-display font-bold text-clay-purple">{summary.periodTitle} update · {summary.start} to {summary.end}</p><h2 className="mt-1 text-2xl font-display font-extrabold">{displayName(summary.member)}</h2><p className="mt-1 text-sm text-ink/60">{data.classroom.grade_level} · {data.classroom.section}{summary.group ? ` · Group ${summary.group.group_number}` : ''}</p></div>
      <div className="overflow-x-auto pb-1" aria-label="Learner summary measures">
        <div className="grid min-w-[39rem] grid-cols-7 gap-2">
        <Metric label="Attendance" value={summary.attendanceRate === null ? '—' : `${summary.attendanceRate}%`} detail={summary.attendance.length ? `${summary.attendance.filter((item) => item.status === 'present').length}/${summary.attendance.length} present` : 'No record'} />
        <Metric label="Activity work" value={summary.activityRate === null ? '—' : `${summary.activityRate}%`} detail={summary.scores.length ? `${summary.scores.length} scored` : 'No score'} />
        <Metric label="Teacher missions" value={String(summary.teacherMissionSubmissions.length)} detail="answered" />
        <Metric label="Mission mastery" value={summary.missionMastery === null ? '—' : `${summary.missionMastery}%`} detail="teacher-made only" />
        <Metric label="Mission completion" value={summary.teacherMissionCompletion === null ? '—' : `${summary.teacherMissionCompletion}%`} detail={`${summary.teacherMissions.length} assigned`} />
        <Metric label="Class points" value={String(summary.personalClassPoints)} detail="personally earned" />
        <Metric label="Achievements" value={String(summary.achievements.length)} detail={`badges ${summary.periodLabel.toLowerCase()}`} />
        </div>
      </div>
      <div className="rounded-xl border-2 border-clay-purple/20 bg-clay-purple/10 px-3 py-2.5"><p className="font-display text-xs font-extrabold">A clear next step</p><p className="mt-0.5 text-xs leading-relaxed text-ink/75">{summary.nextStep}</p></div>
      <div><div className="flex items-baseline justify-between gap-2"><p className="font-display text-sm font-extrabold">Recorded activity scores</p><p className="text-[10px] text-ink/60">{summary.periodLabel}</p></div>{summary.activityRecords.length ? <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">{summary.activityRecords.map((record) => { const max = Number(record.activity?.max_score || 0); const scoreRate = percent(Number(record.score || 0), max); return <div key={record.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink/10 bg-white px-2.5 py-1.5"><div className="min-w-0"><p className="truncate text-xs font-display font-extrabold">{record.activity?.title || `Activity ${record.activity?.activity_number || ''}`}</p><p className="text-[10px] text-ink/55">Activity {record.activity?.activity_number || '—'}</p></div><div className="shrink-0 text-right"><p className="font-mono text-xs font-extrabold text-[var(--uc-navy-950)]">{record.score}/{max || '—'}</p><p className="text-[9px] text-ink/55">{scoreRate === null ? '—' : `${scoreRate}%`}</p></div></div>; })}</div> : <p className="mt-1.5 text-xs text-ink/60">No activity score was recorded in this period.</p>}</div>
      <div className="grid gap-2 sm:grid-cols-2"><SummaryBlock title="Completed work" lines={[`${summary.attendance.filter((item) => item.status === 'present').length} attendance record${summary.attendance.filter((item) => item.status === 'present').length === 1 ? '' : 's'} marked present.`, `${summary.scores.length} activity score${summary.scores.length === 1 ? '' : 's'} recorded.`, `${summary.missionSubmissions.length} mission${summary.missionSubmissions.length === 1 ? '' : 's'} completed.`]} /><SummaryBlock title="Needs attention" lines={summary.missed.length ? summary.missed.slice(0, 3).map((item) => `Mission: ${item.title || 'Untitled mission'}`) : [`No teacher-assigned mission is due in ${summary.periodLabel.toLowerCase()}.`]} /></div>
      <div><p className="font-display text-sm font-extrabold">Achievements</p><div className="mt-1.5 flex flex-wrap gap-1.5">{summary.achievements.length ? summary.achievements.map((achievement) => <div key={achievement.id} className="inline-flex items-center gap-1.5 rounded-lg border border-clay-sun/35 bg-clay-sun/15 px-2 py-1"><span role="img" aria-label={achievement.name} className="text-base">{achievement.icon}</span><span><span className="block text-[11px] font-display font-extrabold text-ink">{achievement.name}</span><span className="block text-[9px] text-ink/60">Earned {achievement.earnedDate}</span></span></div>) : <p className="text-xs text-ink/60">No badge was earned in this period yet.</p>}</div></div>
      <p className="border-t border-ink/10 pt-2 text-[10px] leading-relaxed text-ink/55">This update is a classroom learning summary. It is read-only and contains no account settings, private messages, or other learners’ records.</p>
    </ClayCard>}
  </div>;
}

function Metric({ label, value, detail }) {
  return <div className="rounded-xl bg-[var(--uc-bg)] px-2 py-2 text-center"><p className="font-mono text-lg font-extrabold text-[var(--uc-navy-950)]">{value}</p><p className="mt-0.5 text-[10px] font-display font-bold leading-tight">{label}</p><p className="mt-0.5 text-[9px] leading-tight text-ink/55">{detail}</p></div>;
}

function SummaryBlock({ title, lines }) {
  return <div className="rounded-xl border border-ink/10 bg-white p-3"><p className="font-display text-xs font-extrabold">{title}</p><ul className="mt-1.5 space-y-1 text-xs text-ink/70">{lines.map((line) => <li key={line}>• {line}</li>)}</ul></div>;
}
