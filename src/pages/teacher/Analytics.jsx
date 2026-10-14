import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CheckCircle2, ClipboardCheck, Medal, Target, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { db } from "@/api/supabaseClient";
import { getTeacherClassroom, getClassroomDataset } from "@/lib/teacherClassroom";
import { getMissionProgress, isDailyFoundationMission } from "@/lib/missionProgress";
import { missionTargetsClass } from "@/lib/missionAudience";
import { ROUTES } from "@/lib/routes";
import ClayCard from "@/components/ClayCard";
import { getGroupBadgeItems } from "@/lib/groupBadges";
import { signedPoints } from "@/lib/stats";

const fullName = (member) => [member?.last_name, member?.first_name].filter(Boolean).join(", ") || "Student";
const shortTitle = (title, max = 15) => title?.length > max ? `${title.slice(0, max - 1)}…` : (title || "Mission");
const learningStatus = (rate) => rate >= 80 ? "On Track" : rate >= 60 ? "Developing" : "At Risk";
const learningStatusClass = { "On Track": "bg-[var(--uc-green-soft)] text-[#4d8c29]", Developing: "bg-[#FFF7DF] text-[#9A7012]", "At Risk": "bg-[#FFF0F3] text-[#B94B63]" };

function questionMastery(mission, submissions) {
  if (!mission?.ai_content || !mission?.answer_key) return [];
  try {
    const content = JSON.parse(mission.ai_content);
    const answerKey = JSON.parse(mission.answer_key);
    const answers = answerKey.answers || answerKey;
    const questions = mission.formative_type === "drag_drop"
      ? Object.keys(answers || {}).map((prompt) => ({ prompt, correct: answers[prompt] }))
      : (content.questions || []).map((question, index) => ({ prompt: question.prompt, correct: answers[index] }));
    const attempts = submissions.filter((submission) => submission.mission_id === mission.id && submission.answers);
    return questions.map((question, index) => {
      let correct = 0;
      for (const submission of attempts) {
        try {
          const given = JSON.parse(submission.answers);
          const answer = mission.formative_type === "drag_drop" ? given[question.prompt] : given[index];
          if (String(answer) === String(question.correct)) correct += 1;
        } catch {}
      }
      return { prompt: question.prompt || `Question ${index + 1}`, correct, total: attempts.length, pct: attempts.length ? Math.round((correct / attempts.length) * 100) : 0 };
    });
  } catch { return []; }
}
function weekKey(day) {
  const date = new Date(`${day}T00:00:00Z`);
  const currentDay = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (currentDay === 0 ? -6 : 1 - currentDay));
  return date.toISOString().slice(0, 10);
}

function ContainedDetail({ title, entry, children }) {
  return <div className="mt-3 min-h-16 rounded-xl border-2 border-ink/10 bg-cream px-3 py-2" aria-live="polite">
    {!entry ? <p className="text-xs text-ink/55">Select a bar to inspect the compact list for {title.toLowerCase()}.</p> : <><p className="text-xs font-display font-extrabold text-ink">{title}: {entry.label || entry.name || entry.week}</p><div className="mt-1 max-h-28 overflow-y-auto pr-1 text-xs text-ink/75">{children}</div></>}
  </div>;
}

function CompactNameList({ names = [], empty = "None" }) {
  return names.length ? <ul className="space-y-0.5">{names.map((name, index) => <li key={`${name}-${index}`} className="truncate">{name}</li>)}</ul> : <p>{empty}</p>;
}

function MissionSourceFilters({ value, onChange }) {
  return <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Mission analytics source">
    {[{ value: "all", label: "All" }, { value: "teacher", label: "Teacher / AI-made" }, { value: "powerup", label: "Daily Power-Up" }].map((option) => <button key={option.value} type="button" onClick={() => onChange(option.value)} className={`rounded-full px-2 py-1 text-[10px] font-display font-bold transition-colors ${value === option.value ? "bg-[var(--uc-purple)] text-white" : option.value === "powerup" ? "bg-[var(--uc-blue-soft)] text-[#287fb6]" : "bg-[var(--uc-purple-soft)] text-[var(--uc-purple)]"}`}>{option.label}</button>)}
  </div>;
}

