
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import { Trophy, Target } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import { getTeacherClassroom } from '@/lib/teacherClassroom';
import { computeParticipationPoints, signedPoints } from '@/lib/stats';

export default function Leaderboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [studentRows, setStudentRows] = useState([]);
  const [badgeData, setBadgeData] = useState({ badges: [], badgeDefinitions: [] });

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('uniclass-teacher-class-changed', refresh);
    return () => window.removeEventListener('uniclass-teacher-class-changed', refresh);
  }, [user]);

  async function load() {
    if (!user) return;
    const c = await getTeacherClassroom(user.id);
    if (!c) { navigate(ROUTES.TEACHER.ONBOARDING); return; }
    const [groups, members, logs, submissions, badges, badgeDefinitions] = await Promise.all([
      db.entities.Group.filter({ classroom_id: c.id }),
      db.entities.GroupMember.filter({ classroom_id: c.id }),
      db.entities.ParticipationLog.filter({ classroom_id: c.id }),
      db.entities.MissionSubmission.filter({ classroom_id: c.id }),
      db.entities.Badge.filter({ classroom_id: c.id }),
      db.entities.BadgeDefinition.filter({ classroom_id: c.id }),
    ]);
    const rows = groups.map((g) => {
      const pts = logs
        .filter((l) => l.group_id === g.id)
        .reduce((s, l) => s + signedPoints(l), 0);
      const missions = submissions.filter((s) => s.group_id === g.id).length;
      return { group: g, points: Math.round(pts), missions };
    }).sort((a, b) => b.points - a.points || b.missions - a.missions);
    const students = members.map((member) => {
      const points = computeParticipationPoints(member.id, logs, member.group_id);
      const missions = submissions.filter((submission) => submission.group_member_id === member.id).length;
      return { member, points: Math.round(points), missions };
    }).sort((a, b) => b.points - a.points || b.missions - a.missions);
    setRows(rows);
    setStudentRows(students);
    setBadgeData({ badges, badgeDefinitions });
    setLoading(false);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  const max = Math.max(...rows.map((r) => r.points), 1);
  const maxStudent = Math.max(...studentRows.map((r) => r.points), 1);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Trophy className="w-6 h-6" /> Class Leaderboard</h1>
        <p className="text-ink/60 text-sm">Groups and individual students are ranked within the selected class.</p>
      </div>

      <h2 className="font-display font-bold text-lg">Group ranking</h2>
      <div className="space-y-2">
        {rows.map((r, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
          return (
            <ClayCard key={r.group.id} className={`p-4 ${i < 3 ? "border-clay-sun" : ""}`}>
              <div className="flex items-center gap-3">
                <span className="font-mono font-extrabold text-lg w-8 text-center">{medal || i + 1}</span>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="inline-flex items-center gap-1 font-display font-bold">Group {r.group.group_number} <GroupBadgeMarkers groupId={r.group.id} badges={badgeData.badges} definitions={badgeData.badgeDefinitions} /></span>
                    <span className="font-mono text-sm">{r.points} pts</span>
                  </div>
                  <div className="h-5 rounded-full border-2 border-ink bg-cream overflow-hidden">
                    <div className={`h-full ${i === 0 ? "bg-clay-sun" : "bg-clay-purple"}`} style={{ width: `${(r.points / max) * 100}%` }} />
                  </div>
                </div>
                <ClayChip color="purple"><Target className="w-3 h-3" /> {r.missions}</ClayChip>
              </div>
            </ClayCard>
          );
        })}
      </div>

      <h2 className="font-display font-bold text-lg pt-2">Individual ranking</h2>
      <div className="space-y-2">
        {studentRows.map((r, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
          return <ClayCard key={r.member.id} className={`p-4 ${i < 3 ? 'border-clay-sun' : ''}`}><div className="flex items-center gap-3"><span className="font-mono font-extrabold text-lg w-8 text-center">{medal || i + 1}</span><div className="flex-1"><div className="mb-1 flex justify-between"><span className="font-display font-bold">{r.member.last_name}, {r.member.first_name}</span><span className="font-mono text-sm">{r.points} pts</span></div><div className="h-5 overflow-hidden rounded-full border-2 border-ink bg-cream"><div className={`h-full ${i === 0 ? 'bg-clay-sun' : 'bg-clay-sky'}`} style={{ width: `${(r.points / maxStudent) * 100}%` }} /></div></div><ClayChip color="purple"><Target className="w-3 h-3" /> {r.missions}</ClayChip></div></ClayCard>;
        })}
        {studentRows.length === 0 && <p className="text-center text-sm text-ink/50">No individual points yet.</p>}
      </div>
    </div>
  );
}
