
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import GroupBadgeMarkers from "@/components/GroupBadgeMarkers";
import NovaEmptyState from "@/components/mascot/NovaEmptyState";
import NovaMessage from "@/components/NovaMessage";
import UserAvatar from "@/components/visual/UserAvatar";
import { UIAsset } from "@/components/visual/UIAsset";
import { Sparkles, Crown, Medal, Flame, Users } from "lucide-react";
import { computeParticipationPoints } from "@/lib/stats";
import { supabase } from '@/api/supabaseClient';
import { ROUTES } from '@/lib/routes';
import { ACTIVE_CLASS_CHANGED_EVENT, getActiveStudentAccount } from '@/lib/studentContext';

export default function StudentLeaderboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("groups");

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener(ACTIVE_CLASS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(ACTIVE_CLASS_CHANGED_EVENT, refresh);
  }, [user]);

  async function load() {
    if (!user) return;
    const account = await getActiveStudentAccount(user.id);
    if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
    const group = await db.entities.Group.get(account.group_id);
    const classroomId = group.classroom_id;
    const [rankResult, members, logs, badges, badgeDefinitions] = await Promise.all([
      supabase.rpc('get_classroom_group_leaderboard', { p_classroom_id: classroomId }),
      db.entities.GroupMember.filter({ group_id: group.id }),
      db.entities.ParticipationLog.filter({ group_id: group.id }),
      db.entities.Badge.filter({ classroom_id: classroomId }),
      db.entities.BadgeDefinition.filter({ classroom_id: classroomId }),
    ]);
    if (rankResult.error) throw rankResult.error;
    const groupRows = (rankResult.data || []).map((row) => ({ group: { id: row.group_id, group_number: row.group_number }, pts: Math.round(row.points || 0), missionsDone: row.missions_done || 0 }))
      .sort((a, b) => b.pts - a.pts || b.missionsDone - a.missionsDone);

    const indRows = members
      .map((m) => ({ member: m, points: computeParticipationPoints(m.id, logs) }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 12);

    const myMember = members.find((m) => m.id === account.group_member_id) || members.find((m) => m.is_account_holder);
    setData({ group, groupRows, indRows, myMemberId: myMember?.id, badges, badgeDefinitions });
  }

  if (!data) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  const { group, groupRows, indRows, myMemberId, badges, badgeDefinitions } = data;
  const myRank = groupRows.findIndex((r) => r.group.id === group.id) + 1;
  const maxPts = Math.max(...groupRows.map((r) => r.pts), 1);
  const maxInd = Math.max(...indRows.map((r) => r.points), 1);
  const podium = groupRows.slice(0, 3);
  const podiumOrder = [1, 0, 2]; // visual order: 2nd, 1st, 3rd
  const medal = ["🥇", "🥈", "🥉"];
  const podiumColor = ["bg-clay-sun", "bg-clay-purple text-white", "bg-clay-coral text-white"];

  return (
    <div className="mx-auto max-w-5xl space-y-5 sm:space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1fr_minmax(290px,.75fr)] lg:items-center"><div><p className="text-sm font-semibold text-[var(--uc-purple)]">Current classroom</p><h1 className="uc-page-title mt-1 text-3xl sm:text-4xl">Class leaderboard</h1><p className="mt-1 text-sm leading-relaxed text-ink/60">See every group in this class. Switch classes from the header to view another ranking.</p>{myRank > 0 && <span className="mt-3 inline-flex rounded-full bg-[var(--uc-purple-soft)] px-3 py-1 text-xs font-bold text-[var(--uc-navy-950)]">Your group ranks #{myRank} of {groupRows.length}</span>}</div><NovaMessage variant="achievement" tone="pink" title="Every effort counts.">Celebrate progress with your classmates and keep growing together.</NovaMessage></section>
      <ClayCard color="purple" className="p-5 text-center">
        <UIAsset name="analytics" className="mx-auto mb-2 h-16 w-16" />
        <h2 className="text-2xl font-display font-extrabold text-white">Group standing</h2>
        <p className="text-white/80 text-sm">Points update as participation is recorded.</p>
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
                      <p className="inline-flex items-center gap-1 font-display font-extrabold">G{r.group.group_number} <GroupBadgeMarkers groupId={r.group.id} badges={badges} definitions={badgeDefinitions} /></p>
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
                        <span className={`inline-flex items-center gap-1 font-display font-bold text-sm ${isMe ? "text-clay-pink" : ""}`}>Group {r.group.group_number} <GroupBadgeMarkers groupId={r.group.id} badges={badges} definitions={badgeDefinitions} /> {isMe && "· You"}</span>
                        <span className="font-mono text-sm">{r.pts} pts</span>
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
                  <UserAvatar name={`${r.member.last_name}-${r.member.first_name}`} size="sm" /><div className="flex-1">
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
            {indRows.length === 0 && (
              <NovaEmptyState
                variant="achievement"
                title="No points earned yet"
                description="Be the first to earn points — complete an activity or scan your attendance QR code!"
              />
            )}
          </div>
        </ClayCard>
      )}
    </div>
  );
}
