
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getTeacherClassroom, getClassroomDataset } from "@/lib/teacherClassroom";
import { missionTargetsClass } from "@/lib/missionAudience";
import { formatMissionDeadline, getMissionProgress } from "@/lib/missionProgress";

import ClayCard from "@/components/ClayCard";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import ClayChip from "@/components/ClayChip";
import { Archive, Target, TrendingUp } from "lucide-react";
import { ROUTES } from '@/lib/routes';

export default function MissionArchive() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [missions, setMissions] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const [ds, catalog] = await Promise.all([
      getClassroomDataset(c.id, ['groups','members','submissions']),
      db.entities.Mission.filter({ created_by: user.id }),
    ]);
    setMissions(catalog.filter((mission) => missionTargetsClass(mission, c.id)).sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")));
    setSubmissions(ds.submissions);
    setGroups(ds.groups);
    setMembers(ds.members);
    setLoading(false);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Archive className="w-6 h-6" /> Mission Archive</h1>
        <p className="text-ink/60 text-sm">Review completed missions and their results.</p>
      </div>

      {missions.length === 0 && <p className="text-ink/50 text-sm text-center">No missions yet.</p>}

      {missions.map((m) => {
        const progress = getMissionProgress(m, submissions, groups, members);
        const subs = progress.submissions;
        const avg = subs.length ? (subs.reduce((a, s) => a + s.score, 0) / subs.length).toFixed(1) : "—";
        return (
          <ClayCard key={m.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display font-bold">{m.title}</p>
                {m.description && <p className="text-xs text-ink/60 mt-0.5 truncate">{m.description}</p>}
                <div className="flex flex-wrap gap-2 mt-2">
                  <ClayChip color="purple">{m.formative_type?.replace("_", " ")}</ClayChip>
                  <ClayChip color="sun">+{m.xp_reward} XP</ClayChip>
                  {formatMissionDeadline(m) && <ClayChip color="sky">Due {formatMissionDeadline(m)}</ClayChip>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono font-extrabold text-lg">{avg}/{m.max_score}</p>
                <p className="text-[10px] font-display font-bold">AVG SCORE</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border-2 border-ink/15 bg-cream p-2">
                <Target className="w-4 h-4 mx-auto text-clay-purple" />
                <p className="font-mono font-bold">{progress.completed}/{progress.total}</p>
                <p className="text-[10px] font-display">{progress.individual ? 'STUDENTS DONE' : 'GROUPS DONE'}</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-cream p-2">
                <TrendingUp className="w-4 h-4 mx-auto text-clay-lime" />
                <p className="font-mono font-bold">{progress.completion}%</p>
                <p className="text-[10px] font-display">COMPLETION</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-cream p-2">
                <TrendingUp className="w-4 h-4 mx-auto text-clay-pink" />
                <p className="font-mono font-bold">{progress.accuracy}%</p>
                <p className="text-[10px] font-display">ACCURACY</p>
              </div>
            </div>
            {progress.individual && <details className="mt-3 rounded-xl border-2 border-ink/15 bg-cream px-3 py-2"><summary className="cursor-pointer text-xs font-display font-bold">View answered and not-yet-answered students by group</summary><div className="mt-2 space-y-2">{groups.map((group) => {
              const groupMembers = members.filter((member) => member.group_id === group.id);
              const answeredIds = new Set(progress.submissions.filter((submission) => submission.group_id === group.id).map((submission) => submission.group_member_id));
              const answered = groupMembers.filter((member) => answeredIds.has(member.id));
              const waiting = groupMembers.filter((member) => !answeredIds.has(member.id));
              return <div key={group.id} className="text-xs"><p className="inline-flex items-center gap-1 font-display font-bold">Group {group.group_number} <GroupBadgeMarkers groupId={group.id} /></p><p className="text-clay-lime">Answered: {answered.length ? answered.map((member) => `${member.last_name}, ${member.first_name}`).join(' · ') : 'None'}</p><p className="text-clay-coral">Not answered: {waiting.length ? waiting.map((member) => `${member.last_name}, ${member.first_name}`).join(' · ') : 'None'}</p></div>;
            })}</div></details>}
          </ClayCard>
        );
      })}
    </div>
  );
}
