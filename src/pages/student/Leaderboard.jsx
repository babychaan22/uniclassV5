
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Trophy, Sparkles, Crown, Medal, Flame, Users } from "lucide-react";
import { computeActivityPct, computeParticipationPoints } from "@/lib/stats";
import { ROUTES } from '@/lib/routes';
import { getActiveStudentAccount } from '@/lib/studentContext';

export default function StudentLeaderboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("groups");

  useEffect(() => { load(); }, [user]);

  async function load() {
    if (!user) return;
    const account = await getActiveStudentAccount(user.id);
    if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
    const group = await db.entities.Group.get(account.group_id);
    const classroomId = group.classroom_id;
    const [allGroups, allMembers, logs, scores, activities, subs] = await Promise.all([
      db.entities.Group.filter({ classroom_id: classroomId }),
      db.entities.GroupMember.filter({ classroom_id: classroomId }),
      db.entities.ParticipationLog.filter({ classroom_id: classroomId }),
      db.entities.ActivityScore.filter({ classroom_id: classroomId }),
      db.entities.Activity.filter({ classroom_id: classroomId }),
      db.entities.MissionSubmission.filter({ classroom_id: classroomId }),
    ]);

    const groupRows = allGroups.map((g) => {
      const pts = logs.filter((l) => l.group_id === g.id)
        .reduce((s, l) => s + (l.event_type === "behavior_penalty" ? -Math.abs(l.points_awarded || 0) : l.points_awarded || 0), 0);
      const gm = allMembers.filter((m) => m.group_id === g.id);
      const avg = gm.length > 0 ? gm.reduce((s, m) => s + computeActivityPct(m.id, scores, activities).pct, 0) / gm.length : 0;
      const missionsDone = subs.filter((s) => s.group_id === g.id).length;
      return { group: g, pts: Math.round(pts), avg: Math.round(avg), members: gm.length, missionsDone };
    }).sort((a, b) => b.pts - a.pts);

    const indRows = allMembers
      .map((m) => ({ member: m, points: computeParticipationPoints(m.id, logs), groupName: allGroups.find((g) => g.id === m.group_id)?.group_name || "" }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 12);

    const myMember = allMembers.find((m) => m.id === account.group_member_id) || allMembers.find((m) => m.group_id === group.id && m.is_account_holder);
    setData({ group, groupRows, indRows, myMemberId: myMember?.id });
  }

  if (!data) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  const { group, groupRows, indRows, myMemberId } = data;
  const myRank = groupRows.findIndex((r) => r.group.id === group.id) + 1;
  const maxPts = Math.max(...groupRows.map((r) => r.pts), 1);
  const maxInd = Math.max(...indRows.map((r) => r.points), 1);
  const podium = groupRows.slice(0, 3);
  const podiumOrder = [1, 0, 2]; // visual order: 2nd, 1st, 3rd
  const medal = ["🥇", "🥈", "🥉"];
  const podiumColor = ["bg-clay-sun", "bg-clay-purple text-white", "bg-clay-coral text-white"];

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <ClayCard color="purple" className="p-5 text-center">
        <div className="clay-medallion bg-clay-sun w-16 h-16 mx-auto flex items-center justify-center mb-2">
          <Trophy className="w-8 h-8 text-clay-coral" />
        </div>
        <h1 className="text-2xl font-display font-extrabold text-white">Class Leaderboard</h1>
        <p className="text-white/80 text-sm">Climb the ranks, earn XP, and lead your group to glory! 🚀</p>
        {myRank > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 clay-chip px-3 py-1 bg-clay-pink text-white">
            <Crown className="w-4 h-4" /> Your group ranks #{myRank} of {groupRows.length}
          </div>
        )}
      </ClayCard>

      <div className="flex gap-2">
        <button onClick={() => setTab("groups")} className={`clay-btn px-4 py-2 text-sm ${tab === "groups" ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}><Users className="w-4 h-4" /> Groups</button>
        <button onClick={() => setTab("individuals")} className={`clay-btn px-4 py-2 text-sm ${tab === "individuals" ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}><Flame className="w-4 h-4" /> Top Students</button>
      </div>

      {tab === "groups" && (
        <>
          {podium.length > 0 && (
            <div className="grid grid-cols-3 gap-2 items-end">
              {podiumOrder.map((idx) => {
                const r = podium[idx];
                if (!r) return <div key={idx} />;
                const place = idx;
                // podiumOrder is [2nd, 1st, 3rd], so height must follow rank.
                const heights = ["h-32", "h-24", "h-20"];
                return (
                  <div key={r.group.id} className="text-center">
                    <div className="text-3xl mb-1">{medal[place]}</div>
                    <div className={`${podiumColor[place]} ${heights[place]} rounded-t-2xl border-[3px] border-ink flex flex-col items-center justify-center shadow-[3px_3px_0_#17162B]`}>
                      <p className="font-display font-extrabold">G{r.group.group_number}</p>
                      <p className="font-mono font-bold text-lg">{r.pts}</p>
                      <p className="text-[10px] font-display opacity-80">pts</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <ClayCard className="p-4">
            <h2 className="font-display font-bold text-sm mb-3">All Groups</h2>
            <div className="space-y-2">
              {groupRows.map((r, i) => {
                const isMe = r.group.id === group.id;
                return (
                  <div key={r.group.id} className="flex items-center gap-3">
                    <span className="font-mono font-bold w-6 text-center">{i + 1}</span>
                    <div className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className={`font-display font-bold text-sm ${isMe ? "text-clay-pink" : ""}`}>Group {r.group.group_number} {isMe && "· You"}</span>
                        <span className="font-mono text-sm">{r.pts} pts · {r.avg}%</span>
                      </div>
                      <div className="h-5 rounded-full border-2 border-ink bg-cream overflow-hidden">
                        <div className={`h-full rounded-full ${isMe ? "bg-clay-pink" : "bg-clay-purple"}`} style={{ width: `${(r.pts / maxPts) * 100}%` }} />
                      </div>
                    </div>
                    {r.missionsDone > 0 && <ClayChip color="sun"><Medal className="w-3 h-3" /> {r.missionsDone}</ClayChip>}
                  </div>
                );
              })}
            </div>
          </ClayCard>
        </>
      )}

      {tab === "individuals" && (
        <ClayCard className="p-4">
          <h2 className="font-display font-bold text-sm mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Top Points Earners</h2>
          <div className="space-y-2">
            {indRows.map((r, i) => {
              const isMe = r.member.id === myMemberId;
              return (
                <div key={r.member.id} className="flex items-center gap-3">
                  <span className="font-mono font-bold w-6 text-center">{i < 3 ? medal[i] : i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className={`font-display font-bold text-sm ${isMe ? "text-clay-pink" : ""}`}>{r.member.last_name}, {r.member.first_name[0]}. {isMe && "· You"}</span>
                      <span className="font-mono text-sm">{r.points} pts</span>
                    </div>
                    <div className="h-4 rounded-full border-2 border-ink bg-cream overflow-hidden">
                      <div className={`h-full ${isMe ? "bg-clay-pink" : "bg-clay-sky"}`} style={{ width: `${(r.points / maxInd) * 100}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {indRows.length === 0 && <p className="text-ink/50 text-sm text-center">No points earned yet — be the first! 🏆</p>}
          </div>
        </ClayCard>
      )}
    </div>
  );
}
