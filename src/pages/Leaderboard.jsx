
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Trophy, Target } from "lucide-react";
import { ROUTES } from '@/lib/routes';
import { getTeacherClassroom } from '@/lib/teacherClassroom';

export default function Leaderboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

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
    const [groups, logs, submissions] = await Promise.all([
      db.entities.Group.filter({ classroom_id: c.id }),
      db.entities.ParticipationLog.filter({ classroom_id: c.id }),
      db.entities.MissionSubmission.filter({ classroom_id: c.id }),
    ]);
    const rows = groups.map((g) => {
      const pts = logs
        .filter((l) => l.group_id === g.id)
        .reduce((s, l) => s + (l.event_type === "behavior_penalty" ? -Math.abs(l.points_awarded || 0) : (l.points_awarded || 0)), 0);
      const missions = submissions.filter((s) => s.group_id === g.id).length;
      return { group: g, points: Math.round(pts), missions };
    }).sort((a, b) => b.points - a.points || b.missions - a.missions);
    setRows(rows);
    setLoading(false);
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;
  const max = Math.max(...rows.map((r) => r.points), 1);

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-display font-extrabold mb-1 flex items-center gap-2"><Trophy className="w-6 h-6" /> Student Leaderboard</h1>
        <p className="text-ink/60 text-sm">Every group in the selected class, ranked by participation points and mission completions.</p>
      </div>

      <div className="space-y-2">
        {rows.map((r, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
          return (
            <ClayCard key={r.group.id} className={`p-4 ${i < 3 ? "border-clay-sun" : ""}`}>
              <div className="flex items-center gap-3">
                <span className="font-mono font-extrabold text-lg w-8 text-center">{medal || i + 1}</span>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="font-display font-bold">Group {r.group.group_number}</span>
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
    </div>
  );
}
