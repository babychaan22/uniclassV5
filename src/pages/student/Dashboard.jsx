
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from '@/api/supabaseClient';

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Flame, Star, Trophy, Users, Megaphone, ArrowRight } from "lucide-react";
import { computeAttendanceStreak, computeActivityPct, computeParticipationPoints, computeEngagementStreak } from "@/lib/stats";
import { getTodayManila } from "@/lib/week";
import TrendCharts from "@/components/student/TrendCharts";
import DashboardRangeTabs from "@/components/DashboardRangeTabs";
import NovaMessage from "@/components/NovaMessage";
import RepresentativeRosterPanel from "@/components/student/RepresentativeRosterPanel";
import { ROUTES } from '@/lib/routes';

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("week");

  useEffect(() => {
    async function load() {
      if (!user) return;
      const account = await getActiveStudentAccount(user.id);
      if (!account) { navigate(ROUTES.STUDENT.ONBOARDING); return; }
      const group = await db.entities.Group.get(account.group_id);
      const classroomId = group.classroom_id;
      const [members, rankResult, attendance, scores, activities, logs, announcements, missions] = await Promise.all([
        db.entities.GroupMember.filter({ group_id: group.id }),
        supabase.rpc('get_classroom_group_leaderboard', { p_classroom_id: classroomId }),
        db.entities.Attendance.filter({ classroom_id: classroomId }),
        db.entities.ActivityScore.filter({ classroom_id: classroomId }),
        db.entities.Activity.filter({ classroom_id: classroomId }),
        db.entities.ParticipationLog.filter({ classroom_id: classroomId }),
        db.entities.Announcement.filter({ classroom_id: classroomId, is_pinned: true }),
        supabase.rpc('get_student_missions', { p_classroom_id: classroomId }),
      ]);
      if (rankResult.error) throw rankResult.error;

      const memberCards = members.map((m) => {
        const streak = computeAttendanceStreak(m.id, attendance);
        const act = computeActivityPct(m.id, scores, activities);
        const pts = computeParticipationPoints(m.id, logs);
        return { member: m, streak, activityPct: act.pct, points: pts };
      });

      const groupLeaderboard = (rankResult.data || []).map((row) => ({ group: { id: row.group_id, group_number: row.group_number }, points: Number(row.points || 0) }))
        .sort((a, b) => b.points - a.points);

      const indLeaderboard = members
        .map((m) => ({ member: m, points: computeParticipationPoints(m.id, logs) }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);

      const personalStreak = computeEngagementStreak(account.group_member_id, attendance, scores, getTodayManila());

      setData({ account, group, members, attendance, scores, activities, logs, memberCards, groupLeaderboard, indLeaderboard, personalStreak, missions: missions.data || [], announcements: announcements.sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")) });
      setLoading(false);
    }
    load();
  }, [user, navigate]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  const { account, group, members, attendance, scores, activities, logs, memberCards, groupLeaderboard, indLeaderboard, personalStreak, missions, announcements } = data;
  const myGroupRank = groupLeaderboard.findIndex((g) => g.group.id === group.id) + 1;
  const maxGroupPoints = Math.max(...groupLeaderboard.map((g) => g.points), 1);
  const maxPoints = Math.max(...indLeaderboard.map((i) => i.points), 1);
  const myMemberId = account.group_member_id;
  const myAttendanceRate = attendance.length ? Math.round((attendance.filter((a) => a.group_member_id === myMemberId && a.status === "present").length / Math.max(1, attendance.filter((a) => a.group_member_id === myMemberId).length)) * 100) : 0;
  const myActivityPct = memberCards.find((c) => c.member.id === myMemberId)?.activityPct || 0;
  const myPoints = memberCards.find((c) => c.member.id === myMemberId)?.points || 0;

  const studentProgressAreas = [
    { label: "Attendance", value: myAttendanceRate, color: "bg-clay-sky" },
    { label: "Activity", value: Math.round(myActivityPct), color: "bg-clay-lime" },
    { label: "Participation", value: memberCards.length ? Math.round((memberCards.filter((c) => c.points > 0).length / memberCards.length) * 100) : 0, color: "bg-clay-purple" },
  ];

  return (
    <div className="space-y-6">
      <section className="grid items-center gap-4 lg:grid-cols-[1fr_.82fr] no-print">
        <div>
          <h1 className="uc-page-title text-4xl leading-none sm:text-5xl">Hi, {account.first_name}!</h1>
          <p className="mt-3 text-sm text-ink/60 sm:text-base">Keep going—your everyday effort is adding up.</p>
          <Link to={`${ROUTES.STUDENT.ONBOARDING}?add=1`} className="clay-btn mt-4 bg-white px-3 py-2 text-xs text-ink">Join another class</Link>
        </div>
        <NovaMessage variant="teacher" tone="violet" title="Small steps, big progress!" className="hidden lg:flex">
          {missions?.length ? `${missions.length} mission${missions.length === 1 ? " is" : "s are"} ready for your group.` : "Your effort this week is building something great."}
        </NovaMessage>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashboardRangeTabs value={range} onChange={setRange} />
        <ClayChip color="sky">Group {group.group_number}</ClayChip>
      </div>

      <section className="no-print">
        <div className="grid grid-cols-2 gap-3 text-center sm:gap-3">
          <ClayCard className="p-3">
            <div className="font-mono text-2xl font-extrabold text-clay-sky">{myAttendanceRate}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Attendance</p>
          </ClayCard>
          <ClayCard className="p-3">
            <div className="font-mono text-2xl font-extrabold text-clay-purple">{Math.round(myActivityPct)}%</div>
            <p className="text-xs font-display font-bold text-ink/60">Activity</p>
          </ClayCard>
        </div>
      </section>

      {(missions.length > 0 || memberCards.some((c) => c.activityPct < 60)) && (
        <ClayCard className="p-3">
          <h3 className="font-display text-xs font-bold text-ink/60 mb-2">Needs attention</h3>
          <ul className="space-y-1 text-sm">
            {missions
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
            {memberCards.some((c) => c.activityPct < 60) && (
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay-coral" />
                <span>Activity below 60% — submit scores soon</span>
              </li>
            )}
          </ul>
        </ClayCard>
      )}

      <section className="no-print">
        <div className="mb-3 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-clay-purple" /><div><h2 className="font-display text-lg font-extrabold">Your progress</h2><p className="text-xs text-ink/60">Building habits across categories</p></div></div>
        <div className="space-y-3">
          {studentProgressAreas.map((area) => (
            <div key={area.label}>
              <div className="mb-1 flex justify-between text-sm font-display font-bold"><span>{area.label}</span><span>{area.value}%</span></div>
              <div className="h-4 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${area.color}`} style={{ width: `${area.value}%` }} /></div>
            </div>
          ))}
        </div>
      </section>

      {announcements?.length > 0 && (
        <div className="space-y-2">
          {announcements.map((a) => (
            <ClayCard key={a.id} color="purple" className="p-4">
              <p className="font-display font-bold text-white flex items-center gap-2"><Megaphone className="w-4 h-4" /> {a.title}</p>
              {a.body && <p className="text-sm text-white/80 mt-1 whitespace-pre-wrap">{a.body}</p>}
            </ClayCard>
          ))}
        </div>
      )}

      <NovaMessage variant="teacher" tone="violet" title="Nova's learning tip" className="lg:hidden">
            {missions?.length ? (
              <>
                <p>You have {missions.length} active mission{missions.length === 1 ? "" : "s"} waiting for your group.</p>
                <p className="mt-1 text-xs text-ink/55">Next up: {missions[0].title}</p>
              </>
            ) : <p>No active missions right now. Keep your group streak going.</p>}
            {missions?.length > 0 && <Link to={ROUTES.STUDENT.MISSIONS} className="mt-3 inline-flex items-center gap-1 font-display text-sm font-bold underline">Open missions <ArrowRight className="w-4 h-4" /></Link>}
      </NovaMessage>

      <TrendCharts classroomId={group.classroom_id} members={members} currentMemberId={account.group_member_id} attendance={attendance} scores={scores} activities={activities} logs={logs} range={range} />

      <ClayCard tone="green" className="p-4 flex items-center gap-4">
        <div className="clay-medallion bg-clay-sun w-16 h-16 flex items-center justify-center shrink-0">
          <Flame className="w-8 h-8 text-clay-coral" />
        </div>
        <div className="flex-1">
          <p className="font-display font-extrabold text-3xl font-mono leading-none">{personalStreak}</p>
          <p className="font-display font-bold text-sm">your personal day{personalStreak === 1 ? "" : "s"} in a row</p>
          <p className="text-xs text-ink/60">{personalStreak > 0 ? "Your own attendance and activity keep this streak alive!" : "Your attendance or activity today starts your own streak 🔥"}</p>
        </div>
      </ClayCard>

      <section>
        <div className="mb-3 flex items-center gap-2"><Users className="h-5 w-5 text-clay-purple" /><div><h2 className="font-display text-lg font-extrabold">Group progress</h2><p className="text-xs text-ink/60">How your group is building habits together</p></div></div>
      <RepresentativeRosterPanel account={account} members={members} />
      <div className="grid gap-4 sm:grid-cols-2">
        {memberCards.map(({ member, streak, activityPct, points }) => (
          <ClayCard key={member.id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-display font-bold">{member.last_name}, {member.first_name}</p>
              {member.id === account.group_member_id && <ClayChip color="purple">You</ClayChip>}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border-2 border-ink/15 bg-clay-sun/20 p-2">
                <Flame className="w-4 h-4 mx-auto text-clay-coral" />
                <p className="font-mono font-bold text-lg">{streak}</p>
                <p className="text-[10px] font-display">Streak</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-clay-lime/20 p-2">
                <Star className="w-4 h-4 mx-auto text-clay-lime" />
                <p className="font-mono font-bold text-lg">{Math.round(activityPct)}%</p>
                <p className="text-[10px] font-display">Activity</p>
              </div>
              <div className="rounded-xl border-2 border-ink/15 bg-clay-pink/20 p-2">
                <Trophy className="w-4 h-4 mx-auto text-clay-pink" />
                <p className="font-mono font-bold text-lg">{points}</p>
                <p className="text-[10px] font-display">Points</p>
              </div>
            </div>
          </ClayCard>
        ))}
      </div>
      </section>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2"><Users className="w-5 h-5" /> Group Leaderboard</h2>
        <div className="space-y-2">
          {groupLeaderboard.map((g, i) => {
            const isMe = g.group.id === group.id;
            return (
              <div key={g.group.id} className="flex items-center gap-3">
                <span className="font-mono font-bold w-6">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className={`font-display font-bold text-sm ${isMe ? "text-clay-pink" : ""}`}>Group {g.group.group_number} {isMe && "(You)"}</span>
                    <span className="font-mono text-sm">{Math.round(g.points)} pts</span>
                  </div>
                  <div className="h-6 rounded-full border-2 border-ink bg-cream overflow-hidden">
                    <div className={`h-full rounded-full ${isMe ? "bg-clay-pink" : "bg-clay-purple"}`} style={{ width: `${(g.points / maxGroupPoints) * 100}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ClayCard>

      <ClayCard className="p-5">
        <h2 className="font-display font-bold text-lg mb-3 flex items-center gap-2"><Trophy className="w-5 h-5" /> Top Points Earners</h2>
        <div className="space-y-2">
          {indLeaderboard.map((item, i) => (
            <div key={item.member.id} className="flex items-center gap-3">
              <span className="font-mono font-bold w-6">{i + 1}</span>
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="font-display font-bold text-sm">{item.member.last_name}, {item.member.first_name[0]}.</span>
                  <span className="font-mono text-sm">{item.points}pts</span>
                </div>
                <div className="h-5 rounded-full border-2 border-ink bg-cream overflow-hidden">
                  <div className="h-full bg-clay-sky" style={{ width: `${(item.points / maxPoints) * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
          {indLeaderboard.length === 0 && <p className="text-ink/50 text-sm">No points earned yet.</p>}
        </div>
      </ClayCard>
    </div>
  );
}