function QuestionMasteryInsights({ questions = [], onReteach }) {
  const measured = questions.filter((question) => question.total > 0);
  if (!measured.length) return <p className="mt-2 text-xs text-ink/55">Question-level mastery is available after answer details are submitted.</p>;
  const most = measured.reduce((best, question) => question.pct > best.pct ? question : best);
  const least = measured.reduce((worst, question) => question.pct < worst.pct ? question : worst);
  return <div className="mt-2 grid gap-2 sm:grid-cols-2">
    <div className="rounded-lg bg-[var(--uc-green-soft)] px-2 py-1.5 text-xs text-[#477f28]"><span className="font-display font-extrabold">Most mastered · {most.pct}%</span><p className="mt-0.5 line-clamp-2">{most.prompt}</p></div>
    <div className="rounded-lg bg-[#FFF0F3] px-2 py-1.5 text-xs text-[#B94B63]"><span className="font-display font-extrabold">Least mastered · {least.pct}%</span><p className="mt-0.5 line-clamp-2">{least.prompt}</p>{onReteach && <button type="button" className="mt-1 text-[10px] font-display font-extrabold underline" onClick={() => onReteach(least)}>Create reteach mission</button>}</div>
  </div>;
}

export default function TeacherAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("8");
  const [analytics, setAnalytics] = useState({ attendance: [], activities: [], points: [], missions: [] });
  const [hovered, setHovered] = useState({ attendance: null, activities: null, points: null, mastery: null, completion: null });
  const [error, setError] = useState("");
  const [missionSource, setMissionSource] = useState("all");

  function startReteach(question) {
    navigate(ROUTES.TEACHER.MISSIONS, {
      state: {
        intervention: {
          title: "Reteach: key skill check",
          content: question.prompt,
          learning_target: "I can solve this skill accurately and explain my method.",
          prior_knowledge: `This question was least mastered (${question.pct}% correct): ${question.prompt}`,
          assessment_purpose: "reteach",
        },
      },
    });
  }

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const classroom = await getTeacherClassroom(user.id);
      if (!classroom) {
        navigate(ROUTES.TEACHER.ONBOARDING);
        return;
      }
      const [data, teacherMissionCatalog, allDailyPowerUps] = await Promise.all([
      getClassroomDataset(classroom.id, ["groups", "members", "attendance", "scores", "activities", "logs", "missions", "submissions", "badges"]),
      db.entities.Mission.filter({ created_by: user.id }),
      db.entities.Mission.filter({ mission_source: "daily_foundation" }),
      ]);
    const members = data.members || [];
    const groups = data.groups || [];
    const memberNames = Object.fromEntries(members.map((member) => [member.id, fullName(member)]));
    const membersByGroup = new Map();
    for (const member of members) {
      membersByGroup.set(member.group_id, [...(membersByGroup.get(member.group_id) || []), member]);
    }

    // Build the lookups once. The old implementation repeatedly filtered every
    // score and point log for every group/member shown on the charts, which
    // became noticeably slow as a class accumulated a term of entries.
    const activityMaxById = new Map((data.activities || []).map((activity) => [activity.id, Number(activity.max_score) || 0]));
    const scoreTotalsByMember = new Map();
    for (const score of data.scores || []) {
      const max = activityMaxById.get(score.activity_id);
      if (!max) continue;
      const current = scoreTotalsByMember.get(score.group_member_id) || { earned: 0, max: 0 };
      current.earned += Number(score.score) || 0;
      current.max += max;
      scoreTotalsByMember.set(score.group_member_id, current);
    }
    const pointTotalsByGroup = new Map();
    for (const log of data.logs || []) {
      const groupId = log.group_id || "class";
      const current = pointTotalsByGroup.get(groupId) || { points: 0, wholeGroup: 0, wholeGroupDeductions: 0, members: new Map() };
      const points = signedPoints(log);
      current.points += points;
      if (log.event_type === "behavior_penalty") {
        current.wholeGroup += points;
        current.wholeGroupDeductions += points;
      } else if (log.group_member_id) current.members.set(log.group_member_id, (current.members.get(log.group_member_id) || 0) + points);
      else {
        current.wholeGroup += points;
      }
      pointTotalsByGroup.set(groupId, current);
    }

    const attendanceByWeek = {};
    for (const record of data.attendance || []) {
      const key = weekKey(record.attendance_date);
      if (!attendanceByWeek[key]) attendanceByWeek[key] = { week: key.slice(5), label: `Week of ${key}`, present: 0, absent: 0, total: 0, presentNames: [], absentNames: [] };
      const target = attendanceByWeek[key];
      target.total += 1;
      if (record.status === "present") { target.present += 1; target.presentNames.push(memberNames[record.group_member_id] || "Student"); }
      else { target.absent += 1; target.absentNames.push(memberNames[record.group_member_id] || "Student"); }
    }
    const attendance = Object.values(attendanceByWeek).sort((a, b) => a.label.localeCompare(b.label)).map((item) => ({ ...item, rate: item.total ? Math.round((item.present / item.total) * 100) : 0 }));

    const badgeIconsByGroup = new Map();
    for (const badge of getGroupBadgeItems(data.badges || [])) {
      badgeIconsByGroup.set(badge.group_id, [...(badgeIconsByGroup.get(badge.group_id) || []), badge.icon]);
    }
    const groupSets = classroom.uses_groups ? groups.slice().sort((a, b) => a.group_number - b.group_number).map((group) => ({ id: group.id, name: `Group ${group.group_number}${badgeIconsByGroup.has(group.id) ? ` ${badgeIconsByGroup.get(group.id).join(" ")}` : ""}`, members: membersByGroup.get(group.id) || [] })) : [{ id: "class", name: "Whole class", members }];
    const activities = groupSets.map((set) => {
      const studentScores = set.members.map((member) => {
        const totals = scoreTotalsByMember.get(member.id) || { earned: 0, max: 0 };
        const { earned, max } = totals;
        const rate = max ? Math.round((earned / max) * 100) : null;
        return { name: memberNames[member.id] || "Student", rate, earned, max, status: rate === null ? "Not enough data" : learningStatus(rate) };
      });
      const scored = studentScores.filter((item) => item.rate !== null);
      return { name: set.name, label: set.name, rate: scored.length ? Math.round(scored.reduce((sum, item) => sum + item.rate, 0) / scored.length) : 0, students: scored };
    });

    const points = groupSets.map((set) => {
      const totals = classroom.uses_groups
        ? pointTotalsByGroup.get(set.id) || { points: 0, wholeGroup: 0, wholeGroupDeductions: 0, members: new Map() }
        : Array.from(pointTotalsByGroup.values()).reduce((all, current) => {
          all.points += current.points;
          all.wholeGroup += current.wholeGroup;
          all.wholeGroupDeductions += current.wholeGroupDeductions;
          for (const [memberId, points] of current.members) all.members.set(memberId, (all.members.get(memberId) || 0) + points);
          return all;
        }, { points: 0, wholeGroup: 0, wholeGroupDeductions: 0, members: new Map() });
      const students = set.members.map((member) => ({ name: memberNames[member.id] || "Student", points: totals.members.get(member.id) || 0 })).filter((item) => item.points !== 0).sort((a, b) => b.points - a.points);
      return { name: set.name, label: set.name, points: totals.points, students, wholeGroup: totals.wholeGroup, wholeGroupDeductions: totals.wholeGroupDeductions };
    });

    // Archive records are intentionally part of analytics. Teacher-created
    // missions can target several classrooms, while Daily Power-Ups are global.
    // Bring in archived teacher/AI missions targeted at this class and archived
    // Power-Ups that have submissions from this class.
    const submittedMissionIds = new Set((data.submissions || []).map((submission) => submission.mission_id));
    const missionById = new Map((data.missions || []).map((mission) => [mission.id, mission]));
    for (const mission of teacherMissionCatalog || []) {
      if (missionTargetsClass(mission, classroom.id)) missionById.set(mission.id, mission);
    }
    for (const powerUp of allDailyPowerUps || []) {
      if (submittedMissionIds.has(powerUp.id)) missionById.set(powerUp.id, powerUp);
    }
    const missions = [...missionById.values()].map((mission) => {
      const progress = getMissionProgress(mission, data.submissions || [], groups, members);
      const completedIds = new Set(progress.submissions.map((submission) => progress.individual ? submission.group_member_id : submission.group_id));
      const targets = progress.individual ? members : groups;
      const submittedNames = progress.submissions.map((submission) => progress.individual ? memberNames[submission.group_member_id] || "Student" : `Group ${groups.find((group) => group.id === submission.group_id)?.group_number || ""}`);
      const pendingNames = targets.filter((target) => !completedIds.has(target.id)).map((target) => progress.individual ? memberNames[target.id] || "Student" : `Group ${target.group_number}`);
      const powerUp = isDailyFoundationMission(mission);
      const label = powerUp ? `Daily Power-Up · ${mission.auto_daily_date || mission.title || "Practice"}` : mission.title || "Teacher mission";
      const questions = questionMastery(mission, data.submissions || []);
      return { name: powerUp ? `Power-Up ${mission.auto_daily_date?.slice(5) || ""}` : shortTitle(mission.title), label, source: powerUp ? "Daily Power-Up" : "Teacher mission", archived: Boolean(mission.archived_at), mastery: progress.accuracy, completion: progress.completion, completed: progress.completed, total: progress.total, submittedNames, pendingNames, questions };
    });

      setAnalytics({ attendance, activities, points, missions });
    } catch (loadError) {
      console.error("Teacher analytics could not be loaded", loadError);
      setError("Analytics could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const visibleAttendance = useMemo(() => range === "all" ? analytics.attendance : analytics.attendance.slice(-Number(range)), [analytics.attendance, range]);
  const visibleMissions = useMemo(() => analytics.missions.filter((mission) => missionSource === "all" || (missionSource === "powerup" ? mission.source === "Daily Power-Up" : mission.source === "Teacher mission")), [analytics.missions, missionSource]);
  const selectChart = (key) => (state) => {
    const selected = state?.activePayload?.[0]?.payload;
    if (!selected) return;
    setHovered((current) => ({ ...current, [key]: current[key] === selected ? null : selected }));
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" /></div>;
  if (error) return <ClayCard className="mx-auto max-w-xl p-6 text-center"><p className="font-display font-bold text-[var(--uc-navy-950)]">{error}</p><button type="button" onClick={load} className="mt-3 rounded-xl bg-[var(--uc-purple)] px-4 py-2 text-sm font-display font-bold text-white">Try again</button></ClayCard>;
  const chartProps = (key) => ({ onClick: selectChart(key), style: { cursor: "pointer" } });

  return <div className="mx-auto max-w-4xl space-y-5">
    <div><h1 className="flex items-center gap-2 text-2xl font-display font-extrabold"><BarChart3 className="h-6 w-6" /> Teacher analytics</h1><p className="mt-1 text-sm text-ink/60">Select any bar to open a contained student or group breakdown below it.</p></div>

    <ClayCard className="p-4"><div className="mb-2 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-display font-bold"><ClipboardCheck className="h-4 w-4" /> Attendance rate</h2><select aria-label="Analytics date range" className="clay-input w-auto py-1 text-xs" value={range} onChange={(event) => setRange(event.target.value)}><option value="4">4 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option><option value="all">All</option></select></div>{visibleAttendance.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={visibleAttendance} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("attendance")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="week" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#8B5CF61A" }} /><Bar dataKey="rate" fill="#8B5CF6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No attendance recorded yet.</p>}<ContainedDetail title="Attendance" entry={hovered.attendance}><div className="grid grid-cols-2 gap-3"><div><p className="font-display font-bold text-clay-lime">Present ({hovered.attendance?.present || 0})</p><CompactNameList names={hovered.attendance?.presentNames} /></div><div><p className="font-display font-bold text-clay-coral">Absent ({hovered.attendance?.absent || 0})</p><CompactNameList names={hovered.attendance?.absentNames} /></div></div></ContainedDetail></ClayCard>

    <ClayCard className="p-4"><h2 className="mb-2 flex items-center gap-2 text-sm font-display font-bold"><TrendingUp className="h-4 w-4" /> Activity score average</h2>{analytics.activities.some((item) => item.rate > 0) ? <ResponsiveContainer width="100%" height={160}><BarChart data={analytics.activities} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("activities")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#4FD1F21A" }} /><Bar dataKey="rate" fill="#4FD1F2" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No activity scores recorded yet.</p>}<ContainedDetail title="Activity scores" entry={hovered.activities}>{hovered.activities?.students?.length ? <div><div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 border-b border-ink/10 pb-1 text-[10px] font-display font-extrabold text-ink/55"><span>Student</span><span>Score · Average</span><span>Status</span></div><ul className="mt-1 space-y-1">{hovered.activities.students.map((student) => <li key={student.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2"><span className="truncate">{student.name}</span><span className="shrink-0 font-mono">{student.earned}/{student.max} · {student.rate}%</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-display font-bold ${learningStatusClass[student.status] || "bg-ink/5 text-ink/60"}`}>{student.status}</span></li>)}</ul></div> : <p>No scores for this group yet.</p>}</ContainedDetail></ClayCard>

    <ClayCard className="p-4"><h2 className="mb-2 flex items-center gap-2 text-sm font-display font-bold"><Medal className="h-4 w-4" /> Participation points</h2>{analytics.points.some((item) => item.points !== 0) ? <ResponsiveContainer width="100%" height={160}><BarChart data={analytics.points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("points")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#FF5FA81A" }} /><Bar dataKey="points" fill="#FF5FA8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No participation points logged yet.</p>}<ContainedDetail title="Participation points" entry={hovered.points}><p className="font-display font-bold">Whole Group: {hovered.points?.wholeGroup || 0} points</p>{hovered.points?.wholeGroupDeductions < 0 && <p className="mt-1 text-xs font-display font-bold text-clay-coral">Whole-group deductions: {hovered.points.wholeGroupDeductions} · personal points are unchanged</p>}{hovered.points?.students?.length ? <ul className="mt-1 space-y-0.5">{hovered.points.students.map((student) => <li key={student.name} className="flex justify-between gap-3"><span className="truncate">{student.name}</span><span className="font-mono">{student.points}</span></li>)}</ul> : <p className="mt-1">No individual point entries.</p>}<p className="mt-2 border-t border-ink/10 pt-1 font-display font-extrabold">Group total: {hovered.points?.points || 0} points</p></ContainedDetail></ClayCard>

    <div className="grid gap-4 lg:grid-cols-2">
      <ClayCard className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-display font-bold"><Target className="h-4 w-4" /> Mission mastery</h2>
        <p className="mt-1 text-xs text-ink/55">Accuracy across active and archived teacher/AI missions and Daily Power-Ups.</p>
        <MissionSourceFilters value={missionSource} onChange={setMissionSource} />
        {visibleMissions.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={visibleMissions} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("mastery")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#80C94B1A" }} /><Bar dataKey="mastery" radius={[8, 8, 2, 2]}>{visibleMissions.map((mission) => <Cell key={mission.label} fill={mission.source === "Daily Power-Up" ? "#42A9E8" : "#80C94B"} />)}</Bar></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No {missionSource === "powerup" ? "Daily Power-Up" : "teacher or AI-made mission"} data in this class yet.</p>}
        <ContainedDetail title="Mission mastery" entry={hovered.mastery}><p><span className="font-display font-bold">Source:</span> {hovered.mastery?.source || "Teacher mission"}{hovered.mastery?.archived ? " · Archived" : ""}</p><p className="mt-1"><span className="font-display font-bold">Accuracy:</span> {hovered.mastery?.mastery || 0}%</p><p className="mt-1"><span className="font-display font-bold">Submitted:</span> {hovered.mastery?.submittedNames?.join(", ") || "None"}</p><QuestionMasteryInsights questions={hovered.mastery?.questions} onReteach={startReteach} /></ContainedDetail>
      </ClayCard>
      <ClayCard className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-display font-bold"><CheckCircle2 className="h-4 w-4" /> Mission completion rate</h2>
        <p className="mt-1 text-xs text-ink/55">Completion across active and archived teacher/AI missions and Daily Power-Ups.</p>
        <MissionSourceFilters value={missionSource} onChange={setMissionSource} />
        {visibleMissions.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={visibleMissions} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("completion")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#6C55D91A" }} /><Bar dataKey="completion" radius={[8, 8, 2, 2]}>{visibleMissions.map((mission) => <Cell key={mission.label} fill={mission.source === "Daily Power-Up" ? "#42A9E8" : "#6C55D9"} />)}</Bar></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No {missionSource === "powerup" ? "Daily Power-Up" : "teacher or AI-made mission"} data in this class yet.</p>}
        <ContainedDetail title="Mission completion" entry={hovered.completion}><p><span className="font-display font-bold">Source:</span> {hovered.completion?.source || "Teacher mission"}{hovered.completion?.archived ? " · Archived" : ""}</p><p className="mt-1"><span className="font-display font-bold">Completed:</span> {hovered.completion?.completed || 0}/{hovered.completion?.total || 0}</p><p className="mt-1"><span className="font-display font-bold">Still pending:</span> {hovered.completion?.pendingNames?.join(", ") || "None"}</p></ContainedDetail>
      </ClayCard>
    </div>
  </div>;
}
