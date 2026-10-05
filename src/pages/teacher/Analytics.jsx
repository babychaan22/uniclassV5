import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, CheckCircle2, ClipboardCheck, Medal, Target, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset } from "@/lib/teacherClassroom";
import { getMissionProgress } from "@/lib/missionProgress";
import { ROUTES } from "@/lib/routes";
import ClayCard from "@/components/ClayCard";
import { getGroupBadgeItems } from "@/lib/groupBadges";

const fullName = (member) => [member?.last_name, member?.first_name].filter(Boolean).join(", ") || "Student";
const shortTitle = (title, max = 15) => title?.length > max ? `${title.slice(0, max - 1)}…` : (title || "Mission");
const logPoints = (log) => {
  const points = Number(log?.points_awarded) || 0;
  return log?.event_type === "behavior_penalty" ? -Math.abs(points) : points;
};

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

export default function TeacherAnalytics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("8");
  const [analytics, setAnalytics] = useState({ attendance: [], activities: [], points: [], missions: [] });
  const [hovered, setHovered] = useState({ attendance: null, activities: null, points: null, mastery: null, completion: null });

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    setLoading(true);
    const classroom = await getTeacherClassroom(user.id);
    if (!classroom) {
      navigate(ROUTES.TEACHER.ONBOARDING);
      return;
    }
    const data = await getClassroomDataset(classroom.id, ["groups", "members", "attendance", "scores", "activities", "logs", "missions", "submissions", "badges"]);
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
      const current = pointTotalsByGroup.get(groupId) || { points: 0, wholeGroup: 0, members: new Map() };
      const points = logPoints(log);
      current.points += points;
      if (log.group_member_id) current.members.set(log.group_member_id, (current.members.get(log.group_member_id) || 0) + points);
      else current.wholeGroup += points;
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
        return { name: memberNames[member.id] || "Student", rate: max ? Math.round((earned / max) * 100) : null, earned, max };
      });
      const scored = studentScores.filter((item) => item.rate !== null);
      return { name: set.name, label: set.name, rate: scored.length ? Math.round(scored.reduce((sum, item) => sum + item.rate, 0) / scored.length) : 0, students: scored };
    });

    const points = groupSets.map((set) => {
      const totals = classroom.uses_groups
        ? pointTotalsByGroup.get(set.id) || { points: 0, wholeGroup: 0, members: new Map() }
        : Array.from(pointTotalsByGroup.values()).reduce((all, current) => {
          all.points += current.points;
          all.wholeGroup += current.wholeGroup;
          for (const [memberId, points] of current.members) all.members.set(memberId, (all.members.get(memberId) || 0) + points);
          return all;
        }, { points: 0, wholeGroup: 0, members: new Map() });
      const students = set.members.map((member) => ({ name: memberNames[member.id] || "Student", points: totals.members.get(member.id) || 0 })).filter((item) => item.points !== 0).sort((a, b) => b.points - a.points);
      return { name: set.name, label: set.name, points: totals.points, students, wholeGroup: totals.wholeGroup };
    });

    const missions = (data.missions || []).map((mission) => {
      const progress = getMissionProgress(mission, data.submissions || [], groups, members);
      const completedIds = new Set(progress.submissions.map((submission) => progress.individual ? submission.group_member_id : submission.group_id));
      const targets = progress.individual ? members : groups;
      const submittedNames = progress.submissions.map((submission) => progress.individual ? memberNames[submission.group_member_id] || "Student" : `Group ${groups.find((group) => group.id === submission.group_id)?.group_number || ""}`);
      const pendingNames = targets.filter((target) => !completedIds.has(target.id)).map((target) => progress.individual ? memberNames[target.id] || "Student" : `Group ${target.group_number}`);
      return { name: shortTitle(mission.title), label: mission.title || "Mission", mastery: progress.accuracy, completion: progress.completion, completed: progress.completed, total: progress.total, submittedNames, pendingNames };
    });

    setAnalytics({ attendance, activities, points, missions });
    setLoading(false);
  }

  const visibleAttendance = useMemo(() => range === "all" ? analytics.attendance : analytics.attendance.slice(-Number(range)), [analytics.attendance, range]);
  const selectChart = (key) => (state) => {
    const selected = state?.activePayload?.[0]?.payload;
    if (!selected) return;
    setHovered((current) => ({ ...current, [key]: current[key] === selected ? null : selected }));
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-clay-purple border-t-transparent" /></div>;
  const chartProps = (key) => ({ onClick: selectChart(key), style: { cursor: "pointer" } });

  return <div className="mx-auto max-w-4xl space-y-5">
    <div><h1 className="flex items-center gap-2 text-2xl font-display font-extrabold"><BarChart3 className="h-6 w-6" /> Teacher analytics</h1><p className="mt-1 text-sm text-ink/60">Select any bar to open a contained student or group breakdown below it.</p></div>

    <ClayCard className="p-4"><div className="mb-2 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-sm font-display font-bold"><ClipboardCheck className="h-4 w-4" /> Attendance rate</h2><select aria-label="Analytics date range" className="clay-input w-auto py-1 text-xs" value={range} onChange={(event) => setRange(event.target.value)}><option value="4">4 weeks</option><option value="8">8 weeks</option><option value="12">12 weeks</option><option value="all">All</option></select></div>{visibleAttendance.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={visibleAttendance} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("attendance")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="week" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#8B5CF61A" }} /><Bar dataKey="rate" fill="#8B5CF6" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No attendance recorded yet.</p>}<ContainedDetail title="Attendance" entry={hovered.attendance}><div className="grid grid-cols-2 gap-3"><div><p className="font-display font-bold text-clay-lime">Present ({hovered.attendance?.present || 0})</p><CompactNameList names={hovered.attendance?.presentNames} /></div><div><p className="font-display font-bold text-clay-coral">Absent ({hovered.attendance?.absent || 0})</p><CompactNameList names={hovered.attendance?.absentNames} /></div></div></ContainedDetail></ClayCard>

    <ClayCard className="p-4"><h2 className="mb-2 flex items-center gap-2 text-sm font-display font-bold"><TrendingUp className="h-4 w-4" /> Activity score average</h2>{analytics.activities.some((item) => item.rate > 0) ? <ResponsiveContainer width="100%" height={160}><BarChart data={analytics.activities} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("activities")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#4FD1F21A" }} /><Bar dataKey="rate" fill="#4FD1F2" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No activity scores recorded yet.</p>}<ContainedDetail title="Activity scores" entry={hovered.activities}>{hovered.activities?.students?.length ? <ul className="space-y-0.5">{hovered.activities.students.map((student) => <li key={student.name} className="flex justify-between gap-3"><span className="truncate">{student.name}</span><span className="shrink-0 font-mono">{student.earned}/{student.max} · {student.rate}%</span></li>)}</ul> : <p>No scores for this group yet.</p>}</ContainedDetail></ClayCard>

    <ClayCard className="p-4"><h2 className="mb-2 flex items-center gap-2 text-sm font-display font-bold"><Medal className="h-4 w-4" /> Participation points</h2>{analytics.points.some((item) => item.points !== 0) ? <ResponsiveContainer width="100%" height={160}><BarChart data={analytics.points} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("points")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#FF5FA81A" }} /><Bar dataKey="points" fill="#FF5FA8" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No participation points logged yet.</p>}<ContainedDetail title="Participation points" entry={hovered.points}><p className="font-display font-bold">Whole Group: {hovered.points?.wholeGroup || 0} points</p>{hovered.points?.students?.length ? <ul className="mt-1 space-y-0.5">{hovered.points.students.map((student) => <li key={student.name} className="flex justify-between gap-3"><span className="truncate">{student.name}</span><span className="font-mono">{student.points}</span></li>)}</ul> : <p className="mt-1">No individual point entries.</p>}<p className="mt-2 border-t border-ink/10 pt-1 font-display font-extrabold">Group total: {hovered.points?.points || 0} points</p></ContainedDetail></ClayCard>

    <div className="grid gap-4 lg:grid-cols-2"><ClayCard className="p-4"><h2 className="mb-2 flex items-center gap-2 text-sm font-display font-bold"><Target className="h-4 w-4" /> Mission mastery</h2>{analytics.missions.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={analytics.missions} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("mastery")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#A6E22E1A" }} /><Bar dataKey="mastery" fill="#A6E22E" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No missions yet.</p>}<ContainedDetail title="Mission mastery" entry={hovered.mastery}><p><span className="font-display font-bold">Accuracy:</span> {hovered.mastery?.mastery || 0}%</p><p className="mt-1"><span className="font-display font-bold">Submitted:</span> {hovered.mastery?.submittedNames?.join(", ") || "None"}</p></ContainedDetail></ClayCard><ClayCard className="p-4"><h2 className="mb-2 flex items-center gap-2 text-sm font-display font-bold"><CheckCircle2 className="h-4 w-4" /> Mission completion rate</h2>{analytics.missions.length ? <ResponsiveContainer width="100%" height={160}><BarChart data={analytics.missions} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} {...chartProps("completion")}><CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#17162B18" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip content={() => null} cursor={{ fill: "#FFD93D1A" }} /><Bar dataKey="completion" fill="#FFD93D" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="py-6 text-center text-sm text-ink/50">No missions yet.</p>}<ContainedDetail title="Mission completion" entry={hovered.completion}><p><span className="font-display font-bold">Completed:</span> {hovered.completion?.completed || 0}/{hovered.completion?.total || 0}</p><p className="mt-1"><span className="font-display font-bold">Still pending:</span> {hovered.completion?.pendingNames?.join(", ") || "None"}</p></ContainedDetail></ClayCard></div>
  </div>;
}
