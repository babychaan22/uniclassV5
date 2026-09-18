
const db = globalThis.__B44_DB__;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { getActiveStudentAccount } from "@/lib/studentContext";
import { supabase } from '@/api/supabaseClient';

import ClayCard from "@/components/ClayCard";
import ClayChip from "@/components/ClayChip";
import { Flame, Star, Trophy, Users, Megaphone, Target, ArrowRight } from "lucide-react";
import {
  computeAttendanceStreak, computeActivityPct, computeParticipationPoints,
  computeEngagementStreak,
} from "@/lib/stats";
import { getTodayManila } from "@/lib/week";
import TrendCharts from "@/components/student/TrendCharts";
import { ROUTES } from '@/lib/routes';

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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

      const memberIds = members.map((m) => m.id);
      const groupPartStreak = computeEngagementStreak(memberIds, attendance, scores, getTodayManila());

      setData({ account, group, members, attendance, scores, activities, logs, memberCards, groupLeaderboard, indLeaderboard, groupPartStreak, missions: missions.data || [], announcements: announcements.sort((a, b) => (b.created_date || "").localeCompare(a.created_date || "")) });
      setLoading(false);
    }
    load();
  }, [user, navigate]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-clay-purple border-t-transparent rounded-full animate-spin" /></div>;

  const { account, group, members, attendance, scores, activities, logs, memberCards, groupLeaderboard, indLeaderboard, groupPartStreak, missions, announcements } = data;
  const myGroupRank = groupLeaderboard.findIndex((g) => g.group.id === group.id) + 1;
  const maxGroupPoints = Math.max(...groupLeaderboard.map((g) => g.points), 1);
  const maxPoints = Math.max(...indLeaderboard.map((i) => i.points), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div><h1 className="text-2xl font-display font-extrabold">Group {group.group_number} Dashboard</h1><p className="text-ink/60">Welcome, {account.first_name}!</p></div>
        <Link to={`${ROUTES.STUDENT.ONBOARDING}?add=1`} className="clay-btn bg-cream text-ink px-3 py-2 text-xs">Join another class</Link>
      </div>

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

      <ClayCard color="sky" className="p-5">
        <div className="flex items-start gap-3">
          <div className="clay-medallion bg-clay-sun w-12 h-12 flex items-center justify-center shrink-0"><Target className="w-6 h-6" /></div>
          <div className="flex-1">
            <p className="font-display font-extrabold text-lg">Today&apos;s learning</p>
            {missions?.length ? (
              <>
                <p className="text-sm text-ink/70">You have {missions.length} active mission{missions.length === 1 ? "" : "s"} waiting for your group.</p>
                <p className="text-xs text-ink/60 mt-1">Next up: {missions[0].title}</p>
              </>
            ) : <p className="text-sm text-ink/70">No active missions right now. Keep your group streak going.</p>}
            {missions?.length > 0 && <Link to={ROUTES.STUDENT.MISSIONS} className="inline-flex items-center gap-1 font-display font-bold text-sm mt-3 underline">Open missions <ArrowRight className="w-4 h-4" /></Link>}
          </div>
        </div>
      </ClayCard>

      <ClayCard className="p-5 flex items-center gap-4">
        <div className="clay-medallion bg-clay-sun w-16 h-16 flex items-center justify-center shrink-0">
          <Flame className="w-8 h-8 text-clay-coral" />
        </div>
        <div className="flex-1">
          <p className="font-display font-extrabold text-3xl font-mono leading-none">{groupPartStreak}</p>
          <p className="font-display font-bold text-sm">day{groupPartStreak === 1 ? "" : "s"} in a row with attendance or activity</p>
          <p className="text-xs text-ink/60">{groupPartStreak > 0 ? "Keep the streak alive!" : "Log attendance or an activity score today to start your streak 🔥"}</p>
        </div>
      </ClayCard>

      <div className="grid sm:grid-cols-2 gap-4">
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

      <TrendCharts classroomId={group.classroom_id} members={members} attendance={attendance} scores={scores} activities={activities} logs={logs} />

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
